/**
 * Result Aggregator
 * Deduplicates results across engines, aggregates by category, performs coarse ranking
 */

import { WebSearchResult } from "../entities";

interface DeduplicationResult {
  uniqueResults: WebSearchResult[];
  hitCounts: Map<string, number>;
}

/**
 * Normalize URL for deduplication
 * @param url - The URL to normalize
 * @returns Normalized URL
 */
function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // Remove trailing slash
    let normalized = urlObj.href.replace(/\/$/, "");
    // Remove www prefix
    normalized = normalized.replace(/^https?:\/\/www\./, "https://");
    // Remove common tracking parameters
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
    ];
    trackingParams.forEach(param => urlObj.searchParams.delete(param));
    return urlObj.href;
  } catch (e) {
    // Invalid URL, return as-is
    return url;
  }
}

/**
 * Deduplicate results by URL
 * @param results - Array of search results
 * @returns Deduplicated results with hit counts
 */
export function deduplicateResults(
  results: WebSearchResult[],
): DeduplicationResult {
  const urlMap = new Map<string, WebSearchResult>();
  const hitCounts = new Map<string, number>();

  for (const result of results) {
    const normalizedUrl = normalizeUrl(result.url);
    const existing = urlMap.get(normalizedUrl);

    if (existing) {
      // Keep the result with higher score
      const existingScore = existing.searxngScore || 0;
      const currentScore = result.searxngScore || 0;

      if (currentScore > existingScore) {
        urlMap.set(normalizedUrl, result);
      }

      // Merge engine lists
      const existingEngines = existing.engines || [];
      const currentEngines = result.engines || [];
      const mergedEngines = Array.from(
        new Set([...existingEngines, ...currentEngines]),
      );
      const updated = urlMap.get(normalizedUrl);
      if (updated) {
        updated.engines = mergedEngines;
      }

      // Increment hit count
      const currentHitCount = hitCounts.get(normalizedUrl) || 0;
      hitCounts.set(normalizedUrl, currentHitCount + 1);
    } else {
      urlMap.set(normalizedUrl, result);
      hitCounts.set(normalizedUrl, 1);
    }
  }

  return {
    uniqueResults: Array.from(urlMap.values()),
    hitCounts,
  };
}

/**
 * Aggregate results by category
 * @param results - Array of search results
 * @returns Map of category to results
 */
export function aggregateByCategory(
  results: WebSearchResult[],
): Map<string, WebSearchResult[]> {
  const categoryMap = new Map<string, WebSearchResult[]>();

  for (const result of results) {
    const category = result.category || "general";
    if (!categoryMap.has(category)) {
      categoryMap.set(category, []);
    }
    categoryMap.get(category)!.push(result);
  }

  return categoryMap;
}

/**
 * Perform coarse ranking using SearXNG score and hit count
 * @param results - Array of search results
 * @param hitCounts - Map of URL hit counts
 * @returns Ranked results
 */
export function coarseRank(
  results: WebSearchResult[],
  hitCounts: Map<string, number>,
): WebSearchResult[] {
  return results
    .map(result => {
      const normalizedUrl = normalizeUrl(result.url);
      const searxngScore = result.searxngScore || 0;
      const hitCount = hitCounts.get(normalizedUrl) || 0;

      // Combined score: searxngScore * (1 + hitCount * 0.1)
      const combinedScore = searxngScore * (1 + hitCount * 0.1);

      return {
        ...result,
        // Store combined score for internal use (will be used by reranker)
        _combinedScore: combinedScore,
      };
    })
    .sort((a, b) => {
      const scoreA = (a as any)._combinedScore || 0;
      const scoreB = (b as any)._combinedScore || 0;
      return scoreB - scoreA; // Descending order
    });
}

/**
 * Prepare results for reranker
 * @param results - Array of search results
 * @param limit - Maximum number of results to return
 * @returns Results formatted for reranker input
 */
export function prepareForReranker(
  results: WebSearchResult[],
  limit: number = 50,
): WebSearchResult[] {
  // Limit results and remove internal score field
  const limited = results.slice(0, limit);
  return limited.map(result => {
    const { _combinedScore, ...rest } = result as any;
    return rest;
  });
}

/**
 * Main aggregation function
 * @param results - Array of search results
 * @param maxResults - Maximum results for reranker
 * @returns Aggregated and ranked results
 */
export function aggregateResults(
  results: WebSearchResult[],
  maxResults: number = 50,
): WebSearchResult[] {
  // Step 1: Deduplicate
  const { uniqueResults, hitCounts } = deduplicateResults(results);

  // Step 2: Coarse rank
  const ranked = coarseRank(uniqueResults, hitCounts);

  // Step 3: Prepare for reranker (limit results)
  const prepared = prepareForReranker(ranked, maxResults);

  return prepared;
}
