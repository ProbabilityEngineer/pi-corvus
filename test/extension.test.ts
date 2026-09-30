import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import corvus, { MAX_FILE_BYTES, rebuild, synchronize } from "../index.ts";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

function harness(session: SessionManager) {
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
	const pi = {
		on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
			handlers.set(name, handler);
			return () => { handlers.delete(name); };
		},
		appendEntry: (name: string, data: unknown) => session.appendCustomEntry(name, data),
		registerCommand: () => {},
	} as unknown as ExtensionAPI;
	corvus(pi);
	const ctx = { cwd: session.getCwd(), sessionManager: session } as unknown as ExtensionContext;
	const emit = async (name: string, event: unknown = {}) => handlers.get(name)?.(event, ctx);
	return { emit, ctx };
}

async function fixture() {
	const dir = await mkdtemp(join(tmpdir(), "corvus-events-"));
	dirs.push(dir);
	const path = join(dir, "file.ts");
	const original = "const HISTORICAL_READ = 1;\n";
	await writeFile(path, original);
	const session = SessionManager.create(dir, join(dir, "sessions"));
	const app = harness(session);
	await app.emit("session_start");
	const call: AgentMessage = {
		role: "assistant", provider: "openai-codex", api: "openai-codex-responses", model: "test",
		content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path } }],
		stopReason: "toolUse", timestamp: 1,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
	const result: AgentMessage = { role: "toolResult", toolCallId: "read-1", toolName: "read",
		content: [{ type: "text", text: original }], isError: false, timestamp: 2 };
	const rootId = session.appendMessage(call);
	await app.emit("tool_result", { toolName: "read", toolCallId: "read-1", input: { path },
		isError: false, content: [{ type: "text", text: original }] });
	session.appendMessage(result);
	return { dir, path, original, session, app, rootId };
}

describe("CORVUS extension events and session persistence", () => {
	it("keeps the failing stale-persistence request safe and recovers on reload", async () => {
		const { path, original, session, app } = await fixture();
		const persist = session._persist.bind(session);
		session._persist = entry => {
			if (entry.type === "custom" && entry.customType === "corvus-v1" &&
				(entry.data as { op: string }).op === "stale") throw new Error("injected stale persistence failure");
			persist(entry);
		};
		await writeFile(path, "CURRENT_B\n");
		const raw = session.buildSessionContext().messages;
		const safe = (await app.emit("context", { messages: raw }) as { messages: AgentMessage[] }).messages;
		// Provider-visible authority, not merely an exception assertion.
		expect(JSON.stringify(safe)).not.toContain(original.trim());
		expect(JSON.stringify(safe)).toContain("superseded");
		expect(JSON.stringify(safe)).toContain("CURRENT_B");
		expect(rebuild(session.getBranch()).files[0].observations[0].stale).toBe(true);
		const reloaded = SessionManager.open(session.getSessionFile()!);
		expect(rebuild(reloaded.getBranch()).files[0].observations[0].stale).not.toBe(true);
		const resumed = harness(reloaded);
		await resumed.emit("session_start");
		expect(JSON.stringify(await resumed.emit("context", { messages: reloaded.buildSessionContext().messages })))
			.not.toContain(original.trim());
		session._persist = persist;
		await app.emit("context", { messages: raw });
		// Release gate: retry must be reachable after reload, not just appended
		// beneath an in-memory-only parent. This currently fails.
		expect(rebuild(SessionManager.open(session.getSessionFile()!).getBranch()).files[0].observations[0].stale).toBe(true);
	});
	it("records the lost-retirement limitation when disk returns to A before reload", async () => {
		const { path, original, session, app } = await fixture();
		const persist = session._persist.bind(session);
		session._persist = entry => {
			if (entry.type === "custom" && entry.customType === "corvus-v1" &&
				(entry.data as { op: string }).op === "stale") throw new Error("lost retirement");
			persist(entry);
		};
		await writeFile(path, "B\n");
		await app.emit("context", { messages: session.buildSessionContext().messages });
		await writeFile(path, original);
		const reload = SessionManager.open(session.getSessionFile()!);
		const resumed = harness(reload);
		await resumed.emit("session_start");
		const raw = reload.buildSessionContext().messages;
		// Observed limitation, not acceptance of weakened non-resurrection:
		// the lost B transition is indistinguishable from unchanged A on disk.
		expect((await resumed.emit("context", { messages: raw }) as { messages: AgentMessage[] }).messages).toBe(raw);
	});
	it("registers after successful complete reads; refreshes repeated reads and reconstructs on resume", async () => {
		const { path, original, session, app } = await fixture();
		expect(rebuild(session.getBranch()).files).toHaveLength(1);
		await app.emit("tool_result", { toolName: "read", toolCallId: "read-2", input: { path },
			isError: false, content: [{ type: "text", text: original }] });
		expect(rebuild(session.getBranch()).files[0].observations).toHaveLength(2);
		await writeFile(path, "const LATEST = 2;\n");
		const prior = session.buildSessionContext().messages;
		const transformed = await app.emit("context", { messages: prior }) as { messages: AgentMessage[] };
		expect(JSON.stringify(transformed)).toContain("LATEST");
		expect(JSON.stringify(transformed)).not.toContain("HISTORICAL_READ");
		expect(JSON.stringify(prior)).toContain("HISTORICAL_READ");
		const reopened = SessionManager.open(session.getSessionFile()!);
		const resumed = harness(reopened);
		await resumed.emit("session_start");
		expect(JSON.stringify(await resumed.emit("context", { messages: reopened.buildSessionContext().messages })))
			.toContain("LATEST");
	});
	it("persists stale authority retirement across resume and A→B→A without rewriting raw reads", async () => {
		const { path, original, session, app } = await fixture();
		const prior = session.buildSessionContext().messages;
		expect((await app.emit("context", { messages: prior }) as { messages: AgentMessage[] }).messages).toBe(prior);
		await writeFile(path, "EXTERNAL_B\n");
		await app.emit("context", { messages: prior });
		expect(rebuild(session.getBranch()).files[0].observations[0].stale).toBe(true);
		await writeFile(path, original);
		const reopened = SessionManager.open(session.getSessionFile()!);
		const resumed = harness(reopened);
		await resumed.emit("session_start");
		const out = (await resumed.emit("context", { messages: reopened.buildSessionContext().messages }) as { messages: AgentMessage[] }).messages;
		expect(JSON.stringify(out[1])).toContain("CORVUS synchronized");
		expect(out.filter(m => m.role === "user")).toHaveLength(1);
		expect(JSON.stringify(session.buildSessionContext().messages)).toContain("HISTORICAL_READ");
	});

	it("rejects error, image, offset/limit, binary and over-limit observations", async () => {
		const { path, session, app } = await fixture();
		const base = (id: string): ToolResultEvent => ({
			type: "tool_result", toolName: "read", toolCallId: id, input: { path },
			isError: false, content: [{ type: "text", text: "anything" }], details: undefined,
		});
		await app.emit("tool_result", { ...base("failed"), isError: true });
		await app.emit("tool_result", { ...base("image"), content: [{ type: "image", data: "AA==", mimeType: "image/png" }] });
		await app.emit("tool_result", { ...base("offset"), input: { path, offset: 1 } });
		await app.emit("tool_result", { ...base("limit"), input: { path, limit: 20 } });
		await writeFile(path, Buffer.from([0, 1, 2]));
		await app.emit("tool_result", base("binary"));
		await writeFile(path, "x".repeat(MAX_FILE_BYTES + 1));
		await app.emit("tool_result", base("oversized"));
		expect(rebuild(session.getBranch()).files[0].observations).toHaveLength(1);
	});

	it("fails open for missing, renamed and binary files without losing raw history", async () => {
		const { path, original, session, app } = await fixture();
		const baseline = session.buildSessionContext().messages;
		await rename(path, `${path}.moved`);
		const afterRename = await app.emit("context", { messages: baseline }) as { messages: AgentMessage[] };
		expect(afterRename.messages).toBe(baseline);
		await writeFile(path, Buffer.from([0, 1]));
		expect((await app.emit("context", { messages: baseline }) as { messages: AgentMessage[] }).messages).toBe(baseline);
		expect((await readFile(session.getSessionFile()!, "utf8"))).toContain("HISTORICAL_READ");
		expect(JSON.stringify(baseline)).toContain(original.trim());
	});

	it("isolates tree branches and forked sessions from sibling registrations", async () => {
		const { dir, path, session, app, rootId } = await fixture();
		const registeredLeaf = session.getLeafId()!;
		const forkPath = session.createBranchedSession(registeredLeaf)!;
		const fork = SessionManager.open(forkPath);
		const forkApp = harness(fork);
		await forkApp.emit("session_start");
		expect(rebuild(fork.getBranch()).files).toHaveLength(1);
		session.branch(rootId);
		await app.emit("session_tree");
		expect(rebuild(session.getBranch()).files).toHaveLength(0);
		const sibling = join(dir, "sibling.ts");
		await writeFile(sibling, "sibling\n");
		await app.emit("tool_result", { toolName: "read", toolCallId: "sibling", input: { path: sibling },
			isError: false, content: [{ type: "text", text: "sibling\n" }] });
		expect(rebuild(session.getBranch()).files.map((f) => f.path)).toEqual([await realpath(sibling)]);
		session.branch(registeredLeaf);
		await app.emit("session_tree");
		expect(rebuild(session.getBranch()).files.map((f) => f.path)).toEqual([await realpath(path)]);
	});
	it("passes the original request context through when the extension transform fails", async () => {
		const { app } = await fixture();
		const broken = new Proxy([] as AgentMessage[], {
			get(target, key, receiver) {
				if (key === Symbol.iterator) throw new Error("unexpected context transform error");
				return Reflect.get(target, key, receiver);
			},
		});
		expect((await app.emit("context", { messages: broken }) as { messages: AgentMessage[] }).messages).toBe(broken);
	});
	it("coexists with a non-destructive context transform in either load order", async () => {
		const { session, app } = await fixture();
		const messages = session.buildSessionContext().messages;
		const other = (items: AgentMessage[]) => [...items, { role: "user" as const, content: "OTHER_EXTENSION", timestamp: 4 }];
		const first = (await app.emit("context", { messages: other(messages) }) as { messages: AgentMessage[] }).messages;
		const second = other((await app.emit("context", { messages }) as { messages: AgentMessage[] }).messages);
		for (const output of [first, second]) {
			expect(JSON.stringify(output).match(/OTHER_EXTENSION/g)).toHaveLength(1);
			expect(JSON.stringify(output)).not.toContain("Current synchronized workspace files");
			expect(JSON.stringify(output).match(/HISTORICAL_READ/g)).toHaveLength(1);
		}
	});
});
