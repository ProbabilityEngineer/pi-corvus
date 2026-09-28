import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message, Model } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { convertResponsesMessages } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { stream as streamCodex } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { stream as streamAnthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";
import { convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import { applyOperation, rebuild, synchronize } from "../index.ts";

const dirs: string[] = [];
afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const model: Model<"openai-codex-responses"> = {
	id: "gpt-5.1-codex", name: "Codex", api: "openai-codex-responses",
	provider: "openai-codex", baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true, input: ["text"], cost: usage.cost, contextWindow: 400000, maxTokens: 4096,
};

async function fixture() {
	const dir = await mkdtemp(join(tmpdir(), "corvus-provider-"));
	dirs.push(dir);
	const path = join(dir, "a.ts");
	const old = "export const OLD_READ = 1;\n";
	const current = "export const CURRENT_FILE = 2;\n";
	await writeFile(path, current);
	const assistant: AgentMessage = {
		role: "assistant", api: model.api, provider: model.provider, model: model.id,
		usage, stopReason: "toolUse", timestamp: 1,
		content: [
			{ type: "thinking", thinking: "", thinkingSignature: JSON.stringify({
				type: "reasoning", id: "rs_signed", summary: [], encrypted_content: "opaque-signature",
			}) },
			{ type: "text", text: "I will inspect the file and run a command." },
			{ type: "toolCall", id: "call_read|fc_read", name: "read", arguments: { path } },
			{ type: "toolCall", id: "call_bash|fc_bash", name: "bash", arguments: { command: "true" } },
		],
	};
	const messages: AgentMessage[] = [
		assistant,
		{ role: "toolResult", toolCallId: "call_read|fc_read", toolName: "read",
			content: [{ type: "text", text: old }], isError: false, timestamp: 2 },
		{ role: "toolResult", toolCallId: "call_bash|fc_bash", toolName: "bash",
			content: [{ type: "text", text: "BASH_UNCHANGED" }], isError: false, timestamp: 3 },
	];
	const state = rebuild([]);
	applyOperation(state, { op: "read", path, observation: { id: "call_read|fc_read", digest: digest(old) } });
	return { dir, path, old, current, messages, state };
}

const request = (messages: AgentMessage[], target: Model<"openai-codex-responses"> = model) => {
	const context = normalizeContext({ messages: [
		{ role: "system", content: "You are a coding assistant.", timestamp: 0 },
		...convertToLlm(messages),
	] });
	return convertResponsesMessages(target, context, new Set(["openai-codex"]), { includeSystemPrompt: false });
};

describe("Pi provider conversion of CORVUS context", () => {
	it("keeps exact read/bash pairing, opaque reasoning and unrelated assistant content through Codex conversion", async () => {
		const { state, messages, old, current } = await fixture();
		const output = await synchronize(messages, state);
		const normalized = transformMessages(convertToLlm(output), model);
		expect(normalized.filter((m) => m.role === "toolResult")).toHaveLength(2);
		expect(JSON.stringify(normalized)).not.toContain("No result provided");
		expect(output[0]).toEqual(messages[0]);
		expect(output[2]).toEqual(messages[2]);
		const converted = request(output);
		expect(converted.filter((i) => i.type === "function_call").map((i) => i.call_id))
			.toEqual(["call_read", "call_bash"]);
		expect(converted.filter((i) => i.type === "function_call_output").map((i) => i.call_id))
			.toEqual(["call_read", "call_bash"]);
		expect(JSON.stringify(converted)).toContain("opaque-signature");
		expect(JSON.stringify(converted)).toContain("BASH_UNCHANGED");
		expect(JSON.stringify(converted)).toContain("I will inspect");
		expect(JSON.stringify(converted)).not.toContain(old);
		expect(JSON.stringify(converted).match(/CURRENT_FILE/g)).toHaveLength(1);
		expect(messages[1]).toMatchObject({ content: [{ text: old }] });
	});

	it("builds an actual Codex SSE request and accepts a local successful provider response", async () => {
		const { dir, state, messages, path, old, current } = await fixture();
		const session = SessionManager.create(dir, join(dir, "sessions"));
		for (const message of messages) session.appendMessage(message as Message);
		const canonical = session.buildSessionContext().messages;
		expect(JSON.stringify(session.buildSessionProjection())).toContain("OLD_READ");
		const transformed = await synchronize(canonical, state);
		let payload: unknown;
		let wire: unknown;
		const token = `aaa.${Buffer.from(JSON.stringify({
			"https://api.openai.com/auth": { chatgpt_account_id: "acc_local" },
		})).toString("base64")}.bbb`;
		const sse = [
			{ type: "response.output_item.added", item: { type: "message", id: "msg_1", role: "assistant", status: "in_progress", content: [] } },
			{ type: "response.content_part.added", part: { type: "output_text", text: "" } },
			{ type: "response.output_text.delta", delta: "Done" },
			{ type: "response.output_item.done", item: { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Done" }] } },
			{ type: "response.completed", response: { status: "completed", usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6, input_tokens_details: { cached_tokens: 0 } } } },
		].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
		const result = await streamCodex(model, normalizeContext({ messages: [
			{ role: "system", content: "You are a coding assistant.", timestamp: 0 },
			...convertToLlm(transformed),
		] }), {
			apiKey: token, transport: "sse", maxRetries: 0,
			onPayload: (body) => { payload = body; },
			fetch: async (_url, init) => {
				const body = init?.body;
				wire = JSON.parse(typeof body === "string" ? body :
					Buffer.from(zstdDecompressSync(body as Uint8Array)).toString("utf8"));
				return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
			},
		}).result();
		expect(result.stopReason).toBe("stop");
		expect(payload).toEqual(wire);
		const body = JSON.stringify(wire);
		expect(body).not.toContain(old);
		expect(body.match(/CURRENT_FILE/g)).toHaveLength(1);
		expect(body).toContain("call_read");
		expect(body).toContain("call_bash");
		expect(body).toContain("opaque-signature");
		expect((await readFile(session.getSessionFile()!, "utf8")).split("\n")[2]).toContain("OLD_READ");
		await writeFile(path, "export const SECOND_EDIT = 3;\n");
		const next = request(await synchronize(canonical, state));
		expect(JSON.stringify(next).match(/SECOND_EDIT/g)).toHaveLength(1);
		expect(JSON.stringify(next)).not.toContain(current);
	});
	it("converts cross-model history through OpenAI Responses and Anthropic request builders", async () => {
		const { state, messages, old } = await fixture();
		const transformed = await synchronize(messages, state);
		const base = normalizeContext({ messages: [
			{ role: "system", content: "Prompt", timestamp: 0 }, ...convertToLlm(transformed),
		] });
		const responsesModel: Model<"openai-responses"> = {
			...model, api: "openai-responses", provider: "openai", id: "gpt-5.1",
		};
		const responseItems = convertResponsesMessages(responsesModel, base, new Set(["openai"]));
		expect(responseItems.filter((i) => i.type === "function_call")).toHaveLength(2);
		expect(responseItems.filter((i) => i.type === "function_call_output")).toHaveLength(2);
		expect(JSON.stringify(responseItems)).not.toContain("No result provided");
		expect(JSON.stringify(responseItems)).not.toContain("opaque-signature");
		const anthropicModel: Model<"anthropic-messages"> = {
			id: "claude-sonnet-4-5", name: "Claude", api: "anthropic-messages",
			provider: "anthropic", baseUrl: "https://api.anthropic.com",
			reasoning: true, input: ["text"], cost: usage.cost, contextWindow: 200000, maxTokens: 4096,
		};
		let payload: unknown;
		const response = await streamAnthropic(anthropicModel, base, {
			apiKey: "local-test-key",
			onPayload: (body) => { payload = body; throw new Error("Stop after Anthropic request conversion"); },
		}).result();
		expect(response.stopReason).toBe("error"); // Intentional stop before network; adapter conversion already completed.
		const body = JSON.stringify(payload);
		expect(body).not.toContain("No result provided");
		expect(body).not.toContain("opaque-signature");
		expect(body).not.toContain(old);
		expect(body).toContain("call_read");
		expect(body).toContain("call_bash");
		expect(body.match(/CURRENT_FILE/g)).toHaveLength(1);
	});
});
