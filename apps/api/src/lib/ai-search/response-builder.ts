/**
 * Response Builder
 * Assembles final response with AI metadata, handles cache storage, and formats output
 */

import { SearchV2Response } from "../entities";
import type { AIMetadata } from "../entities";

/**
 * Build search response with AI metadata
 * @param results - Search results
 * @param extra - Extra data from SearXNG
 * @param includeExtra - Whether to include extra data in response
 * @param aiMetadata - AI metadata to attach
 * @returns Formatted search response
 */
export function buildSearchResponse(
  results: SearchV2Response,
  extra: any = null,
  includeExtra: boolean = false,
  aiMetadata: AIMetadata = {},
): SearchV2Response {
  const response: SearchV2Response = { ...results };

  // Include extra data if requested
  if (includeExtra && extra) {
    response.extra = extra;
  }

  // Add AI metadata if AI features were used
  if (Object.keys(aiMetadata).length > 0) {
    (response as any).aiMetadata = aiMetadata;
  }

  return response;
}

/**
 * Add AI metadata to search response
 * @param results - Search results
 * @param aiMode - AI mode used
 * @param processingTimeMs - Total processing time
 * @param phaseTimes - Breakdown of time per phase
 * @param cacheHit - Whether cache was used
 * @param expandedQueries - Query after expansion
 * @param intent - Classified intent
 * @param reranked - Whether reranking was performed
 * @returns AIMetadata object
 */
export function addAiMetadata(params: {
  aiMode?: string;
  processingTimeMs?: number;
  phaseTimes?: Record<string, number>;
  cacheHit?: boolean;
  expandedQueries?: string[];
  intent?: string;
  reranked?: boolean;
}): AIMetadata {
  const metadata: AIMetadata = {};

  if (params.aiMode) metadata.aiMode = params.aiMode;
  if (params.processingTimeMs)
    metadata.processingTimeMs = params.processingTimeMs;
  if (params.phaseTimes) metadata.phaseTimes = params.phaseTimes;
  if (params.cacheHit !== undefined) metadata.cacheHit = params.cacheHit;
  if (params.expandedQueries) metadata.expandedQueries = params.expandedQueries;
  if (params.intent) metadata.intent = params.intent;
  if (params.reranked !== undefined) metadata.reranked = params.reranked;

  return metadata;
}

/**
 * Format response for cache storage
 * @param response - Search response
 * @param extra - Extra data
 * @returns Stringified response for cache
 */
export function formatForCache(
  response: SearchV2Response,
  extra: any = null,
): string {
  const cacheResponse = { ...response };

  // Always include extra data in cache
  if (extra) {
    cacheResponse.extra = extra;
  }

  return JSON.stringify(cacheResponse);
}

/**
 * Determine if AI metadata should be included in response
 * @param aiMode - AI mode used
 * @returns Whether to include AI metadata
 */
export function shouldIncludeAIMetadata(aiMode: string = "false"): boolean {
  return aiMode !== "false";
}
