// ONE bounded trajectory per arm. No automatic outcome retries or tuning.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../../", import.meta.url));
if (!process.argv[2]) throw new Error("Supply preserved fresh experiment root");
const root = resolve(process.argv[2]);
if (!existsSync(join(root, "released-hashes"))) throw new Error("Baseline must be preserved first");
if (existsSync(join(root, "live-started"))) throw new Error("No repeating an already started experiment");
const sha = text => createHash("sha256").update(text).digest("hex");
const reminder = "[CORVUS temporal-authority reminder] The CORVUS workspace snapshot earlier in this request was refreshed for this request and represents current filesystem state for synchronized paths. Canonical conversation positioned after that snapshot may describe older states; historical discussion does not supersede the current snapshot.";
const filler = "// measured source context, stable non-secret line 0123456789 abcdefghijklmnopqrstuvwxyz\n";
const body = version => `export const version = "${version}";\n${filler.repeat(Math.ceil(38000 / filler.length)).slice(0, 38000 - 30)}\n`;
const common = ["--mode", "json", "-p", "--offline", "--approve", "--no-extensions", "--no-skills",
	"--no-prompt-templates", "--no-themes", "--no-context-files", "--model", "openai-codex/gpt-6-luna",
	"--thinking", "minimal", "--tools", "read,edit"];
const parseLines = text => text.trim().split("\n").filter(Boolean).map(JSON.parse);
const all = [];
function arm(placement) {
	const dir = join(root, placement);
	mkdirSync(join(dir, "sessions"), { recursive: true });
	mkdirSync(join(dir, ".pi"), { recursive: true });
	writeFileSync(join(dir, ".pi/settings.json"), JSON.stringify({ compaction: { enabled: false } }));
	writeFileSync(join(dir, "a.ts"), body("V0"));
	const extension = placement === "tail" ? join(repo, "index.ts") : join(repo, "experiments/temporal-reminder/extension.ts");
	let session, priorCanonical = [], requestCount = 0;
	const runs = [];
	const invoke = (label, prompt, expectedVersion, expectedTools, expectedJson, exactAnswer) => {
		const output = execFileSync("pi", [...common,
			...(session ? ["--session", session] : ["--session-dir", join(dir, "sessions")]),
			"--extension", extension, "--extension", join(repo, "experiments/temporal-reminder/observer.mjs"), prompt], {
			cwd: dir, encoding: "utf8", timeout: 900000, maxBuffer: 100 * 1024 * 1024,
			env: { ...process.env, CORVUS_EARLY_TRACE: dir } });
		writeFileSync(join(dir, `${label}.jsonl`), output, { mode: 0o600 });
		const events = parseLines(output);
		const messages = events.filter(e => e.type === "message_end" && e.message?.role === "assistant").map(e => e.message);
		const tools = events.filter(e => e.type === "tool_execution_start");
		session ??= join(dir, "sessions", readdirSync(join(dir, "sessions")).find(f => f.endsWith(".jsonl")));
		const canonical = parseLines(readFileSync(session, "utf8")).filter(e => e.type === "message").map(e => e.message);
		const requestRows = parseLines(readFileSync(join(dir, "requests.jsonl"), "utf8"));
		const captured = requestRows.slice(requestCount);
		requestCount = requestRows.length;
		const response = messages.at(-1)?.content.filter(c => c.type === "text").map(c => c.text).join(" ") ?? "";
		const errors = [];
		if (messages.some(m => m.stopReason === "error")) errors.push("provider error");
		if (tools.length !== expectedTools) errors.push(`tools ${tools.length} != ${expectedTools}`);
		if (tools.some(e => e.toolName === "read" && (e.args.offset != null || e.args.limit != null))) errors.push("partial read");
		if (events.some(e => e.type.includes("compaction"))) errors.push("compaction");
		if (JSON.stringify(canonical.slice(0, priorCanonical.length)) !== JSON.stringify(priorCanonical)) errors.push("canonical rewrite");
		if (JSON.stringify(canonical).includes(reminder) || canonical.some(m => m.role === "user" &&
			JSON.stringify(m).includes("Current synchronized workspace files (request-time;"))) errors.push("synthetic persisted");
		priorCanonical = canonical;
		for (const r of captured) {
			if (!r.allOutputsPaired || !r.uniqueOutputs || r.repairPresent) errors.push("pairing");
			if (r.authorities.some(a => !a.refreshFailed && (a.copies !== 1 || a.staleBodies !== 0))) errors.push("authority");
			if (placement === "temporal" && r.snapshots.length) {
				if (r.reminders.length !== 1 || r.reminders[0].text !== reminder ||
					r.reminders[0].index !== r.payload.input.length - 2 ||
					r.payload.input.at(-1)?.role !== "user" || r.snapshots[0].index !== 0) errors.push("placement");
			} else if (r.reminders.length) errors.push("unexpected reminder");
		}
		let correct = expectedVersion === undefined ? null : response.trim() === expectedVersion;
		if (label === "initial") correct = response.includes(expectedVersion);
		if (expectedJson) {
			try {
				const value = JSON.parse(response.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
				correct = Object.entries(expectedJson).every(([key, expected]) => value[key] === expected);
			} catch { correct = false; }
		}
		if (exactAnswer !== undefined) correct = response.trim() === exactAnswer;
		if (correct === false) errors.push("semantic");
		const sum = key => messages.reduce((n, m) => n + (m.usage?.[key] ?? 0), 0);
		const row = { label, prompt, response, correct, errors, requests: captured.length,
			totalInput: sum("input") + sum("cacheRead"), cacheRead: sum("cacheRead"), uncached: sum("input"),
			output: sum("output"), cost: messages.reduce((n, m) => n + (m.usage?.cost?.total ?? 0), 0),
			inputBytes: captured.reduce((n, r) => n + r.inputBytes, 0), contextBytes: captured.reduce((n, r) => n + r.contextBytes, 0),
			reads: tools.filter(t => t.toolName === "read").length,
			canonicalAudit: { messages: canonical.length, hash: sha(JSON.stringify(canonical)), preservedPrior: !errors.includes("canonical rewrite"),
				noSynthetic: !errors.includes("synthetic persisted") },
			captures: captured.map(({ payload, ...metrics }) => metrics) };
		runs.push(row);
		writeFileSync(join(dir, "summary.json"), JSON.stringify({ placement, runs }, null, 2), { mode: 0o600 });
		console.log(placement, label, JSON.stringify(response), row.cacheRead, errors);
		if (errors.length) throw new Error(`${placement}/${label}: ${errors.join(", ")}`);
		return row;
	};
	return { invoke, runs, change: version => writeFileSync(join(dir, "a.ts"), body(version)) };
}
// All prompts and checks frozen before the first request.
writeFileSync(join(root, "live-started"), JSON.stringify({ date: new Date().toISOString(),
	plan: sha(readFileSync(join(repo, "experiments/temporal-reminder/PLAN.md"), "utf8")),
	runner: sha(readFileSync(fileURLToPath(import.meta.url), "utf8")),
	extension: sha(readFileSync(join(repo, "experiments/temporal-reminder/extension.ts"), "utf8")) }));
try {
	for (const placement of ["tail", "temporal"]) {
		const a = arm(placement);
		a.invoke("initial", 'Use built-in read exactly once with path "a.ts" only; omit offset and limit. Do not edit. Report version.', "V0", 1);
		for (let i = 1; i <= 3; i++) a.invoke(`A-${i}`, "Without tools, report current version in a.ts. The file has not changed. Reply only its value.", "V0", 0);
		a.change("V1");
		for (let i = 1; i <= 4; i++) a.invoke(`B-${i}`, "The file was externally updated before this series. Without tools, report its current version from authoritative synchronized contents. Reply only its value.", "V1", 0);
		a.change("V2");
		for (let i = 1; i <= 3; i++) a.invoke(`C-${i}`, "The file was externally updated again before this series. Without tools, report its current version from authoritative synchronized contents. Reply only its value.", "V2", 0);
		a.change("V3");
		for (let i = 1; i <= 3; i++) a.invoke(`D-${i}`, "The file was externally updated again before this series. Without tools, report its current version from authoritative synchronized contents. Reply only its value.", "V3", 0);
		a.invoke("chronology-old-current", 'Earlier in this conversation the file was V1 and your replies said V1; that discussion is historical. Without tools, reply JSON with keys oldBVersion and currentVersion.', undefined, 0, { oldBVersion: "V1", currentVersion: "V3" });
		a.invoke("chronology-B-C", 'Compare the historical external transition from B to C, not the latest file. Without tools, reply JSON with keys changedFrom, changedTo, currentVersion.', undefined, 0, { changedFrom: "V1", changedTo: "V2", currentVersion: "V3" });
		a.invoke("chronology-instruction", 'The edit to C changed V1 to V2. Your old answers V1 and V2 describe past states. A new unrelated formatting instruction applies: without tools reply exactly PREFIX:<current file version>:SUFFIX.', undefined, 0, undefined, "PREFIX:V3:SUFFIX");
		a.invoke("chronology-old-only", 'What version did the original model-issued read observe, before the external updates? This is a historical question, not a current-state question. Without tools, reply only that old value.', "V0", 0);
		all.push({ placement, runs: a.runs });
	}
	writeFileSync(join(root, "results.json"), JSON.stringify(all, null, 2), { mode: 0o600 });
} catch (error) {
	writeFileSync(join(root, "STOP.json"), JSON.stringify({ date: new Date().toISOString(), error: String(error) }, null, 2));
	throw error; // No remaining live requests after any gate failure.
}
