/**
 * Experimental request-time synchronization of bounded, complete local text reads.
 * Load with `pi -e .` from this package.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

function resolveLocalPath(path: string, cwd: string): string {
	const expanded = path === "~" ? homedir() : path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path;
	return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

// Experimental limits. Files that cannot be refreshed within these bounds fail open.
export const MAX_FILES = 12;
export const MAX_FILE_BYTES = 64 * 1024;
export const MAX_REQUEST_BYTES = 256 * 1024;
const ENTRY = "corvus-v1";
type Observation = { id: string; digest: string; stale?: boolean };
type FileState = { path: string; observations: Observation[] };
type State = { enabled: boolean; files: FileState[] };
type Operation = { op: "read"; path: string; observation: Observation } | { op: "drop"; path: string }
	| { op: "clear" } | { op: "enabled"; value: boolean }
	| { op: "stale"; path: string; ids: string[] };

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const initial = (): State => ({ enabled: true, files: [] });

export function applyOperation(state: State, operation: Operation): void {
	if (operation.op === "clear") state.files = [];
	else if (operation.op === "enabled") state.enabled = operation.value;
	else if (operation.op === "drop") state.files = state.files.filter((f) => f.path !== operation.path);
	else if (operation.op === "stale") {
		for (const observation of state.files.find(f => f.path === operation.path)?.observations ?? []) {
			if (operation.ids.includes(observation.id)) observation.stale = true;
		}
	} else {
		let file = state.files.find((f) => f.path === operation.path);
		if (file) state.files = state.files.filter((f) => f !== file);
		else file = { path: operation.path, observations: [] };
		file.observations.push(operation.observation);
		state.files.push(file);
		while (state.files.length > MAX_FILES) state.files.shift();
	}
}

const valid = (value: unknown): value is Operation => {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return (v.op === "clear") || (v.op === "enabled" && typeof v.value === "boolean") ||
		(v.op === "drop" && typeof v.path === "string") ||
		(v.op === "stale" && typeof v.path === "string" && Array.isArray(v.ids) && v.ids.every(id => typeof id === "string")) ||
		(v.op === "read" && typeof v.path === "string" && !!v.observation &&
			typeof (v.observation as Observation).id === "string" &&
			typeof (v.observation as Observation).digest === "string");
};

export function rebuild(branch: readonly { type: string; customType?: string; data?: unknown }[]): State {
	const state = initial();
	for (const entry of branch) if (entry.type === "custom" && entry.customType === ENTRY && valid(entry.data)) {
		applyOperation(state, entry.data);
	}
	return state;
}

async function snapshot(path: string): Promise<string | undefined> {
	try {
		const info = await stat(path);
		if (!info.isFile() || info.size > MAX_FILE_BYTES) return;
		const buffer = await readFile(path);
		if (buffer.length > MAX_FILE_BYTES || buffer.includes(0)) return;
		const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
		return text;
	} catch { return; }
}

/** Returns original array on any global ambiguity; per-file refresh failures fail open. */
export async function synchronize(messages: AgentMessage[], state: State,
	onStale: (operation: Operation) => void = operation => applyOperation(state, operation)): Promise<AgentMessage[]> {
	if (!state.enabled || !state.files.length) return messages;
	const replacements = new Map<string, { path: string; digest: string }>();
	const ambiguous = new Set<string>();
	const snapshots: string[] = [];
	const prefix = "Current synchronized workspace files (request-time; authoritative for these paths; JSON-encoded content):\n";
	// Only unique, paired, unmodified complete observations can supply authority.
	const calls = new Map<string, string>();
	const results = new Map<string, Extract<AgentMessage, { role: "toolResult" }> | undefined>();
	const tracked = new Set<string>();
	for (const file of state.files) for (const observation of file.observations) {
		if (tracked.has(observation.id)) return messages;
		tracked.add(observation.id);
	}
	for (const message of messages) {
		if (message.role === "assistant") for (const block of message.content) {
			if (block.type === "toolCall") {
				if (calls.has(block.id) && tracked.has(block.id)) return messages;
				calls.set(block.id, calls.has(block.id) ? "" : block.name);
			}
		}
		if (message.role === "toolResult") {
			if (results.has(message.toolCallId) && tracked.has(message.toolCallId)) return messages;
			results.set(message.toolCallId, results.has(message.toolCallId) ? undefined : message);
		}
	}
	const eligible = (observation: Observation) => {
		const result = results.get(observation.id);
		return calls.get(observation.id) === "read" && result?.toolName === "read" &&
			!result.isError && result.content.length === 1 && result.content[0].type === "text" &&
			digest(result.content[0].text) === observation.digest ? result.content[0].text : undefined;
	};
	const kept = new Set<string>();
	let bytes = Buffer.byteLength(prefix) + 2; // JSON array delimiters.
	// Most recently observed files have priority. Keep displayed order stable (oldest first).
	for (const file of [...state.files].reverse()) {
		const text = await snapshot(file.path);
		if (text === undefined) continue;
		// Keep the earliest observation in the trailing run of identical reads.
		// Never promote an old observation across a later different/absent read.
		let authority: Observation | undefined;
		for (const observation of [...file.observations].reverse()) {
			if (observation.stale || eligible(observation) !== text) break;
			authority = observation;
		}
		const encoded = JSON.stringify({ path: file.path, content: text });
		const size = Buffer.byteLength(encoded) + (snapshots.length ? 1 : 0);
		if (authority) kept.add(authority.id);
		else {
			if (bytes + size > MAX_REQUEST_BYTES) continue;
			bytes += size;
			snapshots.unshift(encoded);
		}
		// Once an observation is known stale, never re-promote it at its old
		// chronological position. A new read can establish fresh authority.
		const stale = file.observations.filter(observation => !observation.stale &&
			eligible(observation) !== undefined && eligible(observation) !== text);
		if (stale.length) onStale({ op: "stale", path: file.path, ids: stale.map(observation => observation.id) });
		for (const observation of file.observations) {
			if (ambiguous.has(observation.id)) continue;
			if (replacements.has(observation.id)) {
				// Ambiguous duplicated tool call ID: do not elide either.
				replacements.delete(observation.id);
				ambiguous.add(observation.id);
			} else replacements.set(observation.id, { path: file.path, digest: observation.digest });
		}
	}
	let changed = false;
	const output = messages.map((message) => {
		if (message.role !== "toolResult" || message.toolName !== "read" ||
			calls.get(message.toolCallId) !== "read") return message;
		const target = replacements.get(message.toolCallId);
		if (!target || kept.has(message.toolCallId) || results.get(message.toolCallId) !== message ||
			message.isError || message.content.length !== 1 ||
			message.content[0].type !== "text" || digest(message.content[0].text) !== target.digest) return message;
		changed = true;
		return { ...message, content: [{ type: "text" as const, text: `[CORVUS synchronized read: ${target.path}; superseded; use the authoritative current representation in this request]` }] };
	});
	if (snapshots.length) output.push({
		role: "user", timestamp: Date.now(),
		content: [{ type: "text", text: `${prefix}[${snapshots.join(",")}]` }],
	});
	return changed || snapshots.length ? output : messages;
}

export default function corvus(pi: ExtensionAPI): void {
	let state = initial();
	let pendingRetirements: Operation[] = [];
	const update = (operation: Operation) => { applyOperation(state, operation); pi.appendEntry(ENTRY, operation); };
	const persistRetirement = (operation: Operation): boolean => {
		try { pi.appendEntry(ENTRY, operation); return true; }
		catch (error) {
			console.warn("CORVUS stale-retirement persistence failed; current request remains synchronized; retry pending", error);
			return false;
		}
	};
	const retire = (operation: Operation) => {
		// Local non-resurrection must not depend on Pi's append durability.
		applyOperation(state, operation);
		if (!persistRetirement(operation)) pendingRetirements.push(operation);
	};
	const restore = (ctx: ExtensionContext) => {
		state = rebuild(ctx.sessionManager.getBranch());
		pendingRetirements = [];
	};
	pi.on("session_start", (_event, ctx) => restore(ctx));
	pi.on("session_tree", (_event, ctx) => restore(ctx));
	pi.on("tool_result", async (event, ctx) => {
		if (!state.enabled || event.toolName !== "read" || event.isError ||
			event.input.offset != null || event.input.limit != null ||
			event.content.length !== 1 || event.content[0].type !== "text" ||
			event.content[0].text.includes("\uFFFD")) return;
		const path = event.input.path;
		if (typeof path !== "string") return;
		try {
			const resolved = await realpath(resolveLocalPath(path, ctx.cwd));
			const text = await snapshot(resolved);
			// Avoid registering image notes, truncated reads, remote read overrides and races.
			if (text === undefined || text !== event.content[0].text) return;
			update({ op: "read", path: resolved, observation: { id: event.toolCallId, digest: digest(text) } });
		} catch { /* fail open */ }
	});
	pi.on("context", async (event) => {
		try {
			pendingRetirements = pendingRetirements.filter(operation => !persistRetirement(operation));
			return { messages: await synchronize(event.messages, state, retire) };
		} catch {
			// A failed transform must not prevent the request from using Pi's original context.
			return { messages: event.messages };
		}
	});
	pi.registerCommand("corvus", {
		description: "Control synchronized file context: status | clear | drop <path> | on | off",
		handler: async (args, ctx) => {
			const [command, ...rest] = args.trim().split(/\s+/);
			if (command === "status" || !command) {
				ctx.ui.notify(`CORVUS ${state.enabled ? "on" : "off"}; ${state.files.length}/${MAX_FILES} files (LRU oldest first):\n${state.files.map((f) => `${f.path} (${f.observations.length} reads)`).join("\n")}`, "info");
			} else if (command === "clear") update({ op: "clear" });
			else if (command === "on" || command === "off") update({ op: "enabled", value: command === "on" });
			else if (command === "drop" && rest.length) {
				try { update({ op: "drop", path: await realpath(resolveLocalPath(rest.join(" "), ctx.cwd)) }); }
				catch { ctx.ui.notify("Cannot resolve file", "warning"); }
			} else ctx.ui.notify("Usage: /corvus status|clear|drop <path>|on|off", "warning");
		},
	});
}
