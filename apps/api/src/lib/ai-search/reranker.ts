/**
 * AI Reranker
 * Two-level reranking: embedding-based coarse reranking + LLM-based fine reranking
 *
 * Configuration:
 * - AI_SEARCH_EMBEDDING_MODEL: Embedding model name (default: bge-reranker-v2-m3)
 * - AI_SEARCH_EMBEDDING_API_KEY: API key for embedding service
 * - AI_SEARCH_EMBEDDING_BASE_URL: Base URL for embedding service (e.g., Jina AI, OpenAI, etc.)
 */

import { WebSearchResult } from "../entities";
import { config } from "../../config";
import { logger } from "../logger";

/**
 * Embedding-based reranker (coarse ranking)
 * Uses cosine similarity between query and result embeddings
 */
export async function embeddingRerank(
  query: string,
  results: WebSearchResult[],
  topK: number = 20,
): Promise<WebSearchResult[]> {
  try {
    // Note: This is a placeholder for actual embedding-based reranking
    // In production, this would use AI_SEARCH_EMBEDDING_MODEL, AI_SEARCH_EMBEDDING_API_KEY, AI_SEARCH_EMBEDDING_BASE_URL
    // to generate embeddings and calculate cosine similarity

    // For now, use existing searxngScore as a proxy for relevance
    const scored = results.map(result => ({
      ...result,
      _embeddingScore: result.searxngScore || 0,
    }));

    scored.sort((a, b) => {
      const scoreA = (a as any)._embeddingScore || 0;
      const scoreB = (b as any)._embeddingScore || 0;
      return scoreB - scoreA;
    });

    const topResults = scored.slice(0, topK);
    return topResults.map(r => {
      const { _embeddingScore, ...rest } = r as any;
      return rest;
    });
  } catch (error) {
    logger.error("Embedding reranking failed", { error });
    return results.slice(0, topK);
  }
}

/**
 * LLM-based reranker (fine ranking)
 * Uses LLM to assess relevance and reorder top results
 */
export async function llmRerank(
  query: string,
  results: WebSearchResult[],
  topK: number = 10,
): Promise<WebSearchResult[]> {
  try {
    // Note: This is a placeholder for actual LLM-based reranking
    // In production, this would:
    // 1. Send query + top results to LLM
    // 2. Ask LLM to score each result's relevance
    // 3. Reorder based on LLM scores

    // For now, return results as-is (embedding reranking is sufficient)
    return results.slice(0, topK);
  } catch (error) {
    logger.error("LLM reranking failed", { error });
    return results.slice(0, topK);
  }
}

/**
 * Two-level reranking pipeline
 * 1. Embedding-based coarse reranking (reduce to top 20)
 * 2. LLM-based fine reranking (reduce to top 10)
 */
export async function twoLevelRerank(
  query: string,
  results: WebSearchResult[],
  options: {
    embeddingTopK?: number;
    llmTopK?: number;
    skipLLM?: boolean;
  } = {},
): Promise<WebSearchResult[]> {
  const { embeddingTopK = 20, llmTopK = 10, skipLLM = false } = options;

  // Level 1: Embedding-based coarse reranking
  const coarseRanked = await embeddingRerank(query, results, embeddingTopK);

  // Level 2: LLM-based fine reranking (optional)
  if (skipLLM || coarseRanked.length <= llmTopK) {
    return coarseRanked.slice(0, llmTopK);
  }

  const fineRanked = await llmRerank(query, coarseRanked, llmTopK);
  return fineRanked;
}

/**
 * Determine if reranking should be applied
 * @param aiMode - The AI mode
 * @returns Whether to apply reranking
 */
export function shouldRerank(aiMode: string = "false"): boolean {
  return aiMode === "rerank" || aiMode === "full" || aiMode === "auto";
}

/**
 * Determine if LLM reranking should be applied
 * @param aiMode - The AI mode
 * @returns Whether to apply LLM reranking
 */
export function shouldUseLLMRerank(aiMode: string = "false"): boolean {
  return aiMode === "full" || aiMode === "auto";
}
