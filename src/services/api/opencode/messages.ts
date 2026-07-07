import type { ChatMessage, ContentPart, ToolCall } from "./client";

export interface ClaudeMessage {
	role: "user" | "assistant";
	content: any[];
	message?: { id?: string };
}

export function claudeMessagesToOpenAI(
	messages: ClaudeMessage[],
	systemPrompt?: string,
): { chatMessages: ChatMessage[]; system?: string } {
	const chatMessages: ChatMessage[] = [];
	const system = systemPrompt;

	for (const msg of messages) {
		if (msg.role === "user") {
			const parts: ContentPart[] = [];
			let textContent = "";

			if (typeof msg.content === "string") {
				textContent = msg.content;
			} else {
				for (const block of msg.content ?? []) {
					if (!block || typeof block.type !== "string") continue;
					const type: string = block.type;
					if (type === "text") {
						if (textContent) textContent += "\n";
						textContent += block.text ?? "";
					} else if (type === "image") {
						const source = block.source ?? {};
						if (textContent) {
							parts.push({ type: "text", text: textContent });
							textContent = "";
						}
						parts.push({
							type: "image_url",
							image_url: {
								url: `data:${source.media_type ?? "image/jpeg"};base64,${source.data ?? ""}`,
							},
						});
					} else if (type === "tool_result") {
						if (textContent) {
							chatMessages.push({ role: "user", content: textContent });
							textContent = "";
						}
						const contentArr = Array.isArray(block.content)
							? block.content
							: [];
						const contentText = contentArr
							.map((c: any) => (c?.text ? c.text : ""))
							.join("\n")
							.trim();
						chatMessages.push({
							role: "tool",
							tool_call_id: block.tool_use_id ?? "",
							content: contentText || String(block.content ?? ""),
							name: "",
						});
					}
				}
			}

			if (textContent || parts.length > 0) {
				chatMessages.push({
					role: "user",
					content: parts.length > 0 ? parts : textContent,
				});
			}
		} else if (msg.role === "assistant") {
			let textContent = "";
			let reasoningContent = "";
			const toolCalls: ToolCall[] = [];

			for (const block of msg.content ?? []) {
				if (!block || typeof block.type !== "string") continue;
				const type: string = block.type;
				if (type === "text") {
					if (textContent) textContent += "\n";
					textContent += (block as any).text ?? "";
				} else if (type === "thinking") {
					if (reasoningContent) reasoningContent += "\n";
					reasoningContent += (block as any).thinking ?? "";
				} else if (type === "tool_use") {
					toolCalls.push({
						id: (block as any).id ?? "",
						type: "function",
						function: {
							name: (block as any).name ?? "",
							arguments: JSON.stringify((block as any).input ?? {}),
						},
					});
				}
			}

			chatMessages.push({
				role: "assistant",
				content: textContent || null,
				...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
				...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
			} as ChatMessage);
		}
	}

	return { chatMessages, system };
}

export function mergeUserMessages(chatMessages: ChatMessage[]): ChatMessage[] {
	const result: ChatMessage[] = [];
	for (const msg of chatMessages) {
		const last = result[result.length - 1];
		if (last && last.role === "user" && msg.role === "user") {
			if (typeof last.content === "string" && typeof msg.content === "string") {
				last.content += `\n${msg.content}`;
				continue;
			}
		}
		result.push(msg);
	}
	return result;
}
