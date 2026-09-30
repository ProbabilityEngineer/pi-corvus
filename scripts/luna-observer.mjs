// Read-only request instrumentation. Captures only disposable fixture inputs, not auth.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
export default function observer(pi) {
	const dir = process.env.CORVUS_COST_TRACE;
	if (!dir) throw new Error("CORVUS_COST_TRACE required");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const write = value => appendFileSync(join(dir, "requests.jsonl"), `${JSON.stringify(value)}\n`, { mode: 0o600 });
	let contextBytes;
	pi.on("context", event => { contextBytes = Buffer.byteLength(JSON.stringify(event.messages)); });
	pi.on("before_provider_request", (event, ctx) => {
		const input = event.payload?.input ?? [];
		const calls = input.filter(item => item.type === "function_call");
		const outputs = input.filter(item => item.type === "function_call_output");
		const readIds = new Set(calls.filter(item => item.name === "read").map(item => item.call_id));
		const current = readFileSync(join(ctx.cwd, "a.ts"), "utf8");
		const snapshots = input.flatMap(item => (item.content ?? []).flatMap(block => {
			if (typeof block.text !== "string" || !block.text.startsWith("Current synchronized workspace files")) return [];
			return JSON.parse(block.text.slice(block.text.indexOf("\n") + 1));
		}));
		const authoritativeCopies = outputs.filter(item => readIds.has(item.call_id) && item.output === current).length +
			snapshots.filter(item => item.content === current).length;
		write({ contextBytes, inputBytes: Buffer.byteLength(JSON.stringify(input)), input,
			payload: event.payload,
			readCalls: readIds.size, authoritativeCopies,
			allOutputsPaired: outputs.every(item => calls.some(call => call.call_id === item.call_id)),
			repairPresent: JSON.stringify(input).includes("No result provided") });
	});
}
