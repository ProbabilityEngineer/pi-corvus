// Read-only instrumentation; use after the sole selected context-transformer.
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
const sha = text => createHash("sha256").update(text).digest("hex");
const json = value => JSON.stringify(value);
const firstDifference = (a, b, path = "$") => {
	if (json(a) === json(b)) return null;
	if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return path;
	for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
		const result = firstDifference(a[key], b[key], `${path}.${key}`);
		if (result) return result;
	}
	return path;
};
export default function observer(pi) {
	const dir = process.env.CORVUS_EARLY_TRACE;
	if (!dir) throw new Error("CORVUS_EARLY_TRACE required");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const write = value => appendFileSync(join(dir, "requests.jsonl"), `${json(value)}\n`, { mode: 0o600 });
	let contextBytes;
	pi.on("context", event => { contextBytes = Buffer.byteLength(json(event.messages)); });
	let previous;
	pi.on("before_provider_request", (event, ctx) => {
		const canonical = path => {
			try { return realpathSync(resolve(ctx.cwd, path)); } catch { return resolve(ctx.cwd, path); }
		};
		const input = event.payload?.input ?? [];
		// Resume logical comparison across print-mode processes without modifying requests.
		if (!previous) {
			try { previous = JSON.parse(readFileSync(join(dir, "requests.jsonl"), "utf8").trim().split("\n").at(-1)).payload; } catch { /* first request */ }
		}
		const calls = input.filter(item => item.type === "function_call");
		const outputs = input.filter(item => item.type === "function_call_output");
		const snapshotItems = input.flatMap((item, index) => (item.content ?? []).flatMap(block => {
			if (typeof block.text !== "string" || !block.text.startsWith("Current synchronized workspace files")) return [];
			return [{ index, itemHash: sha(json(item)), files: JSON.parse(block.text.slice(block.text.indexOf("\n") + 1)) }];
		}));
		const snapshots = snapshotItems.flatMap(s => s.files);
		const reminders = input.flatMap((item, index) => (item.content ?? []).flatMap(block =>
			typeof block.text === "string" && block.text.startsWith("[CORVUS temporal-authority reminder]")
				? [{ index, text: block.text, hash: sha(json(item)) }] : []));
		const paths = new Set([...snapshots.map(f => f.path), ...calls.filter(c => c.name === "read").flatMap(c => {
			try { return [canonical(JSON.parse(c.arguments).path)]; } catch { return []; }
		})]);
		const authorities = [...paths].map(path => {
			let current;
			try { current = readFileSync(path, "utf8"); } catch { return { path, refreshFailed: true }; }
			const readIds = new Set(calls.filter(c => c.name === "read").flatMap(c => {
				try { return canonical(JSON.parse(c.arguments).path) === path ? [c.call_id] : []; } catch { return []; }
			}));
			// Paths may have symlink/canonical spellings; fixture contents are distinct.
			return { path, currentHash: sha(current), currentBytes: Buffer.byteLength(current),
				copies: outputs.filter(o => readIds.has(o.call_id) && o.output === current).length + snapshots.filter(f => f.path === path && f.content === current).length,
				staleBodies: outputs.filter(o => readIds.has(o.call_id) && typeof o.output === "string" && o.output !== current && !o.output.startsWith("[CORVUS synchronized read:")).length };
		});
		let differingItem = 0;
		if (previous) while (differingItem < Math.min(previous.input.length, input.length) &&
			json(previous.input[differingItem]) === json(input[differingItem])) differingItem++;
		const wire = json(event.payload), old = previous ? json(previous) : "";
		let byte = 0;
		if (previous) {
			const x = Buffer.from(wire), y = Buffer.from(old);
			while (byte < Math.min(x.length, y.length) && x[byte] === y[byte]) byte++;
		}
		const stableFields = Object.fromEntries(Object.entries(event.payload).filter(([key]) => key !== "input"));
		const row = { payload: event.payload, contextBytes, inputBytes: Buffer.byteLength(json(input)), payloadBytes: Buffer.byteLength(wire),
			reminders, stableFieldsHash: sha(json(stableFields)),
			firstDifferingItem: previous ? differingItem : null,
			firstDifferingPath: previous ? firstDifference(previous, event.payload) : null, firstDifferingByte: previous ? byte : null,
			snapshots: snapshotItems.map(s => ({ index: s.index, itemHash: s.itemHash,
				prefixHash: sha(json(input.slice(0, s.index + 1))), precedingItems: s.index,
				completePrefixHash: sha(json({ ...stableFields, input: input.slice(0, s.index + 1) })),
				precedingBytes: Buffer.byteLength(json(input.slice(0, s.index))),
				files: s.files.map(f => ({ path: f.path, hash: sha(f.content), bytes: Buffer.byteLength(f.content) })) })),
			authorities, allOutputsPaired: outputs.every(o => calls.filter(c => c.call_id === o.call_id).length === 1),
			uniqueOutputs: new Set(outputs.map(o => o.call_id)).size === outputs.length,
			repairPresent: json(input).includes("No result provided") };
		write(row);
		previous = event.payload;
	});
}
