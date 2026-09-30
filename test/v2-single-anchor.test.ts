import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import v2a from "../experiments/v2-single-anchor/extension.ts";

const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });

async function setup() {
	const cwd = await mkdtemp(join(tmpdir(), "corvus-v2a-"));
	dirs.push(cwd);
	const path = join(cwd, "state.txt");
	const a = "A-CONTENT\n";
	await writeFile(path, a);
	const sm = SessionManager.create(cwd, join(cwd, "sessions"));
	const handlers = new Map<string, (event: any, ctx: ExtensionContext) => unknown>();
	const pi = {
		on: (name: string, handler: (event: any, ctx: ExtensionContext) => unknown) => {
			handlers.set(name, handler);
			return () => handlers.delete(name);
		},
		appendEntry: (name: string, data: unknown) => sm.appendCustomEntry(name, data),
		registerCommand: () => {},
	} as unknown as ExtensionAPI;
	v2a(pi);
	const ctx = { cwd, sessionManager: sm } as unknown as ExtensionContext;
	const emit = (name: string, event: any = {}) => handlers.get(name)?.(event, ctx);
	const callId = "read-a";
	const call: AgentMessage = {
		role: "assistant", provider: "test", api: "test", model: "test",
		content: [{ type: "toolCall", id: callId, name: "read", arguments: { path } }],
		stopReason: "toolUse", timestamp: 1,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
	sm.appendMessage(call);
	await emit("tool_result", { type: "tool_result", toolName: "read", toolCallId: callId,
		input: { path }, isError: false, content: [{ type: "text", text: a }] });
	sm.appendMessage({ role: "toolResult", toolCallId: callId, toolName: "read",
		content: [{ type: "text", text: a }], isError: false, timestamp: 2 });
	return { cwd, path, a, sm, ctx, emit };
}

function texts(messages: AgentMessage[]) {
	return messages.map((m) => {
		if (m.role === "custom") return typeof m.content === "string" ? m.content :
			m.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
		if (m.role === "user" || m.role === "toolResult") return typeof m.content === "string" ? m.content :
			m.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
		return "";
	}).join("\n");
}

function snapshotContent(messages: AgentMessage[], path: string) {
	for (const m of messages) {
		if (m.role !== "user" || !Array.isArray(m.content)) continue;
		for (const c of m.content) {
			if (c.type !== "text" || !c.text.includes("Current synchronized workspace files")) continue;
			const value = c.text.slice(c.text.indexOf("\n") + 1);
			try {
				const files = JSON.parse(value) as Array<{ path: string; content: string }>;
				const found = files.find((f) => f.path === path);
				if (found) return found.content;
			} catch { /* not a snapshot */ }
		}
	}
	return undefined;
}

async function promote(sm: SessionManager, ctx: ExtensionContext, draft: any) {
	// Match Pi 0.99.1's documented boundary preview ingredients using public
	// SessionManager/projection/conversion APIs. Commit only after conversion.
	const preview = SessionManager.inMemory(sm.getCwd(), undefined, [sm.getHeader()!, ...sm.getBranch()]);
	preview.appendCustomMessageEntry(draft.customType, draft.content, draft.display, draft.details);
	const projection = preview.buildSessionProjection();
	convertToLlm(projection.messages);
	const id = sm.appendCustomMessageEntry(draft.customType, draft.content, draft.display, draft.details);
	return { id, raw: sm.getBranch(), projection: sm.buildSessionProjection() };
}

describe("experimental V2a one-anchor lifecycle", () => {
	it("keeps unchanged historical A and performs request-only A→B before one durable promotion", async () => {
		const { path, a, sm, emit } = await setup();
		const history = sm.buildSessionProjection().messages;
		const unchanged = await emit("context", { messages: history }) as { messages: AgentMessage[] };
		expect(unchanged.messages).toBe(history);
		expect(sm.getBranch().some((e: any) => e.customType === "corvus-v2a-state")).toBe(false);

		const b = "B-CONTENT\n";
		await writeFile(path, b);
		const firstB = await emit("context", { messages: sm.buildSessionProjection().messages }) as { messages: AgentMessage[] };
		expect(snapshotContent(firstB.messages, await import("node:fs/promises").then(({ realpath }) => realpath(path)))).toBe(b);
		expect(texts(firstB.messages)).toContain("CORVUS synchronized read");
		expect(texts(firstB.messages)).not.toContain(`"${a}"`);
		expect(sm.getBranch().filter((e: any) => e.customType === "corvus-v2a-state")).toHaveLength(0);

		const draft = await emit("turn_end", { outcome: "completed" }) as { entries: any[] };
		expect(draft.entries).toHaveLength(1);
		expect(draft.entries[0]).toMatchObject({ type: "custom_message", customType: "corvus-v2a-state", content: b });
		const promoted = await promote(sm, {} as ExtensionContext, draft.entries[0]);
		expect(promoted.raw.findIndex((e: any) => e.id === promoted.id)).toBe(promoted.raw.length - 1);
		expect(promoted.raw.filter((e: any) => e.customType === "corvus-v2a-state")).toHaveLength(1);
		expect(promoted.projection.entries.some((e) => e.sourceEntry.id === promoted.id)).toBe(true);
		expect(texts(promoted.projection.messages)).toContain(a);

		const next = await emit("context", { messages: promoted.projection.messages }) as { messages: AgentMessage[] };
		expect(texts(next.messages)).toContain(b);
		expect(texts(next.messages).match(/B-CONTENT/g)).toHaveLength(1);
		expect(texts(next.messages)).toContain("CORVUS synchronized read");
		expect(next.messages.some((m) => m.role === "user" && Array.isArray(m.content) &&
			m.content.some((c) => c.type === "text" && c.text.includes("Current synchronized workspace files")))).toBe(false);
		const llm = convertToLlm(next.messages);
		const calls = llm.flatMap((m) => m.role === "assistant" ? m.content.filter((c) => c.type === "toolCall").map((c) => c.id) : []);
		const results = llm.filter((m) => m.role === "toolResult").map((m) => m.toolCallId);
		expect(results).toEqual(calls);
		const beforeGrowth = JSON.stringify(llm.slice(0, llm.findIndex((m) =>
			m.role === "user" && typeof m.content !== "string" &&
			m.content.some((c) => c.type === "text" && c.text.includes(b))) + 1));
		sm.appendMessage({ role: "user", content: "conversation after B", timestamp: 100 });
		const afterGrowth = await emit("context", { messages: sm.buildSessionProjection().messages }) as { messages: AgentMessage[] };
		const grownLlm = convertToLlm(afterGrowth.messages);
		const anchorIndex = grownLlm.findIndex((m) => m.role === "user" && typeof m.content !== "string" &&
			m.content.some((c) => c.type === "text" && c.text === b));
		expect(anchorIndex).toBeGreaterThan(-1);
		expect(JSON.stringify(grownLlm.slice(0, anchorIndex + 1))).toBe(beforeGrowth);
		expect(grownLlm.at(-1)).toMatchObject({ role: "user", content: "conversation after B" });
		expect(sm.getBranch().find((e: any) => e.id === promoted.id)).toMatchObject({
			type: "custom_message", customType: "corvus-v2a-state",
			details: { schemaVersion: 1, generation: 1,
				path: await import("node:fs/promises").then(({ realpath }) => realpath(path)),
				contentSha256: createHash("sha256").update(b).digest("hex") },
		});
	});

	it("does not promote an aborted/failed turn and re-supplies current state", async () => {
		const { path, sm, emit } = await setup();
		await writeFile(path, "B\n");
		await emit("context", { messages: sm.buildSessionProjection().messages });
		expect(await emit("turn_end", { outcome: "aborted" })).toBeUndefined();
		expect(await emit("turn_end", { outcome: "error" })).toBeUndefined();
		expect(sm.getBranch().some((e: any) => e.customType === "corvus-v2a-state")).toBe(false);
	});

	it("supports request-side durable-anchor supersession on B→C and promotes one C anchor", async () => {
		const { path, sm, emit } = await setup();
		await writeFile(path, "B\n");
		await emit("context", { messages: sm.buildSessionProjection().messages });
		const bDraft = (await emit("turn_end", { outcome: "completed" }) as any).entries[0];
		const b = await promote(sm, {} as ExtensionContext, bDraft);
		await writeFile(path, "C\n");
		const firstC = await emit("context", { messages: b.projection.messages }) as { messages: AgentMessage[] };
		expect(snapshotContent(firstC.messages, await import("node:fs/promises").then(({ realpath }) => realpath(path)))).toBe("C\n");
		expect(texts(firstC.messages)).toContain("superseded by a later authoritative state");
		expect(snapshotContent(firstC.messages, await import("node:fs/promises").then(({ realpath }) => realpath(path)))).toBe("C\n");
		expect(sm.getBranch().filter((e: any) => e.customType === "corvus-v2a-state")).toHaveLength(1);
		const cDraft = (await emit("turn_end", { outcome: "completed" }) as any).entries[0];
		expect(cDraft.details).toMatchObject({ generation: 2, supersedesAnchorEntryId: b.id });
		const c = await promote(sm, {} as ExtensionContext, cDraft);
		expect(c.raw.filter((e: any) => e.customType === "corvus-v2a-state")).toHaveLength(2);
		const next = await emit("context", { messages: c.projection.messages }) as { messages: AgentMessage[] };
		expect(texts(next.messages)).toContain("C\n");
		expect(texts(next.messages)).not.toContain("B\n");
		expect(texts(next.messages).match(/C\n/g)).toHaveLength(1);
		expect(next.messages.some((m) => m.role === "user" && Array.isArray(m.content) &&
			m.content.some((x) => x.type === "text" && x.text.includes("Current synchronized workspace files")))).toBe(false);
		const llm = convertToLlm(next.messages);
		const cIndex = llm.findIndex((m) => m.role === "user" && typeof m.content !== "string" &&
			m.content.some((x) => x.type === "text" && x.text === "C\n"));
		expect(cIndex).toBeGreaterThan(-1);
		const prefix = JSON.stringify(llm.slice(0, cIndex + 1));
		sm.appendMessage({ role: "user", content: "conversation after C", timestamp: 200 });
		const grown = await emit("context", { messages: sm.buildSessionProjection().messages }) as { messages: AgentMessage[] };
		const grownLlm = convertToLlm(grown.messages);
		const grownCIndex = grownLlm.findIndex((m) => m.role === "user" && typeof m.content !== "string" &&
			m.content.some((x) => x.type === "text" && x.text === "C\n"));
		expect(JSON.stringify(grownLlm.slice(0, grownCIndex + 1))).toBe(prefix);
		expect(grownLlm.at(-1)).toMatchObject({ role: "user", content: "conversation after C" });
	});

	it("does not resurrect original A after A→B→A and promotes a later generation", async () => {
		const { path, a, sm, emit } = await setup();
		await writeFile(path, "B\n");
		await emit("context", { messages: sm.buildSessionProjection().messages });
		const bDraft = (await emit("turn_end", { outcome: "completed" }) as any).entries[0];
		const b = await promote(sm, {} as ExtensionContext, bDraft);
		await writeFile(path, a);
		const returnedA = await emit("context", { messages: b.projection.messages }) as { messages: AgentMessage[] };
		expect(texts(returnedA.messages)).toContain("CORVUS synchronized read");
		expect(snapshotContent(returnedA.messages, await import("node:fs/promises").then(({ realpath }) => realpath(path)))).toBe(a);
		expect(texts(returnedA.messages)).not.toContain("A-CONTENT\n");
		const aDraft = (await emit("turn_end", { outcome: "completed" }) as any).entries[0];
		expect(aDraft.details).toMatchObject({ generation: 2, supersedesAnchorEntryId: b.id });
		const promotedA = await promote(sm, {} as ExtensionContext, aDraft);
		const nextA = await emit("context", { messages: promotedA.projection.messages }) as { messages: AgentMessage[] };
		expect(texts(nextA.messages)).toContain(a);
		expect(texts(nextA.messages)).toContain("CORVUS synchronized read");
		expect(snapshotContent(nextA.messages, await import("node:fs/promises").then(({ realpath }) => realpath(path)))).toBeUndefined();
	});

	it("lets a fresh complete current read outrank a durable anchor without duplicating state", async () => {
		const { path, sm, emit } = await setup();
		await writeFile(path, "B\n");
		await emit("context", { messages: sm.buildSessionProjection().messages });
		const draft = (await emit("turn_end", { outcome: "completed" }) as any).entries[0];
		const b = await promote(sm, {} as ExtensionContext, draft);
		const callId = "read-b-fresh";
		sm.appendMessage({
			role: "assistant", provider: "test", api: "test", model: "test",
			content: [{ type: "toolCall", id: callId, name: "read", arguments: { path } }],
			stopReason: "toolUse", timestamp: 20,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		});
		await emit("tool_result", { type: "tool_result", toolName: "read", toolCallId: callId,
			input: { path }, isError: false, content: [{ type: "text", text: "B\n" }] });
		sm.appendMessage({ role: "toolResult", toolCallId: callId, toolName: "read",
			content: [{ type: "text", text: "B\n" }], isError: false, timestamp: 21 });
		const output = await emit("context", { messages: sm.buildSessionProjection().messages }) as { messages: AgentMessage[] };
		expect(texts(output.messages)).toContain("B\n");
		expect(texts(output.messages)).toContain("CORVUS synchronized state superseded");
		expect(snapshotContent(output.messages, await import("node:fs/promises").then(({ realpath }) => realpath(path)))).toBeUndefined();
		expect(sm.getBranch().filter((e: any) => e.customType === "corvus-v2a-state")).toHaveLength(1);
		expect(b.raw.filter((e: any) => e.customType === "corvus-v2a-state")).toHaveLength(1);
	});
});
