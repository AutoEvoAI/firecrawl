/**
 * AI Reranker
 * Uses local reranker model to reorder search results by relevance to query
 *
 * Configuration:
 * - AI_SEARCH_RERANK_MODEL: Reranker model name (default: jina-reranker-v3)
 * - AI_SEARCH_RERANK_PROVIDER: Provider (jina, ollama, openai, etc.)
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

interface JinaRerankResponse {
  model: string;
  object: string;
  usage: {
    total_tokens: number;
  };
  results: Array<{
    index: number;
    relevance_score: number;
  }>;
}

/**
 * Helper function to add timeout to promises
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
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
 * Rerank using Jina rerank API
 */
async function rerankWithJina(
  query: string,
  results: WebSearchResult[],
  topK: number = 10,
): Promise<WebSearchResult[]> {
  // Use the standard Jina rerank endpoint
  const endpoint =
    config.AI_SEARCH_RERANK_ENDPOINT || "https://api.jina.ai/v1/rerank";
  const apiKey = config.AI_SEARCH_RERANK_API_KEY;
  const modelName = config.AI_SEARCH_RERANK_MODEL || "jina-reranker-v3";

  if (!apiKey) {
    throw new Error("AI_SEARCH_RERANK_API_KEY is required for Jina rerank API");
  }

  // Prepare documents for reranking
  const documents = results.map(r => `${r.title}\n${r.description}`);

  const response = await withTimeout(
    fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        query,
        documents,
        top_n: Math.min(topK, results.length),
        return_documents: false,
      }),
    }),
    config.AI_SEARCH_RERANK_TIMEOUT || 3000,
    "Jina rerank API call",
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    throw new Error(
      `Jina rerank API failed: ${response.status} ${response.statusText} - ${errorBody}`,
    );
  }

  const data = (await response.json()) as JinaRerankResponse;

  // Reorder results based on Jina's ranking and attach relevance_score
  const rerankedResults: WebSearchResult[] = data.results
    .map(item => ({
      ...results[item.index],
      relevanceScore: item.relevance_score,
    }))
    .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

  return rerankedResults.slice(0, topK);
}

/**
 * Rerank using LLM (fallback for non-Jina providers)
 */
async function rerankWithLLM(
  query: string,
  results: WebSearchResult[],
  topK: number = 10,
): Promise<WebSearchResult[]> {
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
    "LLM reranking",
  );

  // Reorder results based on indices
  const reranked = object.rankedIndices
    .map((i: number, index: number) => {
      const result = results[i - 1];
      if (result) {
        return {
          ...result,
          relevanceScore: Math.max(0, 1 - index / object.rankedIndices.length),
        };
      }
      return undefined;
    })
    .filter(r => r !== undefined) as WebSearchResult[];

  // If reranking failed, return original results
  if (reranked.length === 0) {
    logger.warn("LLM reranking failed, returning original results");
    return results.slice(0, topK);
  }

  return reranked.slice(0, topK);
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

    const provider = config.AI_SEARCH_RERANK_PROVIDER;

    if (provider === "jina") {
      return await rerankWithJina(query, results, topK);
    } else {
      // Use LLM-based reranking for other providers (openai, ollama, etc.)
      return await rerankWithLLM(query, results, topK);
    }
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
