/**
 * Test-only single-anchor experiment. The released V1 extension remains the
 * authority for complete-read registration and paired request-time markers.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	BoundaryResult,
	ExtensionAPI,
	ExtensionContext,
	SessionBoundaryDraft,
} from "@earendil-works/pi-coding-agent";
import corvus, { rebuild, synchronize } from "../../index.ts";

const ANCHOR_TYPE = "corvus-v2a-state";
const SNAPSHOT_PREFIX = "Current synchronized workspace files (request-time; authoritative for these paths; JSON-encoded content):\n";
const SUPERSEDED = "[CORVUS synchronized state superseded by a later authoritative state]";

type AnchorDetails = {
	schemaVersion: 1;
	generation: number;
	path: string;
	contentSha256: string;
	byteLength: number;
	supersedesAnchorEntryId?: string;
};

type Anchor = {
	entryId: string;
	details: AnchorDetails;
	content: string;
	messageIndex: number;
};

function textOf(message: AgentMessage): string | undefined {
	if (message.role !== "custom" || typeof message.content !== "string") return undefined;
	return message.content;
}

function validAnchor(entry: Record<string, unknown>): Anchor | undefined {
	if (entry.type !== "custom_message" || entry.customType !== ANCHOR_TYPE ||
		typeof entry.id !== "string" || typeof entry.content !== "string" ||
		!entry.details || typeof entry.details !== "object") return undefined;
	const d = entry.details as Record<string, unknown>;
	if (d.schemaVersion !== 1 || !Number.isSafeInteger(d.generation) || Number(d.generation) < 1 ||
		typeof d.path !== "string" || typeof d.contentSha256 !== "string" ||
		!Number.isSafeInteger(d.byteLength)) return undefined;
	return {
		entryId: entry.id,
		details: d as unknown as AnchorDetails,
		content: entry.content,
		messageIndex: -1,
	};
}

function isV1SnapshotTail(messages: AgentMessage[], sourceMessages?: AgentMessage[]): boolean {
	return !!sourceMessages && messages.length === sourceMessages.length + 1 &&
		messages.at(-1) !== sourceMessages.at(-1);
}

function readSnapshots(messages: AgentMessage[], sourceMessages?: AgentMessage[]): Array<{ path: string; content: string }> {
	if (!isV1SnapshotTail(messages, sourceMessages)) return [];
	const last = messages.at(-1);
	if (!last || last.role !== "user" || !Array.isArray(last.content)) return [];
	const text = last.content.length === 1 && last.content[0].type === "text" ? last.content[0].text : "";
	if (!text.startsWith(SNAPSHOT_PREFIX)) return [];
	try {
		const parsed: unknown = JSON.parse(text.slice(SNAPSHOT_PREFIX.length));
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((item): item is { path: string; content: string } =>
			!!item && typeof item === "object" && typeof item.path === "string" && typeof item.content === "string");
	} catch { return []; }
}

function snapshotMessageIndex(messages: AgentMessage[], sourceMessages?: AgentMessage[]): number {
	if (!isV1SnapshotTail(messages, sourceMessages)) return -1;
	const last = messages.at(-1);
	if (!last || last.role !== "user" || !Array.isArray(last.content) ||
		last.content.length !== 1 || last.content[0].type !== "text" ||
		!last.content[0].text.startsWith(SNAPSHOT_PREFIX)) return -1;
	return messages.length - 1;
}

function encodeSnapshots(snapshots: Array<{ path: string; content: string }>): string {
	return SNAPSHOT_PREFIX + JSON.stringify(snapshots);
}

function anchorsIn(ctx: ExtensionContext): Anchor[] {
	const branch = ctx.sessionManager.getBranch();
	const result: Anchor[] = [];
	let projectedIndex = 0;
	for (const entry of branch) {
		const anchor = validAnchor(entry as unknown as Record<string, unknown>);
		if (anchor) {
			anchor.messageIndex = projectedIndex;
			result.push(anchor);
		}
		projectedIndex++;
	}
	return result;
}

function latestByPath(anchors: Anchor[]): Map<string, Anchor> {
	const latest = new Map<string, Anchor>();
	for (const anchor of anchors) {
		const current = latest.get(anchor.details.path);
		if (!current || anchor.details.generation > current.details.generation) latest.set(anchor.details.path, anchor);
	}
	return latest;
}

export async function createAnchorDraft(
	candidate: { path: string; content: string },
	ctx: ExtensionContext,
): Promise<SessionBoundaryDraft | undefined> {
	try {
		const { readFile, realpath } = await import("node:fs/promises");
		const canonical = await realpath(candidate.path);
		const bytes = await readFile(canonical);
		const current = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
		if (canonical !== candidate.path || current !== candidate.content) return;
		const anchors = anchorsIn(ctx).filter((a) => a.details.path === canonical);
		const predecessor = anchors.at(-1);
		const generation = (predecessor?.details.generation ?? 0) + 1;
		return {
			type: "custom_message",
			customType: ANCHOR_TYPE,
			content: current,
			display: false,
			details: {
				schemaVersion: 1,
				generation,
				path: canonical,
				contentSha256: (await import("node:crypto")).createHash("sha256").update(current).digest("hex"),
				byteLength: bytes.length,
				...(predecessor ? { supersedesAnchorEntryId: predecessor.entryId } : {}),
			} satisfies AnchorDetails,
		};
	} catch {
		return;
	}
}

function hasFreshReadAfterAnchor(
	messages: AgentMessage[],
	state: ReturnType<typeof rebuild>,
	ctx: ExtensionContext,
	path: string,
	anchor: Anchor,
): boolean {
	const file = state.files.find((f) => f.path === path);
	if (!file) return false;
	const ids = new Set(file.observations.map((o) => o.id));
	const branch = ctx.sessionManager.getBranch();
	const anchorIndex = branch.findIndex((entry) => entry.id === anchor.entryId);
	let lastReadEntryIndex = -1;
	for (let i = 0; i < branch.length; i++) {
		const entry = branch[i];
		if (entry.type === "message" && entry.message.role === "toolResult" &&
			ids.has(entry.message.toolCallId) && entry.message.toolName === "read" &&
			!entry.message.isError && entry.message.content.length === 1 &&
			entry.message.content[0].type === "text") lastReadEntryIndex = i;
	}
	return anchorIndex >= 0 && lastReadEntryIndex > anchorIndex;
}

/** Resolve one request using durable chronological anchors plus the tested V1 tail transform. */
export async function resolveV2aRequest(
	messages: AgentMessage[],
	state: ReturnType<typeof rebuild>,
	ctx: ExtensionContext,
	alreadySynchronized = false,
	sourceMessages?: AgentMessage[],
): Promise<{ messages: AgentMessage[]; tailSnapshots: Array<{ path: string; content: string }> }> {
	const v1 = alreadySynchronized ? messages : await synchronize(messages, state);
	const source = alreadySynchronized ? sourceMessages : messages;
	const tailSnapshots = readSnapshots(v1, source);
	const anchors = anchorsIn(ctx);
	if (anchors.length === 0 && tailSnapshots.length === 0) return { messages: v1, tailSnapshots };
	const latest = latestByPath(anchors);
	const output = v1.map((message) => ({ ...message })) as AgentMessage[];
	// Projection messages retain customType/details. Retire every non-current
	// anchor in request context, and retire a current anchor when disk differs.
	for (let i = 0; i < output.length; i++) {
		const message = output[i];
		if (message.role !== "custom" || message.customType !== ANCHOR_TYPE) continue;
		const d = message.details as AnchorDetails | undefined;
		if (!d || typeof d.path !== "string") continue;
		const active = latest.get(d.path);
		const disk = await import("node:fs/promises").then(({ readFile }) => readFile(d.path)
			.then((bytes) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes))
			.catch(() => undefined));
		// Refresh failure is V1 fail-open: retain historical context rather than
		// declaring a durable anchor stale based on an unavailable observation.
		if (disk === undefined) continue;
		const newerRead = active ? hasFreshReadAfterAnchor(messages, state, ctx, d.path, active) : false;
		const stillAuthority = active?.details.generation === d.generation &&
			disk === textOf(message) && !newerRead;
		if (!stillAuthority) {
			output[i] = { ...message, content: SUPERSEDED };
		}
	}
	// Filter the combined V1 tail by path, not by entire message.
	const snapshotIndex = snapshotMessageIndex(v1, source);
	const coveredPaths = new Set([...latest.values()]
		.filter((anchor) => tailSnapshots.some((snapshot) =>
			snapshot.path === anchor.details.path && snapshot.content === anchor.content))
		.map((anchor) => anchor.details.path));
	const retained = tailSnapshots.filter((snapshot) => !coveredPaths.has(snapshot.path));
	let filtered = output;
	if (snapshotIndex >= 0 && coveredPaths.size > 0) {
		if (retained.length === 0) filtered = output.filter((_, index) => index !== snapshotIndex);
		else filtered[snapshotIndex] = {
			...output[snapshotIndex],
			content: [{ type: "text", text: encodeSnapshots(retained) }],
		} as AgentMessage;
	}
	return { messages: filtered, tailSnapshots: retained };
}

export default function corvusV2a(pi: ExtensionAPI): void {
	let v1State: ReturnType<typeof rebuild> = rebuild([]);
	let pending: { path: string; content: string }[] = [];
	// Run the unmodified released extension, wrapping only its public context hook.
	const proxy = new Proxy(pi, {
		get(target, property, receiver) {
			if (property !== "on") return Reflect.get(target, property, receiver);
			return (event: string, handler: (e: any, ctx: ExtensionContext) => unknown) =>
				target.on(event as never, (async (e: any, ctx: ExtensionContext) => {
					if (event === "session_start" || event === "session_tree") {
						v1State = rebuild(ctx.sessionManager.getBranch());
						return handler(e, ctx);
					}
					if (event !== "context") return handler(e, ctx);
					v1State = rebuild(ctx.sessionManager.getBranch());
					const result = await handler(e, ctx) as { messages?: AgentMessage[] } | undefined;
					if (!result?.messages) return result;
					try {
						const resolved = await resolveV2aRequest(result.messages, v1State, ctx, true, e.messages);
						pending = resolved.tailSnapshots;
						return { ...result, messages: resolved.messages };
					} catch {
						pending = [];
						return result;
					}
				}) as never);
		},
	});
	corvus(proxy);
	pi.on("turn_end", async (event, ctx): Promise<BoundaryResult | undefined> => {
		if (event.outcome !== "completed" || pending.length !== 1) {
			pending = [];
			return;
		}
		const candidate = pending[0];
		pending = [];
		const draft = await createAnchorDraft(candidate, ctx);
		return draft ? { entries: [draft] } : undefined;
	});
}
