import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, rename, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { convertResponsesMessages } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { stream as streamAnthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import { applyOperation, rebuild, synchronize, MAX_FILE_BYTES } from "../index.ts";
import early, { moveNewSnapshot } from "../experiments/early-snapshot/extension.ts";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const capture = async (name: string, value: unknown) => {
	if (process.env.CORVUS_EARLY_CAPTURE) await writeFile(join(process.env.CORVUS_EARLY_CAPTURE, `${name}.json`), JSON.stringify(value, null, 2), { mode: 0o600 });
};
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const model: Model<"openai-codex-responses"> = {
	id: "gpt-6-luna", name: "Luna", api: "openai-codex-responses", provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api", reasoning: true, input: ["text"],
	cost: usage.cost, contextWindow: 400000, maxTokens: 4096,
};
const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 100 });
function pair(path: string, text: string, id = "call_read|fc_read"): AgentMessage[] {
	const bashId = `${id.split("|")[0]}_bash|${id.split("|")[1]}_bash`;
	return [{
		role: "assistant", api: model.api, provider: model.provider, model: model.id, usage,
		stopReason: "toolUse", timestamp: 1, content: [
			{ type: "thinking", thinking: "", thinkingSignature: JSON.stringify({
				type: "reasoning", id: "rs_signed", summary: [], encrypted_content: "opaque-signature" }) },
			{ type: "text", text: "This is a historical read, followed by a command." },
			{ type: "toolCall", id, name: "read", arguments: { path } },
			{ type: "toolCall", id: bashId, name: "bash", arguments: { command: "true" } },
		],
	}, { role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text }], isError: false, timestamp: 2 },
	{ role: "toolResult", toolCallId: bashId, toolName: "bash", content: [{ type: "text", text: "UNCHANGED_COMMAND" }], isError: false, timestamp: 3 }];
}
async function fixture() {
	const dir = await mkdtemp(join(tmpdir(), "corvus-early-offline-"));
	dirs.push(dir);
	const path = join(dir, "a.ts");
	await writeFile(path, "A");
	const state = rebuild([]);
	applyOperation(state, { op: "read", path, observation: { id: "call_read|fc_read", digest: hash("A") } });
	const messages = [user("Read A; later edit discussions are historical."), ...pair(path, "A")];
	const transform = async (input = messages) => moveNewSnapshot(input, await synchronize(input, state));
	return { dir, path, state, messages, transform };
}
const snapshotText = (messages: AgentMessage[]) => messages.flatMap(m => m.role === "user" && Array.isArray(m.content)
	? m.content.flatMap(b => b.type === "text" && b.text.startsWith("Current synchronized workspace files") ? [b.text] : []) : []);
const snapshots = (messages: AgentMessage[]) => snapshotText(messages).flatMap(text => JSON.parse(text.slice(text.indexOf("\n") + 1)) as { path: string; content: string }[]);
const restored = (messages: AgentMessage[]) => normalizeContext({
	messages: [{ role: "system", content: "Initial required instructions.", timestamp: 0 },
		...messages.flatMap(m => m.role === "system" ? [m] : convertToLlm([m]))],
});
const request = (messages: AgentMessage[]) => convertResponsesMessages(model,
	restored(messages),
	new Set(["openai-codex"]), { includeSystemPrompt: false });
function paired(input: ReturnType<typeof request>) {
	const calls = input.filter(i => i.type === "function_call").map(i => i.call_id);
	const outputs = input.filter(i => i.type === "function_call_output").map(i => i.call_id);
	expect(outputs).toEqual(calls);
	expect(new Set(calls).size).toBe(calls.length);
	expect(JSON.stringify(input)).not.toContain("No result provided");
}

describe("test-only early placement, not package default", () => {
	it("keeps unchanged authority untouched, preserves exact framing and stable converted B prefix; invalidates on C/A", async () => {
		const f = await fixture();
		expect(await f.transform()).toBe(f.messages);
		await writeFile(f.path, "B");
		const canonical = JSON.stringify(f.messages);
		const output = await synchronize(f.messages, f.state);
		const moved = moveNewSnapshot(f.messages, output);
		expect(moved[0]).toBe(output.at(-1));
		expect(moved.slice(1)).toEqual(output.slice(0, -1));
		expect(snapshots(moved)).toEqual([{ path: f.path, content: "B" }]);
		const prefix = request(moved).slice(0, 1);
		const captured = [request(moved)];
		for (let i = 0; i < 3; i++) {
			const next = request(await f.transform([...f.messages, user(`Later instructions ${i}: discuss historical A versus current B.`)]));
			expect(JSON.stringify(next.slice(0, 1))).toBe(JSON.stringify(prefix));
			paired(next);
			captured.push(next);
		}
		await writeFile(f.path, "C");
		expect(snapshots(await f.transform())[0].content).toBe("C");
		expect(JSON.stringify(request(await f.transform()).slice(0, 1))).not.toBe(JSON.stringify(prefix));
		captured.push(request(await f.transform()));
		await capture("offline-stable-B-and-C", captured);
		await writeFile(f.path, "A");
		const returned = await f.transform();
		expect(snapshots(returned)[0].content).toBe("A");
		expect(JSON.stringify(returned[3])).toContain("CORVUS synchronized"); // retired original read body
		expect(JSON.stringify(f.messages)).toBe(canonical);
	});
	it("uses a transcript boundary after initial system messages and never splits tool groups", async () => {
		const f = await fixture();
		await writeFile(f.path, "B");
		const original = [{ role: "system", content: "FIRST", timestamp: 0 } as AgentMessage,
			...f.messages, { role: "system", content: "LATER INSTRUCTION", timestamp: 6 } as AgentMessage, user("Obey later instructions")];
		const out = moveNewSnapshot(original, await synchronize(original, f.state));
		expect(out[0]).toBe(original[0]);
		expect(snapshotText(out)).toHaveLength(1);
		expect(out.slice(2).map(m => m.role)).toEqual(original.slice(1).map(m => m.role));
		const converted = request(out);
		paired(converted);
		expect(JSON.stringify(converted)).toContain("opaque-signature");
		// System state is normalized into initial instructions, outside Codex input.
		expect(JSON.stringify(restored(out))).toContain("LATER INSTRUCTION");
		expect(JSON.stringify(converted)).toContain("Obey later instructions");
	});
	it("handles multiple files deterministically, one-file changes, new files, and fresh authority after synthetic state", async () => {
		const f = await fixture();
		await writeFile(f.path, "B1");
		for (const [name, current] of [["b.ts", "B2"], ["c.ts", "B3"]]) {
			const path = join(f.dir, name);
			await writeFile(path, current);
			const id = `call_${name}|fc_${name}`;
			applyOperation(f.state, { op: "read", path, observation: { id, digest: hash("OLD") } });
			f.messages.push(...pair(path, "OLD", id));
		}
		const first = await f.transform();
		expect(snapshots(first).map(s => s.content)).toEqual(["B1", "B2", "B3"]);
		expect(JSON.stringify(request(await f.transform([...f.messages, user("Growth")]))[0])).toBe(JSON.stringify(request(first)[0]));
		await writeFile(join(f.dir, "b.ts"), "C2");
		expect(snapshots(await f.transform()).map(s => s.content)).toEqual(["B1", "C2", "B3"]);
		await capture("offline-multiple-files", { first: request(first), changed: request(await f.transform()) });
		const added = join(f.dir, "d.ts");
		await writeFile(added, "NEW");
		const id = "call_new|fc_new";
		applyOperation(f.state, { op: "read", path: added, observation: { id, digest: hash("NEW") } });
		f.messages.push(...pair(added, "NEW", id));
		expect(snapshots(await f.transform()).map(s => s.content)).toEqual(["B1", "C2", "B3"]);
		await writeFile(added, "NEWER");
		expect(snapshots(await f.transform()).map(s => s.content)).toEqual(["B1", "C2", "B3", "NEWER"]);
		applyOperation(f.state, { op: "read", path: f.path, observation: { id: "fresh|fc_fresh", digest: hash("B1") } });
		const fresh = pair(f.path, "B1", "fresh|fc_fresh");
		f.messages.push(...fresh);
		const out = await f.transform();
		expect(snapshots(out).map(s => s.content)).toEqual(["C2", "B3", "NEWER"]);
		expect(out.at(-2)).toBe(fresh[1]); // sole current B1 historical body
		paired(request(out));
	});
	it("fails open for deletion, rename and invalid/oversized refresh; does not mistake canonical text for a new snapshot", async () => {
		const f = await fixture();
		await rename(f.path, `${f.path}.moved`);
		expect(await f.transform()).toBe(f.messages);
		await writeFile(f.path, Buffer.from([0, 1, 2]));
		expect(await f.transform()).toBe(f.messages);
		await writeFile(f.path, "x".repeat(MAX_FILE_BYTES + 1));
		expect(await f.transform()).toBe(f.messages);
		await rm(f.path);
		expect(await f.transform()).toBe(f.messages);
		const literal = [user("Current synchronized workspace files (request-time; authoritative for these paths; JSON-encoded content):\n[]")];
		expect(moveNewSnapshot(literal, literal)).toBe(literal);
	});
	it("preserves content identity/ranges and duplicate authority rules", async () => {
		const f = await fixture();
		const id = "again|fc_again";
		applyOperation(f.state, { op: "read", path: f.path, observation: { id, digest: hash("A") } });
		f.messages.push(...pair(f.path, "A", id));
		const out = await f.transform();
		expect(snapshots(out)).toHaveLength(0);
		expect(out[2]).toBe(f.messages[2]);
		expect(JSON.stringify(out.at(-2))).toContain("CORVUS synchronized");
		await writeFile(f.path, "A\nmore"); // a partial A cannot supply full-file authority
		expect(snapshots(await f.transform())[0].content).toBe("A\nmore");
	});
	it("retains supported OpenAI Responses and Anthropic conversions", async () => {
		const f = await fixture();
		await writeFile(f.path, "CURRENT");
		const out = await f.transform();
		const base = normalizeContext({ messages: [{ role: "system", content: "Instructions", timestamp: 0 }, ...convertToLlm(out)] });
		const responseModel: Model<"openai-responses"> = { ...model, api: "openai-responses", provider: "openai", id: "gpt-5.1" };
		const input = convertResponsesMessages(responseModel, base, new Set(["openai"]));
		paired(input);
		expect(JSON.stringify(input).match(/CURRENT/g)).toHaveLength(1);
		let payload: unknown;
		const anthropicModel: Model<"anthropic-messages"> = { ...model, compat: undefined, api: "anthropic-messages", provider: "anthropic", id: "claude-sonnet-4-5", baseUrl: "https://api.anthropic.com" };
		await streamAnthropic(anthropicModel, base, { apiKey: "local",
			onPayload: body => { payload = body; throw new Error("Intentional offline stop"); } }).result();
		expect(JSON.stringify(payload)).toContain("CURRENT");
		expect(JSON.stringify(payload)).not.toContain("No result provided");
		expect(JSON.stringify(payload)).not.toContain("opaque-signature");
	});
	it("replays retirement on resume and isolates fork/tree registrations through the actual experimental factory", async () => {
		const f = await fixture();
		const session = SessionManager.create(f.dir, join(f.dir, "sessions"));
		const harness = (manager: SessionManager) => {
			const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
			const api = { on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => handlers.set(name, handler),
				appendEntry: (name: string, data: unknown) => manager.appendCustomEntry(name, data), registerCommand: () => {} } as unknown as ExtensionAPI;
			early(api);
			const ctx = { cwd: f.dir, sessionManager: manager } as unknown as ExtensionContext;
			return async (name: string, event: unknown = {}) => handlers.get(name)?.(event, ctx);
		};
		const emit = harness(session);
		await emit("session_start");
		const root = session.appendMessage(f.messages[1] as Parameters<SessionManager["appendMessage"]>[0]);
		await emit("tool_result", { toolName: "read", toolCallId: "call_read|fc_read", input: { path: f.path }, isError: false, content: [{ type: "text", text: "A" }] });
		for (const input of [{ path: f.path, offset: 1 }, { path: f.path, limit: 1 }]) {
			await emit("tool_result", { toolName: "read", toolCallId: "partial", input, isError: false, content: [{ type: "text", text: "A" }] });
		}
		expect(rebuild(session.getBranch()).files[0].observations).toHaveLength(1);
		session.appendMessage(f.messages[2] as Parameters<SessionManager["appendMessage"]>[0]);
		session.appendMessage(f.messages[3] as Parameters<SessionManager["appendMessage"]>[0]);
		const canonical = session.buildSessionContext().messages;
		const raw = JSON.stringify(canonical);
		await writeFile(f.path, "B");
		const out = await emit("context", { messages: canonical }) as { messages: AgentMessage[] };
		expect(snapshots(out.messages)[0].content).toBe("B");
		const leaf = session.getLeafId()!;
		const resumed = SessionManager.open(session.getSessionFile()!);
		const resume = harness(resumed);
		await resume("session_start");
		expect(rebuild(resumed.getBranch()).files[0].observations[0].stale).toBe(true);
		expect(JSON.stringify((await resume("context", { messages: resumed.buildSessionContext().messages })))).toContain("B");
		const fork = SessionManager.open(session.createBranchedSession(leaf)!);
		const forkEmit = harness(fork);
		await forkEmit("session_start");
		expect(rebuild(fork.getBranch()).files[0].path).toBe(await realpath(f.path));
		await writeFile(f.path, "A");
		const forkOut = await forkEmit("context", { messages: fork.buildSessionContext().messages }) as { messages: AgentMessage[] };
		expect(snapshots(forkOut.messages)[0].content).toBe("A");
		session.branch(root);
		await emit("session_tree");
		expect(rebuild(session.getBranch()).files).toHaveLength(0);
		expect((await emit("context", { messages: canonical }) as { messages: AgentMessage[] }).messages).toBe(canonical);
		expect(JSON.stringify(canonical)).toBe(raw);
		expect(await readFile(resumed.getSessionFile()!, "utf8")).toContain('"text":"A"');
	});
});
