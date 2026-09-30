import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import corvus, { rebuild } from "../index.ts";
import v2a, { createAnchorDraft, resolveV2aRequest } from "../experiments/v2-single-anchor/extension.ts";

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

async function genuineV1Files(names: string[]) {
	const cwd = await mkdtemp(join(tmpdir(), "corvus-v2a-multi-"));
	dirs.push(cwd);
	const session = SessionManager.create(cwd, join(cwd, "sessions"));
	const handlers = new Map<string, (event: any, ctx: ExtensionContext) => unknown>();
	const pi = {
		on: (name: string, handler: (event: any, ctx: ExtensionContext) => unknown) => {
			handlers.set(name, handler);
			return () => handlers.delete(name);
		},
		appendEntry: (name: string, data: unknown) => session.appendCustomEntry(name, data),
		registerCommand: () => {},
	} as unknown as ExtensionAPI;
	corvus(pi);
	const ctx = { cwd, sessionManager: session } as unknown as ExtensionContext;
	const emit = (name: string, event: any = {}) => handlers.get(name)?.(event, ctx);
	await emit("session_start");
	const files = [];
	for (const name of names) {
		const path = join(cwd, name);
		const originalPath = name;
		const content = `${name}-0\n`;
		await writeFile(path, content);
		const id = `read-${name}`;
		session.appendMessage({
			role: "assistant", provider: "test", api: "test", model: "test",
			content: [{ type: "toolCall", id, name: "read", arguments: { path: originalPath } }],
			stopReason: "toolUse", timestamp: 1,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		});
		await emit("tool_result", { type: "tool_result", toolName: "read", toolCallId: id,
			input: { path: originalPath }, isError: false, content: [{ type: "text", text: content }] });
		session.appendMessage({ role: "toolResult", toolCallId: id, toolName: "read",
			content: [{ type: "text", text: content }], isError: false, timestamp: 2 });
		files.push({ path, originalPath, resolved: resolve(cwd, originalPath),
			canonical: await import("node:fs/promises").then(({ realpath }) => realpath(path)), content, id });
	}
	return { cwd, session, ctx, emit, files };
}

async function appendObservedRead(
	f: Awaited<ReturnType<typeof genuineV1Files>>,
	file: Awaited<ReturnType<typeof genuineV1Files>>["files"][number],
	id: string,
	content: string,
) {
	f.session.appendMessage({
		role: "assistant", provider: "test", api: "test", model: "test",
		content: [{ type: "toolCall", id, name: "read", arguments: { path: file.originalPath } }],
		stopReason: "toolUse", timestamp: Date.now(),
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	});
	await f.emit("tool_result", { type: "tool_result", toolName: "read", toolCallId: id,
		input: { path: file.originalPath }, isError: false, content: [{ type: "text", text: content }] });
	f.session.appendMessage({ role: "toolResult", toolCallId: id, toolName: "read",
		content: [{ type: "text", text: content }], isError: false, timestamp: Date.now() });
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

	it("filters combined tails per synchronized path and preserves V1 framing", async () => {
		const f = await genuineV1Files(["A.ts", "B.ts", "C.ts"]);
		const [a, b, c] = f.files;
		const registered = rebuild(f.session.getBranch());
		expect(registered.files.map((x) => x.path).sort()).toEqual([a.canonical, b.canonical, c.canonical].sort());
		expect(registered.files.every((x) => x.observations.length === 1)).toBe(true);
		expect(a.resolved).toBe(a.path);
		expect(registered.files.map((x) => x.path)).toContain(a.canonical);

		const snapshotsOf = (messages: AgentMessage[]) => {
			const message = messages.at(-1);
			if (!message || message.role !== "user" || !Array.isArray(message.content)) return [];
			const block = message.content.find((x) => x.type === "text" && x.text.startsWith("Current synchronized workspace files"));
			if (!block || block.type !== "text") return [];
			return JSON.parse(block.text.slice(block.text.indexOf("\n") + 1)) as Array<{ path: string; content: string }>;
		};
		const addAnchor = async (file: typeof a, content: string, generation?: number) => {
			await writeFile(file.path, content);
			const draft = await createAnchorDraft({ path: file.canonical, content }, f.ctx);
			expect(draft).toMatchObject({
				type: "custom_message", customType: "corvus-v2a-state", content,
				details: { path: file.canonical, generation: generation ?? 1 },
			});
			if (!draft || draft.type !== "custom_message") throw new Error("V2a anchor draft missing");
			const id = f.session.appendCustomMessageEntry(draft.customType, draft.content, draft.display, draft.details);
			return f.session.getEntry(id)!;
		};
		const syncV1 = async () => {
			const source = f.session.buildSessionProjection().messages;
			const result = await f.emit("context", { messages: source }) as { messages: AgentMessage[] };
			return { source, messages: result.messages };
		};
		const resolve = async (source: AgentMessage[], v1Output: AgentMessage[]) =>
			(await resolveV2aRequest(v1Output, rebuild(f.session.getBranch()), f.ctx, true, source)).messages;
		const assertAuthority = (messages: AgentMessage[], expected: Map<string, string>) => {
			const tails = snapshotsOf(messages);
			for (const [path, content] of expected) {
				const anchorCount = messages.filter((m) => m.role === "custom" &&
					m.customType === "corvus-v2a-state" && m.details &&
					(m.details as any).path === path && m.content === content).length;
				const tailCount = tails.filter((x) => x.path === path && x.content === content).length;
				const count = anchorCount + tailCount;
				expect(count, `${path}: expected 1 current authority, observed ${count}`).toBe(1);
			}
		};

		// Durable A1 + V1-generated [A1,B1] must retain only B1 in the V1 tail.
		await writeFile(a.path, "A1\n");
		await writeFile(b.path, "B1\n");
		const preAnchor = await syncV1();
		expect(snapshotsOf(preAnchor.messages)).toEqual([
			{ path: a.canonical, content: "A1\n" },
			{ path: b.canonical, content: "B1\n" },
		]);
		const anchorA1 = await addAnchor(a, "A1\n");
		const afterAnchor = await syncV1();
		const filteredAB = await resolve(afterAnchor.source, afterAnchor.messages);
		expect(snapshotsOf(filteredAB)).toEqual([{ path: b.canonical, content: "B1\n" }]);
		assertAuthority(filteredAB, new Map([[a.canonical, "A1\n"], [b.canonical, "B1\n"]]));
		expect(filteredAB.some((m) => m.role === "custom" && m.customType === "corvus-v2a-state" &&
			(m.details as any).path === a.canonical)).toBe(true);
		expect(texts(filteredAB)).not.toContain("A.ts-0\n");
		expect(texts(filteredAB)).not.toContain("B.ts-0\n");
		expect(f.session.getBranch().find((e) => e.id === anchorA1.id)).toMatchObject({
			type: "custom_message", customType: "corvus-v2a-state",
			details: { path: a.canonical, generation: 1 },
		});

		// Durable A1 + tail B1 + durable C1; retained-tail framing preserves B1.
		await writeFile(c.path, "C1\n");
		const anchorC1 = await addAnchor(c, "C1\n");
		const withC = await syncV1();
		const filteredABC = await resolve(withC.source, withC.messages);
		expect(snapshotsOf(filteredABC)).toEqual([{ path: b.canonical, content: "B1\n" }]);
		assertAuthority(filteredABC, new Map([[a.canonical, "A1\n"], [b.canonical, "B1\n"], [c.canonical, "C1\n"]]));
		expect(f.session.getBranch().find((e) => e.id === anchorC1.id)).toBeDefined();

		// Both paths covered: keep both chronological anchors and remove the
		// redundant V1 combined snapshot entirely.
		const anchorB1 = await addAnchor(b, "B1\n");
		const bothCovered = await syncV1();
		const filteredBoth = await resolve(bothCovered.source, bothCovered.messages);
		expect(snapshotsOf(filteredBoth)).toEqual([]);
		assertAuthority(filteredBoth, new Map([
			[a.canonical, "A1\n"], [b.canonical, "B1\n"], [c.canonical, "C1\n"],
		]));
		expect(f.session.getBranch().find((e) => e.id === anchorB1.id)).toBeDefined();

		// A stale durable A1 cannot suppress current tail A2 or uncovered B1.
		const stale = await genuineV1Files(["stale-A.ts", "stale-B.ts"]);
		const [sa, sb] = stale.files;
		await writeFile(sa.path, "A1\n");
		const staleAnchor = await createAnchorDraft({ path: sa.canonical, content: "A1\n" }, stale.ctx);
		if (!staleAnchor || staleAnchor.type !== "custom_message") throw new Error("missing A1 anchor");
		stale.session.appendCustomMessageEntry(staleAnchor.customType, staleAnchor.content,
			staleAnchor.display, staleAnchor.details);
		await writeFile(sa.path, "A2\n");
		await writeFile(sb.path, "B1\n");
		const staleSource = stale.session.buildSessionProjection().messages;
		const staleV1 = await stale.emit("context", { messages: staleSource }) as { messages: AgentMessage[] };
		const staleFiltered = (await resolveV2aRequest(staleV1.messages, rebuild(stale.session.getBranch()),
			stale.ctx, true, staleSource)).messages;
		const staleSnapshots = snapshotsOf(staleFiltered);
		expect(staleSnapshots).toEqual([
			{ path: sa.canonical, content: "A2\n" },
			{ path: sb.canonical, content: "B1\n" },
		]);
		expect(texts(staleFiltered)).toContain("synchronized state superseded");

		// A fresh complete A read is authoritative while B still needs a V1 tail.
		const fresh = await genuineV1Files(["fresh-A.ts", "fresh-B.ts"]);
		const [fa, fb] = fresh.files;
		await writeFile(fa.path, "A1\n");
		const faAnchor = await createAnchorDraft({ path: fa.canonical, content: "A1\n" }, fresh.ctx);
		if (!faAnchor || faAnchor.type !== "custom_message") throw new Error("missing fresh A anchor");
		fresh.session.appendCustomMessageEntry(faAnchor.customType, faAnchor.content, faAnchor.display, faAnchor.details);
		await appendObservedRead(fresh, fa, "fresh-read-A1", "A1\n");
		await writeFile(fb.path, "B1\n");
		const freshSource = fresh.session.buildSessionProjection().messages;
		const freshV1 = await fresh.emit("context", { messages: freshSource }) as { messages: AgentMessage[] };
		const freshFiltered = (await resolveV2aRequest(freshV1.messages, rebuild(fresh.session.getBranch()),
			fresh.ctx, true, freshSource)).messages;
		expect(snapshotsOf(freshFiltered)).toEqual([{ path: fb.canonical, content: "B1\n" }]);
		expect(freshFiltered.some((m) => m.role === "toolResult" && m.toolCallId === "fresh-read-A1" &&
			m.content[0].type === "text" && m.content[0].text === "A1\n")).toBe(true);
		expect(freshFiltered.some((m) => m.role === "custom" && m.customType === "corvus-v2a-state" &&
			(m.details as any).path === fa.canonical && m.content === "A1\n")).toBe(false);

		// A refresh failure for A remains fail-open and does not remove B1.
		const failed = await genuineV1Files(["deleted-A.ts", "live-B.ts"]);
		const [da, lb] = failed.files;
		await writeFile(da.path, "A1\n");
		const daAnchor = await createAnchorDraft({ path: da.canonical, content: "A1\n" }, failed.ctx);
		if (!daAnchor || daAnchor.type !== "custom_message") throw new Error("missing deleted A anchor");
		failed.session.appendCustomMessageEntry(daAnchor.customType, daAnchor.content, daAnchor.display, daAnchor.details);
		await rm(da.path);
		await writeFile(lb.path, "B1\n");
		const failedSource = failed.session.buildSessionProjection().messages;
		const failedV1 = await failed.emit("context", { messages: failedSource }) as { messages: AgentMessage[] };
		const failedFiltered = (await resolveV2aRequest(failedV1.messages, rebuild(failed.session.getBranch()),
			failed.ctx, true, failedSource)).messages;
		expect(snapshotsOf(failedFiltered)).toEqual([{ path: lb.canonical, content: "B1\n" }]);
		expect(failedFiltered.some((m) => m.role === "custom" && m.customType === "corvus-v2a-state" &&
			(m.details as any).path === da.canonical && m.content === "A1\n")).toBe(true);

		// No durable coverage: actual V1 combined output is retained unchanged.
		const empty = await genuineV1Files(["X.ts", "Y.ts"]);
		const [x, y] = empty.files;
		await writeFile(x.path, "X1\n");
		await writeFile(y.path, "Y1\n");
		const rawState = rebuild(empty.session.getBranch());
		const rawMessages = empty.session.buildSessionProjection().messages;
		const v1Only = await empty.emit("context", { messages: rawMessages }) as { messages: AgentMessage[] };
		expect(snapshotsOf(v1Only.messages)).toEqual([
			{ path: x.canonical, content: "X1\n" },
			{ path: y.canonical, content: "Y1\n" },
		]);
		const uncovered = (await resolveV2aRequest(v1Only.messages, rawState, empty.ctx, true, rawMessages)).messages;
		expect(uncovered).toEqual(v1Only.messages);
		expect(snapshotsOf(uncovered)).toEqual(snapshotsOf(v1Only.messages));

		// Framing-looking ordinary user content is not a V1-generated tail.
		const ordinaryFixture = await genuineV1Files(["ordinary.ts"]);
		const ordinary = [...ordinaryFixture.session.buildSessionProjection().messages, {
			role: "user",
			content: `Current synchronized workspace files (request-time; authoritative for these paths; JSON-encoded content):\n[{"path":"bogus","content":"x"}]`,
			timestamp: 99,
		} as AgentMessage];
		const ordinaryResult = await ordinaryFixture.emit("context", { messages: ordinary }) as { messages: AgentMessage[] };
		const untouched = (await resolveV2aRequest(ordinaryResult.messages, rebuild(ordinaryFixture.session.getBranch()),
			ordinaryFixture.ctx, true, ordinary)).messages;
		expect(untouched).toEqual(ordinaryResult.messages);
		expect(untouched.at(-1)).toEqual(ordinary.at(-1));
	});
});
