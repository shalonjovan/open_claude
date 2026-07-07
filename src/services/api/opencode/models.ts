import { type ModelInfo, createOpencodeClient } from "./client";

export interface OpenCodeClientConfig {
	apiKey?: string;
	baseURL?: string;
	model?: string;
}

const DEFAULT_FREE_MODEL = "deepseek-v4-flash-free";

let cachedModels: ModelInfo[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

export async function fetchFreeModels(
	client?: ReturnType<typeof createOpencodeClient>,
): Promise<ModelInfo[]> {
	const now = Date.now();
	if (cachedModels && now - cacheTime < CACHE_TTL) return cachedModels;
	const c = client ?? createOpencodeClient({});
	try {
		const models = await c.models();
		cachedModels = models;
		cacheTime = now;
		return models;
	} catch {
		return cachedModels ?? [];
	}
}

export function getFreeModelId(models: ModelInfo[]): string {
	const toolModel = models.find((m) => m.toolCall);
	if (toolModel) return toolModel.id;
	if (models.length > 0) return models[0].id;
	return DEFAULT_FREE_MODEL;
}

export function resolveModelId(
	config: OpenCodeClientConfig,
	models?: ModelInfo[],
): string {
	if (config.model) return config.model;
	if (models && models.length > 0) return getFreeModelId(models);
	return DEFAULT_FREE_MODEL;
}
