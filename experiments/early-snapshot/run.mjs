// Preregistered bounded LIVE experiment. Does not modify released CORVUS.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../../", import.meta.url));
const root = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Supply existing preserved experiment root");
if (existsSync(join(root, "repeat-1"))) throw new Error("Refusing to overwrite/repeat an already-started experiment");
const filler = "// measured source context, stable non-secret line 0123456789 abcdefghijklmnopqrstuvwxyz\n";
const body = (bytes, version) => `export const version = "${version}";\n${filler.repeat(Math.ceil(bytes / filler.length)).slice(0, bytes - 30)}\n`;
const common = ["--mode", "json", "-p", "--offline", "--approve", "--no-extensions", "--no-skills",
	"--no-prompt-templates", "--no-themes", "--no-context-files", "--model", "openai-codex/gpt-6-luna",
	"--thinking", "minimal", "--tools", "read,edit"];
const all = [];
function arm(dir, placement, bytes = 38000) {
	mkdirSync(join(dir, "sessions"), { recursive: true });
	mkdirSync(join(dir, ".pi"), { recursive: true });
	writeFileSync(join(dir, ".pi/settings.json"), JSON.stringify({ compaction: { enabled: false } }));
	writeFileSync(join(dir, "a.ts"), body(bytes, "V0"));
	const extension = placement === "tail" ? join(repo, "index.ts") :
		placement === "fixed" ? join(repo, "experiments/early-snapshot/extension.ts") : undefined;
	const extensions = extension ? ["--extension", extension] : [];
	extensions.push("--extension", join(repo, "experiments/early-snapshot/observer.mjs"));
	let session;
	const runs = [];
	const invoke = (label, prompt, expectedVersion, expectedTools) => {
		const output = execFileSync("pi", [...common,
			...(session ? ["--session", session] : ["--session-dir", join(dir, "sessions")]), ...extensions, prompt], {
			cwd: dir, encoding: "utf8", timeout: 900000, maxBuffer: 100 * 1024 * 1024,
			env: { ...process.env, CORVUS_EARLY_TRACE: dir } });
		writeFileSync(join(dir, `${label}.jsonl`), output, { mode: 0o600 });
		const events = output.trim().split("\n").map(JSON.parse);
		const messages = events.filter(e => e.type === "message_end" && e.message?.role === "assistant").map(e => e.message);
		const tools = events.filter(e => e.type === "tool_execution_start");
		if (messages.some(m => m.stopReason === "error")) throw new Error(`Provider error: ${dir}/${label}`);
		if (tools.some(e => e.toolName === "read" && (e.args.offset != null || e.args.limit != null))) throw new Error(`Partial read: ${dir}/${label}`);
		if (expectedTools !== undefined && tools.length !== expectedTools) throw new Error(`Tool behavior mismatch: ${dir}/${label}: ${tools.length}`);
		if (events.some(e => e.type.includes("compaction"))) throw new Error(`Compaction: ${dir}/${label}`);
		session ??= join(dir, "sessions", readdirSync(join(dir, "sessions")).find(f => f.endsWith(".jsonl")));
		const canonical = readFileSync(session, "utf8").trim().split("\n").map(JSON.parse);
		const canonicalMessages = canonical.filter(e => e.type === "message").map(e => e.message);
		if (canonicalMessages.some(m => m.role === "toolResult" && JSON.stringify(m).includes("[CORVUS synchronized read:")) ||
			canonicalMessages.some(m => m.role === "user" && JSON.stringify(m).includes("Current synchronized workspace files (request-time;"))) throw new Error(`Canonical mutation: ${dir}`);
		const requests = readFileSync(join(dir, "requests.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
		if (requests.some(r => !r.allOutputsPaired || !r.uniqueOutputs || r.repairPresent ||
			(placement !== "baseline" && r.authorities.some(a => !a.refreshFailed && (a.copies !== 1 || a.staleBodies !== 0))))) throw new Error(`Provider authority/pairing: ${dir}`);
		const response = messages.at(-1)?.content.filter(c => c.type === "text").map(c => c.text).join(" ") ?? "";
		const currentCorrect = expectedVersion === undefined ? null : response.includes(expectedVersion);
		if (placement !== "baseline" && currentCorrect === false) throw new Error(`Current answer incorrect: ${dir}/${label}: ${response}`);
		const sum = key => messages.reduce((n, m) => n + (m.usage?.[key] ?? 0), 0);
		const before = runs.reduce((n, r) => n + r.requests, 0);
		const captured = requests.slice(before);
		const row = { label, requests: messages.length, totalInput: sum("input") + sum("cacheRead"),
			uncached: sum("input"), cacheRead: sum("cacheRead"), output: sum("output"),
			cost: messages.reduce((n, m) => n + (m.usage?.cost?.total ?? 0), 0),
			contextBytes: captured.reduce((n, r) => n + r.contextBytes, 0),
			inputBytes: captured.reduce((n, r) => n + r.inputBytes, 0),
			reads: tools.filter(t => t.toolName === "read").length, edits: tools.filter(t => t.toolName === "edit").length,
			response, expectedVersion, currentCorrect,
			snapshotIndices: captured.map(r => r.snapshots.map(s => s.index)),
			snapshotHashes: captured.map(r => r.snapshots.map(s => s.itemHash)),
			prefixHashes: captured.map(r => r.snapshots.map(s => s.prefixHash)),
			differences: captured.map(r => ({ item: r.firstDifferingItem, path: r.firstDifferingPath, byte: r.firstDifferingByte })),
			authorities: captured.map(r => r.authorities.map(a => ({ copies: a.copies, staleBodies: a.staleBodies }))),
		};
		runs.push(row);
		writeFileSync(join(dir, "summary.json"), JSON.stringify({ placement, bytes, runs }, null, 2), { mode: 0o600 });
		return row;
	};
	const change = version => writeFileSync(join(dir, "a.ts"), body(bytes, version));
	return { invoke, change, runs };
}
for (let repetition = 1; repetition <= 2; repetition++) {
	const order = repetition === 1 ? ["baseline", "tail", "fixed"] : ["fixed", "baseline", "tail"];
	for (const placement of order) {
		const dir = join(root, `repeat-${repetition}`, placement, "stable");
		const a = arm(dir, placement);
		a.invoke("initial", 'Use built-in read exactly once with path "a.ts" only; omit offset and limit. Do not edit. Report version.', "V0", 1);
		for (let i = 1; i <= 3; i++) a.invoke(`A-${i}`, "Without tools, report current version in a.ts. The file has not changed. Reply only its value.", "V0", 0);
		a.change("V1");
		for (let i = 1; i <= 4; i++) a.invoke(`B-${i}`, "The file was externally updated before this series. Without tools, report its current version from authoritative synchronized contents. Reply only its value.", "V1", 0);
		a.change("V2");
		for (let i = 1; i <= 3; i++) a.invoke(`C-${i}`, "The file was externally updated again before this series. Without tools, report its current version from authoritative synchronized contents. Reply only its value.", "V2", 0);
		all.push({ repetition, placement, workload: "stable", runs: a.runs });
		console.log(repetition, placement, "stable completed");
		for (const [name, bytes, cycles] of [["small-edits", 700, 4], ["large-edits", 38000, 2]]) {
			const e = arm(join(root, `repeat-${repetition}`, placement, name), placement, bytes);
			const sequence = Array.from({ length: cycles }, (_, i) => `Cycle ${i + 1}: built-in read with only path "a.ts", no offset or limit; then built-in edit to change only V${i} to V${i + 1}.`).join("\n");
			e.invoke("edits", `Perform this exact sequence, no bash, no skipped reads or edits. Report final version V${cycles} and stop.\n${sequence}`, `V${cycles}`, cycles * 2);
			all.push({ repetition, placement, workload: name, runs: e.runs });
			console.log(repetition, placement, name, "completed");
		}
	}
	// Separate genuine model edit + chronology/precedence evaluation; no outcome tuning.
	const h = arm(join(root, `repeat-${repetition}`, "fixed", "chronology"), "fixed");
	h.invoke("edit", 'Use built-in read with path "a.ts" only (no offset/limit), then built-in edit changing only V0 to V1. This read represents historical A; the edit establishes B. Report final version.', "V1", 2);
	const parse = row => JSON.parse(row.response.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
	const distinction = parse(h.invoke("distinguish", 'Without tools, respond JSON with keys historicalReadVersion, currentVersion, changedFrom, changedTo. Distinguish the actual original read from authoritative current workspace contents.', "V1", 0));
	if (distinction.historicalReadVersion !== "V0" || distinction.currentVersion !== "V1" ||
		distinction.changedFrom !== "V0" || distinction.changedTo !== "V1") throw new Error("Chronology distinction failed");
	const instruction = h.invoke("later-instruction", 'A new instruction now applies: reply exactly PREFIX:V1:SUFFIX using the current file version in the middle. Do not use tools.', "V1", 0);
	if (instruction.response.trim() !== "PREFIX:V1:SUFFIX") throw new Error("Later instruction precedence failed");
	const history = parse(h.invoke("history-reference", 'We previously read V0 and edited it to V1. That refers to history, not a request to change it back. Without tools, reply JSON with keys originalRead, currentVersion.', "V1", 0));
	if (history.originalRead !== "V0" || history.currentVersion !== "V1") throw new Error("Historical reference failed");
	h.change("V0");
	const returned = parse(h.invoke("return-A", 'The underlying file was externally changed back. Without tools, distinguish historical edit result V1 from current authoritative workspace version. Reply JSON with keys historicalEditResult and currentVersion.', "V0", 0));
	if (returned.historicalEditResult !== "V1" || returned.currentVersion !== "V0") throw new Error("Return-A chronology failed");
	all.push({ repetition, placement: "fixed", workload: "chronology", runs: h.runs });
}
writeFileSync(join(root, "results.json"), JSON.stringify(all, null, 2), { mode: 0o600 });
console.log("Completed bounded experiment", root);
