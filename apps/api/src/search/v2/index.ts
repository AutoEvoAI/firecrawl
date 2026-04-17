import { SearchV2Response, SearchResultType } from "../../lib/entities";
import { config } from "../../config";
import { fire_engine_search_v2 } from "./fireEngine-v2";
import { searxng_search } from "./searxng";
import { ddgSearch } from "./ddgsearch";
import { Logger } from "winston";
import { aggregateResults } from "../../lib/ai-search/aggregator";
import { rerankResults, shouldRerank } from "../../lib/ai-search/reranker";

interface SearchOptions {
  query: string;
  logger: Logger;
  advanced?: boolean;
  num_results?: number;
  tbs?: string;
  filter?: string;
  lang?: string;
  country?: string;
  location?: string;
  proxy?: string;
  sleep_interval?: number;
  timeout?: number;
  type?: SearchResultType | SearchResultType[];
  enterprise?: ("default" | "anon" | "zdr")[];
  aiMode?: string;
  includeExtra?: boolean;
  aiMetadata?: {
    searxngCategories?: string[];
    searxngEngines?: string[];
    timeRange?: string;
  };
  queries?: string[]; // For parallel search
}

/**
 * Parallel search dispatcher for Phase 2
 * Executes multiple queries in parallel and aggregates results
 */
async function parallelSearch(
  queries: string[],
  options: SearchOptions,
): Promise<SearchV2Response> {
  const MAX_PARALLEL = 4;
  const limitedQueries = queries.slice(0, MAX_PARALLEL);

  options.logger.info(
    `Executing parallel search with ${limitedQueries.length} queries`,
  );

  const searchPromises = limitedQueries.map(async (query, index) => {
    try {
      const results = await searxng_search(query, {
        num_results: options.num_results || 5,
        tbs: options.tbs,
        filter: options.filter,
        lang: options.lang,
        country: options.country,
        location: options.location,
        categories: options.aiMetadata?.searxngCategories,
        engines: options.aiMetadata?.searxngEngines,
        time_range: options.aiMetadata?.timeRange || undefined,
        aiMode: options.aiMode,
        includeExtra: options.includeExtra,
      });

      // Tag results with query index for deduplication
      if (results.web) {
        results.web = results.web.map(r => ({
          ...r,
          _queryIndex: index,
          _query: query,
        }));
      }

      return results;
    } catch (error) {
      options.logger.error(
        `Parallel search failed for query ${index}: ${query}`,
        { error },
      );
      return {};
    }
  });

  const results = await Promise.all(searchPromises);

  // Aggregate results from all queries
  const aggregated: SearchV2Response = {};
  const allWebResults: any[] = [];

  for (const result of results) {
    if (result.web && result.web.length > 0) {
      allWebResults.push(...result.web);
    }
    if (result.news && result.news.length > 0) {
      if (!aggregated.news) aggregated.news = [];
      aggregated.news.push(...result.news);
    }
    if (result.images && result.images.length > 0) {
      if (!aggregated.images) aggregated.images = [];
      aggregated.images.push(...result.images);
    }

    // Merge Phase 6 top-level extra fields
    if (result.suggestions && !aggregated.suggestions) {
      aggregated.suggestions = result.suggestions;
    }
    if (result.answers && !aggregated.answers) {
      aggregated.answers = result.answers;
    }
    if (result.corrections && !aggregated.corrections) {
      aggregated.corrections = result.corrections;
    }
    if (result.knowledgeCards && !aggregated.knowledgeCards) {
      aggregated.knowledgeCards = result.knowledgeCards;
    }
  }

  // Deduplicate and rank aggregated results
  if (allWebResults.length > 0) {
    aggregated.web = aggregateResults(
      allWebResults,
      config.AI_SEARCH_MAX_RESULTS_FOR_RERANK || 20,
    );

    // Apply AI reranking if enabled
    if (shouldRerank(options.aiMode || "false")) {
      options.logger.info("Applying AI reranking");
      aggregated.web = await rerankResults(
        options.query,
        aggregated.web,
        options.num_results || 10,
      );
    }
  }

  options.logger.info(
    `Parallel search completed with ${aggregated.web?.length || 0} results`,
  );
  return aggregated;
}

export async function search(
  options: SearchOptions,
): Promise<SearchV2Response> {
  const {
    query,
    logger,
    advanced = false,
    num_results = 5,
    tbs = undefined,
    filter = undefined,
    lang = "en",
    country = "us",
    location = undefined,
    proxy = undefined,
    sleep_interval = 0,
    timeout = 5000,
    type = undefined,
    enterprise = undefined,
    aiMode = "false",
    includeExtra = false,
    aiMetadata,
    queries,
  } = options;

  try {
    // Use parallel search if AI mode is enabled and multiple queries are provided
    if (aiMode !== "false" && queries && queries.length > 1) {
      logger.info("Using parallel search for AI-enhanced query");
      return await parallelSearch(queries, options);
    }

    // Original single query search path
    if (config.FIRE_ENGINE_BETA_URL) {
      logger.info("Using fire engine search");
      const results = await fire_engine_search_v2(query, {
        numResults: num_results,
        tbs,
        filter,
        lang,
        country,
        location,
        type,
        enterprise,
      });

      return results;
    }

    if (config.SEARXNG_ENDPOINT) {
      logger.info("Using searxng search");
      const results = await searxng_search(query, {
        num_results,
        tbs,
        filter,
        lang,
        country,
        location,
        categories: aiMetadata?.searxngCategories,
        engines: aiMetadata?.searxngEngines,
        time_range: aiMetadata?.timeRange || undefined,
        aiMode,
        includeExtra,
      });
      if (results.web && results.web.length > 0) return results;
    }

    logger.info("Using DuckDuckGo search");
    const ddgResults = await ddgSearch(query, num_results, {
      tbs,
      lang,
      country,
      proxy,
      timeout,
    });
    if (ddgResults.web && ddgResults.web.length > 0) return ddgResults;

    // Fallback to empty response
    return {};
  } catch (error) {
    logger.error(`Error in search function`, { error });
    return {};
  }
}
