import type { ChatStreamChunk } from "./client";

export type AdapterEvent = any;

export function finishReasonMap(reason: string): string {
	switch (reason) {
		case "stop":
			return "end_turn";
		case "length":
			return "max_tokens";
		case "tool_calls":
			return "tool_use";
		case "content_filter":
			return "content_filter";
		default:
			return reason;
	}
}

export function buildAssistantMessageFromEvents(events: any[]): {
	content: any[];
	stopReason?: string;
	usage?: any;
} {
	const content: any[] = [];
	let stopReason: string | undefined;
	let usage: any | undefined;

	for (const event of events) {
		if (
			event.type === "content_block_start" &&
			event.content_block.type === "text"
		) {
			const existing = content[event.index];
			if (existing?.type === "text") {
				existing.text += event.content_block.text;
			} else {
				content[event.index] = { ...event.content_block };
			}
		}
		if (
			event.type === "content_block_delta" &&
			event.delta?.type === "text_delta"
		) {
			const block = content[event.index];
			if (block?.type === "text") {
				block.text += event.delta.text;
			} else {
				content[event.index] = { type: "text", text: event.delta.text };
			}
		}
		if (
			event.type === "content_block_start" &&
			event.content_block.type === "thinking"
		) {
			const existing = content[event.index];
			if (existing?.type === "thinking") {
				existing.thinking += event.content_block.thinking;
			} else {
				content[event.index] = { ...event.content_block };
			}
		}
		if (
			event.type === "content_block_delta" &&
			event.delta?.type === "thinking_delta"
		) {
			const block = content[event.index];
			if (block?.type === "thinking") {
				block.thinking += event.delta.thinking;
			} else {
				content[event.index] = {
					type: "thinking",
					thinking: event.delta.thinking,
				};
			}
		}
		if (
			event.type === "content_block_start" &&
			event.content_block.type === "tool_use"
		) {
			content[event.index] = { ...event.content_block, _inputJson: "" };
		}
		if (
			event.type === "content_block_delta" &&
			event.delta?.type === "input_json_delta"
		) {
			const block = content[event.index];
			if (block?.type === "tool_use") {
				block._inputJson += event.delta.partial_json;
			}
		}
		if (event.type === "content_block_stop") {
			const block = content[event.index];
			if (block?.type === "tool_use") {
				if (block._inputJson) {
					try {
						block.input = JSON.parse(block._inputJson);
					} catch {
						console.error(
							`[opencode] Failed to parse tool args: ${block._inputJson}`,
						);
						block.input = {};
					}
					block._inputJson = undefined;
				}
			}
		}
		if (event.type === "message_delta") {
			if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
			if (event.usage) {
				usage = {
					input_tokens: event.usage.input_tokens ?? 0,
					output_tokens: event.usage.output_tokens ?? 0,
				};
			}
		}
	}

	return { content: content.filter(Boolean), stopReason, usage };
}
