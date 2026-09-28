import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { applyOperation, rebuild, synchronize, MAX_FILE_BYTES, MAX_REQUEST_BYTES } from "../index.ts";
import { createHash } from "node:crypto";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const state = () => rebuild([]);
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture(old = "old body", now = "new body") {
	const dir = await mkdtemp(join(tmpdir(), "corvus-"));
	dirs.push(dir);
	const path = join(dir, "a.ts");
	await writeFile(path, now);
	const s = state();
	applyOperation(s, { op: "read", path, observation: { id: "read-1", digest: hash(old) } });
	const messages = [
		{ role: "assistant", content: [
			{ type: "thinking", thinking: "opaque", thinkingSignature: "signed" },
			{ type: "text", text: "unchanged" },
			{ type: "toolCall", id: "read-1", name: "read", arguments: { path } },
			{ type: "toolCall", id: "bash-1", name: "bash", arguments: { command: "true" } },
		], provider: "openai", api: "openai-responses", model: "test", stopReason: "toolUse", timestamp: 1 },
		{ role: "toolResult", toolCallId: "read-1", toolName: "read", content: [{ type: "text", text: old }], isError: false, timestamp: 2 },
		{ role: "toolResult", toolCallId: "bash-1", toolName: "bash", content: [{ type: "text", text: "bash output" }], isError: false, timestamp: 3 },
	] as AgentMessage[];
	return { path, s, messages };
}
describe("CORVUS request-time synchronization", () => {
	it("keeps tool pairs and mixed assistant blocks; normalization does not fabricate missing results", async () => {
		const { s, messages } = await fixture();
		const out = await synchronize(messages, s);
		expect(JSON.stringify(out)).not.toContain("old body");
		expect(JSON.stringify(out).match(/new body/g)).toHaveLength(1);
		expect(out[0]).toEqual(messages[0]);
		expect(out[2]).toEqual(messages[2]);
		expect(messages[1]).toMatchObject({ content: [{ type: "text", text: "old body" }] });
		expect(out.filter((m) => m.role === "toolResult").map((m) => m.toolCallId)).toEqual(["read-1", "bash-1"]);
	});
	it("fails open when deleted or oversized, and disabled mode preserves identity", async () => {
		const { path, s, messages } = await fixture();
		await rm(path);
		expect(await synchronize(messages, s)).toBe(messages);
		await writeFile(path, "x".repeat(MAX_FILE_BYTES + 1));
		expect(await synchronize(messages, s)).toBe(messages);
		applyOperation(s, { op: "enabled", value: false });
		expect(await synchronize(messages, s)).toBe(messages);
	});
	it("replays branch-local state and evicts least recent files", async () => {
		const { path, s } = await fixture();
		expect(rebuild([{ type: "custom", customType: "corvus-v1", data: { op: "read", path, observation: { id: "read-1", digest: hash("old body") } } }])).toEqual(s);
		for (let i = 0; i < 12; i++) applyOperation(s, { op: "read", path: `${path}${i}`, observation: { id: `${i}`, digest: "" } });
		expect(s.files.some((f) => f.path === path)).toBe(false);
	});
	it("documents canonical compaction limitation: original history remains unchanged", async () => {
		const { s, messages } = await fixture();
		const canonical = JSON.stringify(messages);
		await synchronize(messages, s);
		expect(canonical).toContain("old body");
		expect(JSON.stringify(messages)).toBe(canonical);
	});
	it("synchronizes repeated reads only once per file and never elides a desynced or evicted result", async () => {
		const { path, s, messages } = await fixture();
		applyOperation(s, { op: "read", path, observation: { id: "read-2", digest: hash("old body") } });
		const second = { ...messages[1], toolCallId: "read-2" } as AgentMessage;
		const assistant = { ...messages[0], content: [
			...(messages[0].role === "assistant" ? messages[0].content : []),
			{ type: "toolCall" as const, id: "read-2", name: "read", arguments: { path } },
		] } as AgentMessage;
		const repeated = [assistant, messages[1], messages[2], second];
		const out = await synchronize(repeated, s);
		expect(JSON.stringify(out).match(/new body/g)).toHaveLength(1);
		expect(out.filter((m) => m.role === "toolResult").filter((m) =>
			JSON.stringify(m).includes("CORVUS synchronized"))).toHaveLength(2);
		applyOperation(s, { op: "drop", path });
		expect(await synchronize(repeated, s)).toBe(repeated);
	});
	it("prioritizes most recent files within aggregate budget without suppressing skipped file histories", async () => {
		const dir = await mkdtemp(join(tmpdir(), "corvus-budget-"));
		dirs.push(dir);
		const s = state();
		const messages: AgentMessage[] = [];
		for (let i = 0; i < 5; i++) {
			const path = join(dir, `${i}.txt`);
			const text = String(i).repeat(MAX_FILE_BYTES - 100);
			await writeFile(path, text);
			applyOperation(s, { op: "read", path, observation: { id: `r${i}`, digest: hash(text) } });
			messages.push({ role: "assistant", content: [{ type: "toolCall", id: `r${i}`, name: "read", arguments: { path } }],
				provider: "openai", api: "openai-responses", model: "test", stopReason: "toolUse", timestamp: i } as unknown as AgentMessage);
			messages.push({ role: "toolResult", toolCallId: `r${i}`, toolName: "read",
				content: [{ type: "text", text }], isError: false, timestamp: i });
		}
		const out = await synchronize(messages, s);
		const snapshots = out.at(-1);
		expect(snapshots?.role).toBe("user");
		if (snapshots?.role !== "user") throw new Error("missing snapshot");
		const snapshotText = JSON.stringify(snapshots.content);
		expect(Buffer.byteLength(snapshotText)).toBeLessThan(MAX_REQUEST_BYTES + 2000);
		expect(snapshotText).not.toContain("0".repeat(200));
		expect(snapshotText).toContain("4".repeat(200));
		expect(out[1]).toEqual(messages[1]);
		expect(JSON.stringify(out[9])).toContain("CORVUS synchronized");
	});
});
