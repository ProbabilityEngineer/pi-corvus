/** Test-only entry point. Never load alongside another CORVUS transformer. */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, ContextEvent } from "@earendil-works/pi-coding-agent";
import { moveNewSnapshot } from "../early-snapshot/extension.ts";
import corvus from "../../index.ts";

export const REMINDER = "[CORVUS temporal-authority reminder] The CORVUS workspace snapshot earlier in this request was refreshed for this request and represents current filesystem state for synchronized paths. Canonical conversation positioned after that snapshot may describe older states; historical discussion does not supersede the current snapshot.";

/** Accept released tail output; classify only a newly generated snapshot. */
export function placeWithReminder(original: AgentMessage[], transformed: AgentMessage[]): AgentMessage[] {
	const moved = moveNewSnapshot(original, transformed);
	if (moved === transformed) return transformed;
	let current = -1;
	for (let i = original.length - 1; i >= 0; i--) {
		if (original[i].role === "user") { current = i; break; }
	}
	if (current < 0) return transformed;
	// The original current user object is untouched by released synchronization.
	const index = moved.indexOf(original[current]);
	if (index < 0) return transformed;
	const reminder: AgentMessage = { role: "user", timestamp: 0,
		content: [{ type: "text", text: REMINDER }] };
	return [...moved.slice(0, index), reminder, ...moved.slice(index)];
}

export default function temporalCorvus(pi: ExtensionAPI): void {
	// Same public-API interception as the early experiment; no state changes.
	const api = new Proxy(pi, {
		get(target, key) {
			if (key !== "on") return Reflect.get(target, key);
			return ((name: string, handler: (event: ContextEvent, ctx: ExtensionContext) =>
				{ messages: AgentMessage[] } | undefined | void | Promise<{ messages: AgentMessage[] } | undefined | void>) => {
				if (name !== "context") return pi.on(name as "context", handler);
				return pi.on("context", async (event, ctx) => {
					const result = await handler(event, ctx);
					return result ? { messages: placeWithReminder(event.messages, result.messages) } : result;
				});
			}) as ExtensionAPI["on"];
		},
	});
	corvus(api);
}
