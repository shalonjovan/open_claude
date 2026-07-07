import type { ChatTool } from "./client";

export function anthropicToolToOpenAI(tool: any): ChatTool {
	return {
		type: "function",
		function: {
			name: tool.name ?? "",
			description: tool.description ?? "",
			parameters: (tool.input_schema ?? {
				type: "object",
				properties: {},
			}) as Record<string, unknown>,
		},
	};
}

export function convertTools(tools: any[]): ChatTool[] {
	return tools.map(anthropicToolToOpenAI);
}
