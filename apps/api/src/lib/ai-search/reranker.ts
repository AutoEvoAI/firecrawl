/**
 * AI Reranker
 * Uses local reranker model to reorder search results by relevance to query
 *
 * Configuration:
 * - AI_SEARCH_RERANK_MODEL: Reranker model name (default: bge-reranker-v2-m3)
 * - AI_SEARCH_RERANK_PROVIDER: Provider (ollama, openai, etc.)
 * - AI_SEARCH_RERANK_ENDPOINT: Custom endpoint for reranker service
 * - AI_SEARCH_RERANK_API_KEY: API key for reranker service
 * - AI_SEARCH_RERANK_TIMEOUT: Timeout in milliseconds (default: 3000)
 */

import { WebSearchResult } from "../entities";
import { config } from "../../config";
import { logger } from "../logger";
import { getSearchRerankModel } from "../generic-ai";
import { generateObject } from "ai";
import { z } from "zod";

const rerankSchema = z.object({
  rankedIndices: z.array(z.number()),
});

/**
 * Helper function to add timeout to promises
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      logger.warn(`${operation} timed out after ${timeoutMs}ms`);
      reject(new Error(`${operation} timeout`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Rerank search results using the reranker model
 * @param query - Original search query
 * @param results - Search results to rerank
 * @param topK - Number of top results to return
 * @returns Reranked results
 */
export async function rerankResults(
  query: string,
  results: WebSearchResult[],
  topK: number = 10,
): Promise<WebSearchResult[]> {
  try {
    if (results.length === 0) {
      return [];
    }

    // Get the reranker model
    const model = getSearchRerankModel();

    // Prepare results for reranking
    const resultsText = results
      .map((r, i) => `${i + 1}. ${r.title}\n${r.description}\nURL: ${r.url}`)
      .join("\n\n");

    // Create prompt for reranking
    const prompt = `You are a search result reranker. Given a query and a list of search results, rank them by relevance to the query.

Query: ${query}

Search Results:
${resultsText}

Return a JSON array of result indices in order of relevance (most relevant first). Format: {"rankedIndices": [1, 3, 2, ...]}`;

    // Call the model to get reranking with timeout
    const { object } = await withTimeout(
      generateObject({
        model,
        prompt,
        schema: rerankSchema,
        temperature: 0,
        maxRetries: 1,
      }),
      config.AI_SEARCH_RERANK_TIMEOUT || 3000,
      "Reranking"
    );

    // Reorder results based on indices
    const reranked = object.rankedIndices
      .map((i: number) => results[i - 1])
      .filter((r: WebSearchResult) => r !== undefined);

    // If reranking failed, return original results
    if (reranked.length === 0) {
      logger.warn("Reranking failed, returning original results");
      return results.slice(0, topK);
    }

    return reranked.slice(0, topK);
  } catch (error) {
    logger.error("Reranking failed", { error });
    return results.slice(0, topK);
  }
}

/**
 * Determine if reranking should be applied
 * @param aiMode - The AI mode
 * @returns Whether to apply reranking
 */
export function shouldRerank(aiMode: string = "false"): boolean {
  return aiMode === "rerank" || aiMode === "full" || aiMode === "auto";
}
