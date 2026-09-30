// Opt-in LIVE measurement: node scripts/luna-measure.mjs /absolute/new/output-dir
// Uses the installed Pi CLI and authenticated Luna. Does not publish or alter repo state.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../", import.meta.url));
const root = resolve(process.argv[2] ?? "");
if (!process.argv[2] || existsSync(root)) throw new Error("Supply a new output directory");
mkdirSync(root, { recursive: true, mode: 0o700 });
const filler = "// measured source context, stable non-secret line 0123456789 abcdefghijklmnopqrstuvwxyz\n";
const body = (bytes, version = "V0") => `export const version = "${version}";\n${filler.repeat(Math.ceil(bytes / filler.length)).slice(0, bytes - 30)}\n`;
const common = ["--mode", "json", "-p", "--offline", "--no-extensions", "--no-skills", "--no-prompt-templates",
	"--no-themes", "--no-context-files", "--model", "openai-codex/gpt-6-luna", "--thinking", "minimal", "--tools", "read,edit"];
for (const test of [{ name: "unchanged-large", bytes: 38000 }, { name: "small-edits", bytes: 700, cycles: 8 }, { name: "large-edits", bytes: 38000, cycles: 2 }]) {
	for (const mode of ["off", "on"]) {
		const dir = join(root, mode, test.name);
		mkdirSync(join(dir, "sessions"), { recursive: true });
		writeFileSync(join(dir, "a.ts"), body(test.bytes));
		const extensions = mode === "on" ? ["--extension", join(repo, "index.ts")] : [];
		extensions.push("--extension", join(repo, "scripts/luna-observer.mjs"));
		let session;
		const runs = [];
		const invoke = (label, prompt) => {
			const args = [...common, ...(session ? ["--session", session] : ["--session-dir", join(dir, "sessions")]), ...extensions, prompt];
			const output = execFileSync("pi", args, { cwd: dir, encoding: "utf8", timeout: 900000,
				maxBuffer: 100 * 1024 * 1024, env: { ...process.env, CORVUS_COST_TRACE: dir } });
			writeFileSync(join(dir, `${label}.jsonl`), output, { mode: 0o600 });
			const events = output.trim().split("\n").map(JSON.parse);
			const messages = events.filter(e => e.type === "message_end" && e.message?.role === "assistant").map(e => e.message);
			if (messages.some(m => m.stopReason === "error")) throw new Error(`Provider error in ${dir}/${label}`);
			session ??= join(dir, "sessions", readdirSync(join(dir, "sessions")).find(f => f.endsWith(".jsonl")));
			const sum = key => messages.reduce((n, m) => n + (m.usage?.[key] ?? 0), 0);
			const reads = events.filter(e => e.type === "tool_execution_start" && e.toolName === "read");
			if (reads.some(e => e.args.offset != null || e.args.limit != null)) throw new Error(`Partial read invalidates ${dir}/${label}`);
			runs.push({ label, requests: messages.length, uncached: sum("input"), cacheRead: sum("cacheRead"),
				totalInput: sum("input") + sum("cacheRead"), output: sum("output"),
				cost: messages.reduce((n, m) => n + (m.usage?.cost?.total ?? 0), 0),
				reads: reads.length, edits: events.filter(e => e.type === "tool_execution_start" && e.toolName === "edit").length });
		};
		if (!test.cycles) {
			invoke("initial", 'Use built-in read exactly once with path "a.ts" only; omit offset and limit. Do not edit. Report version.');
			for (let i = 1; i <= 3; i++) invoke(`same-A-${i}`, `Without tools, report current version in a.ts. The file has not changed. Question ${i}.`);
			// External modification, followed by stable B without a model-issued read.
			writeFileSync(join(dir, "a.ts"), body(test.bytes, "V1"));
			if (mode === "on") for (let i = 1; i <= 3; i++) invoke(`same-B-${i}`, `The file was externally updated. Without tools, report its current version from authoritative synchronized contents. Question ${i}.`);
			if (mode === "on") {
				writeFileSync(join(dir, "a.ts"), body(test.bytes));
				invoke("return-A", "The file was externally updated again. Without tools, report its current version from authoritative synchronized contents.");
			}
		} else {
			const sequence = Array.from({ length: test.cycles }, (_, i) =>
				`Cycle ${i + 1}: built-in read with only path "a.ts", no offset or limit; then built-in edit to change only V${i} to V${i + 1}.`).join("\n");
			invoke("edits", `Perform this exact sequence, no bash, no skipped reads or edits. Report final version V${test.cycles} and stop.\n${sequence}`);
		}
		const requests = readFileSync(join(dir, "requests.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
		if (requests.some(r => !r.allOutputsPaired || r.repairPresent ||
			(mode === "on" && r.readCalls > 0 && r.authoritativeCopies !== 1))) throw new Error(`Provider authority/pairing failure: ${dir}`);
		const diffs = requests.map((r, i) => {
			const previous = requests[i - 1]?.input;
			let firstDifferingItem = null;
			if (previous) {
				firstDifferingItem = 0;
				while (firstDifferingItem < Math.min(previous.length, r.input.length) &&
					JSON.stringify(previous[firstDifferingItem]) === JSON.stringify(r.input[firstDifferingItem])) firstDifferingItem++;
			}
			return { request: i + 1, contextBytes: r.contextBytes, inputBytes: r.inputBytes, firstDifferingItem,
				previousType: previous?.[firstDifferingItem]?.type, currentType: r.input[firstDifferingItem]?.type,
				markers: JSON.stringify(r.input).split("[CORVUS synchronized read:").length - 1,
				snapshots: JSON.stringify(r.input).split("Current synchronized workspace files").length - 1 };
		});
		const primary = runs.filter(r => !r.label.startsWith("same-B") && r.label !== "return-A");
		const sum = key => primary.reduce((n, r) => n + r[key], 0);
		const summary = { mode, workload: test.name, requests: sum("requests"), totalInput: sum("totalInput"),
			cacheRead: sum("cacheRead"), uncached: sum("uncached"), cost: sum("cost"), reads: sum("reads"), edits: sum("edits"),
			contextBytes: diffs.slice(0, sum("requests")).reduce((n, r) => n + r.contextBytes, 0),
			inputBytes: diffs.slice(0, sum("requests")).reduce((n, r) => n + r.inputBytes, 0), runs, diffs };
		writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2), { mode: 0o600 });
		console.log(JSON.stringify(summary));
	}
}
