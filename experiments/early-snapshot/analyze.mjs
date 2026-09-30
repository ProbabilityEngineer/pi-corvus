// Offline only; reconstruct even an aborted run from already captured artifacts.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const root = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Supply experiment root");
const json = value => JSON.stringify(value);
const labels = ["initial", "A-1", "A-2", "A-3", "B-1", "B-2", "B-3", "B-4", "C-1", "C-2", "C-3",
	"edits", "edit", "distinguish", "later-instruction", "history-reference", "return-A"];
const results = [];
for (let repetition = 1; repetition <= 2; repetition++) for (const placement of ["baseline", "tail", "fixed"]) {
	for (const workload of ["stable", "small-edits", "large-edits", "chronology"]) {
		const dir = join(root, `repeat-${repetition}`, placement, workload);
		if (!existsSync(join(dir, "requests.jsonl"))) continue;
		const requests = readFileSync(join(dir, "requests.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
		let offset = 0;
		const runs = [];
		for (const label of labels) {
			const filename = join(dir, `${label}.jsonl`);
			if (!existsSync(filename)) continue;
			const events = readFileSync(filename, "utf8").trim().split("\n").map(JSON.parse);
			const assistant = events.filter(e => e.type === "message_end" && e.message?.role === "assistant").map(e => e.message);
			const tools = events.filter(e => e.type === "tool_execution_start");
			const captured = requests.slice(offset, offset + assistant.length);
			offset += assistant.length;
			const sum = key => assistant.reduce((n, m) => n + (m.usage?.[key] ?? 0), 0);
			const response = assistant.at(-1)?.content.filter(c => c.type === "text").map(c => c.text).join(" ") ?? "";
			const expectedVersion = label.startsWith("A") || label === "initial" ? "V0" :
				label.startsWith("B") ? "V1" : label.startsWith("C") ? "V2" : null;
			runs.push({ label, requests: assistant.length, totalInput: sum("input") + sum("cacheRead"),
				uncached: sum("input"), cacheRead: sum("cacheRead"), output: sum("output"),
				cost: assistant.reduce((n, m) => n + (m.usage?.cost?.total ?? 0), 0),
				contextBytes: captured.reduce((n, r) => n + r.contextBytes, 0),
				inputBytes: captured.reduce((n, r) => n + r.inputBytes, 0),
				reads: tools.filter(t => t.toolName === "read").length, edits: tools.filter(t => t.toolName === "edit").length,
				response, expectedVersion, currentCorrect: expectedVersion ? response.includes(expectedVersion) : null,
				structure: captured.map(r => ({ snapshots: r.snapshots, authorities: r.authorities,
					diffItem: r.firstDifferingItem, diffPath: r.firstDifferingPath, diffByte: r.firstDifferingByte,
					allOutputsPaired: r.allOutputsPaired, uniqueOutputs: r.uniqueOutputs, repairPresent: r.repairPresent })),
			});
		}
		if (offset !== requests.length) throw new Error(`Request/event count mismatch: ${dir}`);
		const group = prefix => {
			const rows = runs.filter(r => prefix === "initial+A" ? r.label === "initial" || r.label.startsWith("A-") :
				prefix === "edits" ? r.label === "edits" : r.label.startsWith(`${prefix}-`));
			const keys = ["requests", "totalInput", "uncached", "cacheRead", "output", "cost", "contextBytes", "inputBytes", "reads", "edits"];
			return { rows: rows.length, ...Object.fromEntries(keys.map(k => [k, rows.reduce((n, r) => n + r[k], 0)])) };
		};
		const entry = { repetition, placement, workload, A: group("initial+A"), B: group("B"), C: group("C"), edits: group("edits"), runs };
		results.push(entry);
		console.log(json({ ...entry, runs: undefined }));
	}
}
writeFileSync(join(root, "analysis.json"), JSON.stringify(results, null, 2), { mode: 0o600 });
const fixed = results.find(r => r.placement === "fixed" && r.workload === "stable");
const B = fixed?.runs.filter(r => r.label.startsWith("B"));
console.log("Fixed B prefix identity:", new Set(B?.flatMap(r => r.structure.flatMap(s => s.snapshots.map(x => x.prefixHash)))).size === 1);
const C = fixed?.runs.find(r => r.label === "C-1");
console.log("Fixed C correctness:", C?.currentCorrect, "response:", C?.response);
for (const entry of results) {
	const reqs = readFileSync(join(root, `repeat-${entry.repetition}`, entry.placement, entry.workload, "requests.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
	const nonInput = payload => { const { input: _input, ...rest } = payload; return json(rest); };
	if (new Set(reqs.map(r => nonInput(r.payload))).size !== 1) throw new Error(`Non-input body changed: ${entry.placement}/${entry.workload}`);
}
console.log("Non-input provider body stable within every session.");
