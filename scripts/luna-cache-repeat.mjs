// Bounded live cache investigation; no CORVUS representation/semantic changes.
// node scripts/luna-cache-repeat.mjs /absolute/new/output-dir
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../", import.meta.url));
const root = resolve(process.argv[2] ?? "");
if (!process.argv[2] || existsSync(root)) throw new Error("Supply a new output directory");
mkdirSync(root, { recursive: true, mode: 0o700 });
const filler = "// measured source context, stable non-secret line 0123456789 abcdefghijklmnopqrstuvwxyz\n";
const body = version => `export const version = "${version}";\n${filler.repeat(450).slice(0, 37970)}\n`;
const common = ["--mode", "json", "-p", "--offline", "--no-extensions", "--no-skills", "--no-prompt-templates",
	"--no-themes", "--no-context-files", "--model", "openai-codex/gpt-6-luna", "--thinking", "minimal", "--tools", "read,edit"];
// Each invocation runs in a fresh process. Follow-ups therefore transmit full requests,
// not socket-scoped previous_response_id deltas; cacheSessionId stays fixed on resume.
for (let repetition = 1; repetition <= 3; repetition++) {
	for (const mode of repetition % 2 ? ["off", "on"] : ["on", "off"]) {
		const dir = join(root, `repeat-${repetition}`, mode);
		mkdirSync(join(dir, "sessions"), { recursive: true });
		writeFileSync(join(dir, "a.ts"), body("V0"));
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
			if (messages.some(m => m.stopReason === "error")) throw new Error(`Provider error ${dir}/${label}`);
			const tools = events.filter(e => e.type === "tool_execution_start");
			if (label !== "initial" && tools.length) throw new Error(`Unexpected follow-up tool ${dir}/${label}`);
			if (label === "initial" && (tools.length !== 1 || tools[0].toolName !== "read" ||
				tools[0].args.offset != null || tools[0].args.limit != null)) throw new Error(`Invalid initial read ${dir}`);
			session ??= join(dir, "sessions", readdirSync(join(dir, "sessions")).find(f => f.endsWith(".jsonl")));
			const sum = key => messages.reduce((n, m) => n + (m.usage?.[key] ?? 0), 0);
			runs.push({ label, requests: messages.length, uncached: sum("input"), cacheRead: sum("cacheRead"),
				totalInput: sum("input") + sum("cacheRead"), output: sum("output"),
				cost: messages.reduce((n, m) => n + (m.usage?.cost?.total ?? 0), 0) });
		};
		invoke("initial", 'Use built-in read exactly once with path "a.ts" only; omit offset and limit. Do not edit. Report version.');
		for (let i = 1; i <= 4; i++) invoke(`A-${i}`, "Without tools, report current version in a.ts. The file has not changed. Reply with only its value.");
		if (mode === "on") {
			writeFileSync(join(dir, "a.ts"), body("V1"));
			for (let i = 1; i <= 4; i++) invoke(`B-${i}`, "The file was externally updated before this series. Without tools, report its current version from authoritative synchronized contents. Reply with only its value.");
		}
		const requests = readFileSync(join(dir, "requests.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
		if (requests.some(r => !r.allOutputsPaired || r.repairPresent ||
			(mode === "on" && r.readCalls > 0 && r.authoritativeCopies !== 1))) throw new Error(`Invalid provider structure/authority ${dir}`);
		const summary = { repetition, mode, runs };
		writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2), { mode: 0o600 });
		console.log(JSON.stringify(summary));
	}
}
