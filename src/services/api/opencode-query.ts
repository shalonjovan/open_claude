import { randomUUID } from "node:crypto";
import type {
	AssistantMessage,
	Message,
	StreamEvent,
	SystemAPIErrorMessage,
} from "../../types/message.js";
import { normalizeContentFromAPI } from "../../utils/messages.js";
import type { SystemPrompt } from "../../utils/systemPromptType.js";
import {
	type ChatMessage,
	type ChatTool,
	createOpencodeClient,
} from "./opencode/client";
import { claudeMessagesToOpenAI, mergeUserMessages } from "./opencode/messages";
import {
	type AdapterEvent,
	buildAssistantMessageFromEvents,
} from "./opencode/stream";
import { convertTools } from "./opencode/tools";

export function isOpencodeEnabled(): boolean {
	const enabled = process.env.OPEN_CLAUDE_ENABLED;
	if (enabled === "true") return true;
	if (enabled === "false") return false;
	if (process.env.ANTHROPIC_API_KEY) return false;
	return true;
}

export function getOpencodeApiKey(): string {
	return process.env.OPENCODE_API_KEY || "public";
}

export function getOpencodeModel(): string {
	return process.env.OPEN_CLAUDE_MODEL || "deepseek-v4-flash-free";
}

export function getOpencodeBaseURL(): string {
	return process.env.OPEN_CLAUDE_BASE_URL || "https://opencode.ai/zen/v1";
}

export type OpencodeStreamingOptions = {
	model?: string;
	maxTokens?: number;
	temperature?: number;
};

export async function* queryModelWithOpencodeStreaming({
	messages,
	systemPrompt,
	tools,
	signal,
	options,
}: {
	messages: Message[];
	systemPrompt: SystemPrompt;
	thinkingConfig?: any;
	tools: any;
	signal: AbortSignal;
	options: any;
}): AsyncGenerator<
	StreamEvent | AssistantMessage | SystemAPIErrorMessage,
	void
> {
	const claudeMsgs = messages
		.filter((m): m is any => m.type === "assistant" || m.type === "user")
		.map((m) => ({
			role: m.type as "user" | "assistant",
			content: (m as any).message?.content ?? [],
			message: (m as any).message ? { id: (m as any).message.id } : undefined,
		}));

	const systemText = `${systemPrompt.join("\n")}\n\nAlways respond in English.`;
	const { chatMessages, system: _ } = claudeMessagesToOpenAI(
		claudeMsgs,
		systemText,
	);
	const system = systemText;
	const finalMessages = mergeUserMessages(chatMessages);

	const anthropicTools = tools.filter(Boolean) as any[];
	const openaiTools: ChatTool[] = convertTools(anthropicTools);

	const apiKey = getOpencodeApiKey();
	const model = getOpencodeModel();
	const baseURL = getOpencodeBaseURL();

	const client = createOpencodeClient({
		apiKey,
		baseURL,
		model,
	});

	const collectedEvents: AdapterEvent[] = [];

	const maxTokens = options.maxOutputTokensOverride ?? 4096;
	const temperature = options.temperatureOverride;

	const requestMessages = system
		? [
				{ role: "system" as const, content: system } as ChatMessage,
				...finalMessages,
			]
		: finalMessages;

	let thinkingBlockIndex = -1;
	let textBlockIndex = -1;
	const toolCallIndices = new Map<number, number>();

	for await (const chunk of client.streamChat(
		{
			messages: requestMessages,
			...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
			maxTokens,
			temperature,
		},
		signal,
	)) {
		for (const choice of chunk.choices ?? []) {
			const delta = choice.delta;

			if (delta.reasoning_content != null && delta.reasoning_content !== "") {
				if (thinkingBlockIndex === -1) {
					thinkingBlockIndex = collectedEvents.length;
					collectedEvents.push({
						type: "content_block_start",
						index: thinkingBlockIndex,
						content_block: {
							type: "thinking",
							thinking: delta.reasoning_content,
						},
					} as any);
					yield {
						type: "stream_event",
						event: {
							type: "content_block_start",
							index: thinkingBlockIndex,
							content_block: {
								type: "thinking",
								thinking: delta.reasoning_content,
							},
						} as any,
					};
				} else {
					collectedEvents.push({
						type: "content_block_delta",
						index: thinkingBlockIndex,
						delta: {
							type: "thinking_delta",
							thinking: delta.reasoning_content,
						},
					} as any);
					yield {
						type: "stream_event",
						event: {
							type: "content_block_delta",
							index: thinkingBlockIndex,
							delta: {
								type: "thinking_delta",
								thinking: delta.reasoning_content,
							},
						} as any,
					};
				}
			}

			if (delta.content != null && delta.content !== "") {
				if (thinkingBlockIndex !== -1) {
					collectedEvents.push({
						type: "content_block_stop",
						index: thinkingBlockIndex,
					} as any);
					yield {
						type: "stream_event",
						event: {
							type: "content_block_stop",
							index: thinkingBlockIndex,
						} as any,
					};
					thinkingBlockIndex = -1;
				}
				if (textBlockIndex === -1) {
					textBlockIndex = collectedEvents.length;
					collectedEvents.push({
						type: "content_block_start",
						index: textBlockIndex,
						content_block: { type: "text", text: delta.content },
					} as any);
					yield {
						type: "stream_event",
						event: {
							type: "content_block_start",
							index: textBlockIndex,
							content_block: { type: "text", text: delta.content },
						} as any,
					};
				} else {
					collectedEvents.push({
						type: "content_block_delta",
						index: textBlockIndex,
						delta: { type: "text_delta", text: delta.content },
					} as any);
					yield {
						type: "stream_event",
						event: {
							type: "content_block_delta",
							index: textBlockIndex,
							delta: { type: "text_delta", text: delta.content },
						} as any,
					};
				}
			}

			if (delta.tool_calls) {
				for (const tc of delta.tool_calls) {
					const toolIndex = tc.index ?? 0;
					let eventIndex = toolCallIndices.get(toolIndex);
					if (eventIndex === undefined) {
						eventIndex = collectedEvents.length;
						toolCallIndices.set(toolIndex, eventIndex);
						const id = tc.id ?? `call_${Date.now()}_${toolIndex}`;
						collectedEvents.push({
							type: "content_block_start",
							index: eventIndex,
							content_block: {
								type: "tool_use",
								id,
								name: tc.function?.name ?? "",
								input: {},
							},
						} as any);
						yield {
							type: "stream_event",
							event: {
								type: "content_block_start",
								index: eventIndex,
								content_block: {
									type: "tool_use",
									id,
									name: tc.function?.name ?? "",
									input: {},
								},
							} as any,
						};
					}
					if (tc.function?.arguments) {
						collectedEvents.push({
							type: "content_block_delta",
							index: eventIndex,
							delta: {
								type: "input_json_delta",
								partial_json: tc.function.arguments,
							},
						} as any);
						yield {
							type: "stream_event",
							event: {
								type: "content_block_delta",
								index: eventIndex,
								delta: {
									type: "input_json_delta",
									partial_json: tc.function.arguments,
								},
							} as any,
						};
					}
				}
			}

			if (choice.finish_reason) {
				if (thinkingBlockIndex !== -1) {
					collectedEvents.push({
						type: "content_block_stop",
						index: thinkingBlockIndex,
					} as any);
					yield {
						type: "stream_event",
						event: {
							type: "content_block_stop",
							index: thinkingBlockIndex,
						} as any,
					};
					thinkingBlockIndex = -1;
				}
				if (textBlockIndex !== -1) {
					collectedEvents.push({
						type: "content_block_stop",
						index: textBlockIndex,
					} as any);
					yield {
						type: "stream_event",
						event: { type: "content_block_stop", index: textBlockIndex } as any,
					};
					textBlockIndex = -1;
				}
				for (const [_, tcEventIndex] of toolCallIndices) {
					collectedEvents.push({
						type: "content_block_stop",
						index: tcEventIndex,
					} as any);
					yield {
						type: "stream_event",
						event: { type: "content_block_stop", index: tcEventIndex } as any,
					};
				}
				toolCallIndices.clear();
				const stopReason =
					choice.finish_reason === "stop"
						? "end_turn"
						: choice.finish_reason === "length"
							? "max_tokens"
							: choice.finish_reason === "tool_calls"
								? "tool_use"
								: choice.finish_reason;
				const usageData = chunk.usage
					? {
							input_tokens: chunk.usage.prompt_tokens ?? 0,
							output_tokens:
								(chunk.usage.completion_tokens ?? 0) -
								(chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0),
							...(chunk.usage.completion_tokens_details?.reasoning_tokens
								? {
										cache_creation_input_tokens: 0,
										cache_read_input_tokens: 0,
										reasoning_tokens:
											chunk.usage.completion_tokens_details.reasoning_tokens,
									}
								: {}),
						}
					: undefined;
				collectedEvents.push({
					type: "message_delta",
					delta: { stop_reason: stopReason, stop_sequence: null },
					usage: usageData,
				} as any);
				yield {
					type: "stream_event",
					event: {
						type: "message_delta",
						delta: { stop_reason: stopReason, stop_sequence: null },
						usage: usageData,
					} as any,
				};
				collectedEvents.push({ type: "message_stop" } as any);
				yield { type: "stream_event", event: { type: "message_stop" } as any };
			}
		}
	}

	const assistantMsg = buildAssistantMessageFromEvents(collectedEvents as any);
	if (assistantMsg.content.length > 0) {
		const normalizedContent = normalizeContentFromAPI(
			assistantMsg.content as any,
			tools,
			options.agentId,
		);
		yield {
			type: "assistant",
			uuid: randomUUID(),
			timestamp: new Date().toISOString(),
			message: {
				id: `oc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
				role: "assistant",
				content: normalizedContent,
				model: model,
				stop_reason: assistantMsg.stopReason ?? null,
				stop_sequence: null,
				...(assistantMsg.usage ? { usage: assistantMsg.usage } : {}),
			},
		} satisfies AssistantMessage;
	}
}
