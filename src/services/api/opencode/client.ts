export interface OpenCodeClient {
	readonly baseURL: string;
	readonly apiKey: string;
	readonly model: string;
	streamChat(
		request: ChatRequest,
		signal?: AbortSignal,
	): AsyncGenerator<ChatStreamChunk>;
	models(): Promise<ModelInfo[]>;
}

export interface ChatRequest {
	messages: ChatMessage[];
	tools?: ChatTool[];
	toolChoice?: "auto" | "none" | "required";
	system?: string;
	maxTokens?: number;
	temperature?: number;
}

export interface ChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | ContentPart[];
	tool_calls?: ToolCall[];
	tool_call_id?: string;
	name?: string;
	reasoning_content?: string;
}

export interface ContentPart {
	type: "text" | "image_url";
	text?: string;
	image_url?: { url: string };
}

export interface ToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

export interface ChatTool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

export interface ChatStreamChunk {
	choices: Array<{
		delta: {
			content?: string | null;
			tool_calls?: Array<{
				index: number;
				id?: string;
				type?: "function";
				function?: { name?: string; arguments?: string };
			}>;
			role?: string;
		};
		finish_reason?: "stop" | "length" | "tool_calls" | null;
		index: number;
	}>;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
	created?: number;
	id?: string;
	model?: string;
}

export interface ModelInfo {
	id: string;
	name: string;
	context: number;
	toolCall: boolean;
}

export function createOpencodeClient(config: {
	baseURL?: string;
	apiKey?: string;
	model?: string;
}): OpenCodeClient {
	const baseURL =
		config.baseURL ??
		process.env.OPEN_CLAUDE_BASE_URL ??
		"https://opencode.ai/zen/v1";
	const apiKey = config.apiKey || process.env.OPENCODE_API_KEY || "public";
	const model =
		config.model || process.env.OPEN_CLAUDE_MODEL || "deepseek-v4-flash-free";

	const client: OpenCodeClient = {
		baseURL,
		apiKey,
		model,

		async *streamChat(
			request: ChatRequest,
			signal?: AbortSignal,
		): AsyncGenerator<ChatStreamChunk> {
			const body: Record<string, unknown> = {
				model: client.model,
				messages: request.messages,
				stream: true,
			};
			if (request.tools && request.tools.length > 0) body.tools = request.tools;
			if (request.toolChoice) body.tool_choice = request.toolChoice;
			if (request.system)
				body.messages = [
					{ role: "system", content: request.system },
					...request.messages,
				];
			if (request.maxTokens) body.max_tokens = request.maxTokens;
			if (request.temperature !== undefined)
				body.temperature = request.temperature;

			const url = `${baseURL}/chat/completions`;
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
				signal,
			});

			if (!response.ok) {
				const text = await response.text();
				const err = new Error(
					`OpenCode API error ${response.status}: ${text}`,
				) as any;
				err.status = response.status;
				err.headers = response.headers;
				throw err;
			}

			const reader = response.body?.getReader();
			if (!reader) throw new Error("No response body");

			const decoder = new TextDecoder();
			let buffer = "";

			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";

					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed || !trimmed.startsWith("data:")) continue;
						const data = trimmed.slice(5).trim();
						if (data === "[DONE]") return;
						try {
							const parsed: ChatStreamChunk = JSON.parse(data);
							yield parsed;
						} catch {
							// skip malformed chunks
						}
					}
				}
			} finally {
				reader.cancel().catch(() => {});
			}
		},

		async models(): Promise<ModelInfo[]> {
			try {
				const catalogURL =
					process.env.OPENCODE_MODELS_URL ?? "https://models.dev/api.json";
				const res = await fetch(catalogURL);
				if (!res.ok) return [];
				const data = await res.json();
				const entries: ModelInfo[] = [];
				const opencodeProvider = data.opencode;
				if (opencodeProvider?.models) {
					for (const [id, m] of Object.entries(opencodeProvider.models) as [
						string,
						any,
					][]) {
						const cost = Array.isArray(m.cost)
							? m.cost
							: m.cost
								? [m.cost]
								: [];
						const isFree = cost.some((c: any) => (c.input ?? 0) === 0);
						if (!isFree) continue;
						entries.push({
							id,
							name: m.name ?? id,
							context: m.limit?.context ?? 0,
							toolCall: !!m.tool_call,
						});
					}
				}
				entries.sort((a, b) => b.context - a.context);
				return entries;
			} catch {
				return [];
			}
		},
	};

	return client;
}
