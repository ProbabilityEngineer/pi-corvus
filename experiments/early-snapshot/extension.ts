/** Explicit test-only entry point: pi -e experiments/early-snapshot/extension.ts.
 * Not in the package manifest/files. Never load alongside released CORVUS.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, ContextEvent } from "@earendil-works/pi-coding-agent";
import corvus from "../../index.ts";

type ContextResult = { messages: AgentMessage[] } | undefined | void;

/** Only a newly appended CORVUS snapshot may move; never classify canonical text. */
export function moveNewSnapshot(original: AgentMessage[], transformed: AgentMessage[]): AgentMessage[] {
	if (transformed.length !== original.length + 1) return transformed;
	const snapshot = transformed.at(-1);
	if (snapshot?.role !== "user" || !Array.isArray(snapshot.content) ||
		snapshot.content.length !== 1 || snapshot.content[0].type !== "text" ||
		!snapshot.content[0].text.startsWith("Current synchronized workspace files (request-time; authoritative for these paths; JSON-encoded content):\n")) return transformed;
	const conversation = transformed.slice(0, -1);
	let boundary = 0;
	while (conversation[boundary]?.role === "system") boundary++;
	return [...conversation.slice(0, boundary), snapshot, ...conversation.slice(boundary)];
}

export default function experimentalEarlyCorvus(pi: ExtensionAPI): void {
	// Register all released handlers once, intercepting only their context result.
	const api = new Proxy(pi, {
		get(target, key) {
			if (key !== "on") return Reflect.get(target, key);
			return ((name: string, handler: (event: ContextEvent, ctx: ExtensionContext) => ContextResult | Promise<ContextResult>) => {
				if (name !== "context") return pi.on(name as "context", handler);
				return pi.on("context", async (event, ctx) => {
					const result = await handler(event, ctx);
					return result ? { messages: moveNewSnapshot(event.messages, result.messages) } : result;
				});
			}) as ExtensionAPI["on"];
		},
	});
	corvus(api);
}
