// Offline only. Never calls Pi or a provider; includes the failed final answer.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
const root = resolve(process.argv[2]);
const sha = s => createHash("sha256").update(s).digest("hex");
const json = v => JSON.stringify(v);
const lines = path => readFileSync(path, "utf8").trim().split("\n").map(JSON.parse);
const report = {};
for (const arm of ["tail", "temporal"]) {
	const { runs } = JSON.parse(readFileSync(join(root, arm, "summary.json"), "utf8"));
	const requests = lines(join(root, arm, "requests.jsonl"));
	let cursor = 0;
	const measured = runs.map(r => {
		const payloads = requests.slice(cursor, cursor + r.requests);
		cursor += r.requests;
		return { ...r, payloads };
	});
	const stages = Object.fromEntries(["A", "B", "C", "D"].map(stage => {
		const rows = measured.filter(r => r.label.startsWith(`${stage}-`));
		const prefix = r => {
			const { input, ...fields } = r.payloads[0].payload;
			const index = r.payloads[0].snapshots[0]?.index;
			return index === undefined ? null : json({ ...fields, input: input.slice(0, index + 1) });
		};
		return [stage, {
			cacheRead: rows.map(r => r.cacheRead),
			totals: Object.fromEntries(["totalInput", "cacheRead", "uncached", "output", "cost", "inputBytes", "contextBytes"]
				.map(key => [key, rows.reduce((n, r) => n + r[key], 0)])),
			exactCompletePrefixStable: rows.length > 0 && prefix(rows[0]) !== null && rows.every(r => prefix(r) === prefix(rows[0])),
			rows: rows.map(({ payloads, ...r }) => r),
		}];
	}));
	const sessionFile = join(root, arm, "sessions", readdirSync(join(root, arm, "sessions")).find(f => f.endsWith(".jsonl")));
	const raw = readFileSync(sessionFile, "utf8");
	const canonical = lines(sessionFile).filter(e => e.type === "message").map(e => e.message);
	const initialOutput = canonical.find(m => m.role === "toolResult" && m.toolName === "read");
	const last = requests.at(-1);
	const assertions = {
		canonicalNoSnapshot: !raw.includes("Current synchronized workspace files (request-time;"),
		canonicalNoReminder: !raw.includes("[CORVUS temporal-authority reminder]"),
		originalReadStillComplete: Buffer.byteLength(initialOutput.content[0].text) === 38000 && initialOutput.content[0].text.startsWith('export const version = "V0";'),
		preservedCanonicalPrefixes: runs.every(r => r.canonicalAudit.preservedPrior),
		allCurrentAuthoritiesUnique: requests.every(r => r.authorities.every(a => !a.refreshFailed && a.copies === 1 && a.staleBodies === 0)),
		pairingValid: requests.every(r => r.allOutputsPaired && r.uniqueOutputs && !r.repairPresent),
		noFollowupReads: runs.filter(r => r.label !== "initial").every(r => r.reads === 0),
		lateReminderExact: requests.every(r => arm !== "temporal" || !r.snapshots.length ||
			r.reminders.length === 1 && r.reminders[0].index === r.payload.input.length - 2),
		primaryC: runs.find(r => r.label === "C-1").response,
		historicalAnswer: runs.at(-1).response,
		originalAnswerAvailableOnFailedRequest: last.payload.input.some(i => i.role === "assistant" &&
			(i.content ?? []).some(b => b.text?.includes("V0"))),
	};
	if (Object.entries(assertions).some(([key, value]) => typeof value === "boolean" && !value)) throw new Error(`${arm} audit failed`);
	report[arm] = { requests: requests.length, stages, assertions,
		canonicalSha: sha(raw), finalInputSha: sha(json(last.payload)),
		transitions: measured.filter(r => ["B-1", "C-1", "D-1"].includes(r.label)).map(({ payloads, ...r }) => r),
		chronology: measured.filter(r => r.label.startsWith("chronology")).map(({ payloads, ...r }) => r) };
}
writeFileSync(join(root, "analysis.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([arm, value]) =>
	[arm, { requests: value.requests, assertions: value.assertions, prefixes: Object.fromEntries(Object.entries(value.stages).map(([stage, v]) => [stage, v.exactCompletePrefixStable])) }])), null, 2));
