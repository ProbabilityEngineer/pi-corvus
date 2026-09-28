/**
 * Synthetic request-time byte benchmark; run:
 * npm run bench
 * Measures serialized message bytes, not provider tokens or task success.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { applyOperation, rebuild, synchronize } from "../index.ts";

const dir = await mkdtemp(join(tmpdir(), "corvus-bench-"));
try {
	const path = join(dir, "source.ts");
	const text = "export const answer = 42;\n".repeat(100);
	await writeFile(path, text);
	const state = rebuild([]);
	const messages: AgentMessage[] = [];
	const hash = createHash("sha256").update(text).digest("hex");
	for (let i = 0; i < 20; i++) {
		const id = `read-${i}`;
		messages.push({ role: "assistant", content: [{ type: "toolCall", id, name: "read", arguments: { path } }], provider: "openai", api: "openai-responses", model: "test", stopReason: "toolUse", timestamp: i } as unknown as AgentMessage);
		messages.push({ role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text }], isError: false, timestamp: i } as AgentMessage);
		applyOperation(state, { op: "read", path, observation: { id, digest: hash } });
	}
	let baseline = 0, enabled = 0;
	for (let i = 0; i < 10; i++) {
		baseline += Buffer.byteLength(JSON.stringify(messages));
		enabled += Buffer.byteLength(JSON.stringify(await synchronize(messages, state)));
	}
	console.log(JSON.stringify({ requests: 10, baselineSerializedBytes: baseline, enabledSerializedBytes: enabled, deltaBytes: baseline - enabled, caveat: "Synthetic message bytes only; no provider token/cache or compaction measurements" }, null, 2));
} finally { await rm(dir, { recursive: true, force: true }); }
