// Offline exact structural/byte comparison of captured provider payloads.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Supply measurement root");
const sha = text => createHash("sha256").update(text).digest("hex");
const json = value => JSON.stringify(value);
const commonBytes = (a, b) => {
	const x = Buffer.from(a), y = Buffer.from(b);
	let i = 0;
	while (i < Math.min(x.length, y.length) && x[i] === y[i]) i++;
	return i;
};
const firstDifference = (a, b, path = "$") => {
	if (json(a) === json(b)) return null;
	if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return path;
	for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
		const result = firstDifference(a[key], b[key], `${path}.${key}`);
		if (result) return result;
	}
	return path;
};
const report = [];
for (let repetition = 1; repetition <= 3; repetition++) for (const mode of ["off", "on"]) {
	const dir = join(root, `repeat-${repetition}`, mode);
	const summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
	const requests = readFileSync(join(dir, "requests.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
	const rows = requests.map((r, i) => {
		const previous = requests[i - 1];
		const snapshotIndex = r.input.findIndex(item => item.content?.some(block => block.text?.startsWith("Current synchronized workspace files")));
		const snapshotItem = snapshotIndex < 0 ? undefined : r.input[snapshotIndex];
		const snapshotText = snapshotItem?.content.find(block => block.text?.startsWith("Current synchronized workspace files")).text;
		const files = snapshotText ? JSON.parse(snapshotText.slice(snapshotText.indexOf("\n") + 1)) : [];
		const { input: _input, ...nonInput } = r.payload;
		const { input: _previousInput, ...previousNonInput } = previous?.payload ?? {};
		const payload = json(r.payload), previousPayload = previous ? json(previous.payload) : "";
		const input = json(r.input), previousInput = previous ? json(previous.input) : "";
		const prefix = json(r.input.slice(0, Math.max(snapshotIndex, 0)));
		const priorSnapshotIndex = previous?.input.findIndex(item => item.content?.some(block => block.text?.startsWith("Current synchronized workspace files"))) ?? -1;
		const previousPrefix = priorSnapshotIndex < 0 ? undefined : json(previous.input.slice(0, priorSnapshotIndex));
		let differingItem = 0;
		if (previous) while (differingItem < Math.min(r.input.length, previous.input.length) &&
			json(r.input[differingItem]) === json(previous.input[differingItem])) differingItem++;
		return { request: i + 1, contextBytes: r.contextBytes, inputBytes: r.inputBytes, payloadBytes: Buffer.byteLength(payload),
			nonInputStable: previous ? json(nonInput) === json(previousNonInput) : null,
			firstStructuralDifference: previous ? firstDifference(previous.payload, r.payload) : null,
			firstPayloadByteDifference: previous ? commonBytes(previousPayload, payload) : null,
			firstInputByteDifference: previous ? commonBytes(previousInput, input) : null,
			firstDifferingItem: previous ? differingItem : null,
			snapshotIndex, snapshotHash: snapshotItem ? sha(json(snapshotItem)) : null,
			fileHashes: files.map(f => sha(f.content)), fileBytes: files.map(f => Buffer.byteLength(f.content)),
			prefixBeforeSnapshotBytes: snapshotItem ? Buffer.byteLength(prefix) : null,
			prefixBeforeSnapshotIdentical: previousPrefix === undefined ? null : prefix === previousPrefix,
			previousAtDifference: previous?.input[differingItem]?.type ?? previous?.input[differingItem]?.role,
			currentAtDifference: r.input[differingItem]?.type ?? r.input[differingItem]?.role };
	});
	const sum = (runs, key) => runs.reduce((n, r) => n + r[key], 0);
	const A = summary.runs.filter(r => r.label === "initial" || r.label.startsWith("A-"));
	const B = summary.runs.filter(r => r.label.startsWith("B-"));
	report.push({ repetition, mode, A: Object.fromEntries(["requests", "totalInput", "cacheRead", "uncached", "cost"].map(k => [k, sum(A, k)])),
		A_followupCache: A.slice(1).map(r => r.cacheRead),
		B: Object.fromEntries(["requests", "totalInput", "cacheRead", "uncached", "cost"].map(k => [k, sum(B, k)])),
		B_followupCache: B.map(r => r.cacheRead),
		AcontextBytes: rows.slice(0, 6).reduce((n, r) => n + r.contextBytes, 0),
		AinputBytes: rows.slice(0, 6).reduce((n, r) => n + r.inputBytes, 0),
		BcontextBytes: rows.slice(6).reduce((n, r) => n + r.contextBytes, 0),
		BinputBytes: rows.slice(6).reduce((n, r) => n + r.inputBytes, 0),
		rows });
}
writeFileSync(join(root, "analysis.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
for (const { rows, ...summary } of report) console.log(JSON.stringify(summary));
console.log("Example exact B differences:", JSON.stringify(report.find(r => r.mode === "on").rows.slice(6), null, 2));
