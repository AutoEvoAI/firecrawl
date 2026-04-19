import type { Logger } from "winston";
import { search } from "./v2";
import { SearchV2Response } from "../lib/entities";
import {
  buildSearchQuery,
  getCategoryFromUrl,
  CategoryOption,
} from "../lib/search-query-builder";
import { ScrapeOptions, TeamFlags } from "../controllers/v2/types";
import {
  getItemsToScrape,
  scrapeSearchResults,
  mergeScrapedContent,
  calculateScrapeCredits,
} from "./scrape";
import { trackSearchResults, trackSearchRequest } from "../lib/tracking";
import type { BillingMetadata } from "../services/billing/types";
import { config } from "../config";
import {
  getCacheKey,
  getSearchResult,
  setSearchResult,
  getTTLByMode,
} from "../lib/search-cache";
import { aggregateResults } from "../lib/ai-search/aggregator";
import {
  preprocessQuery,
  shouldExpandQuery,
  shouldClassifyIntent,
} from "../lib/ai-search/preprocessor";
import {
  mapCategoriesToSearXNG,
  applyQueryRewrite,
} from "../lib/ai-search/category-mapper";
import { rerankResults, shouldRerank } from "../lib/ai-search/reranker";

interface SearchOptions {
  query: string;
  limit: number;
  tbs?: string;
  filter?: string;
  lang?: string;
  country?: string;
  location?: string;
  sources: Array<{ type: string }>;
  categories?: CategoryOption[];
  enterprise?: ("default" | "anon" | "zdr")[];
  scrapeOptions?: ScrapeOptions;
  timeout: number;
  aiMode?: string;
  includeExtra?: boolean | string[];
}

interface SearchContext {
  teamId: string;
  origin: string;
  apiKeyId: number | null;
  flags: TeamFlags;
  requestId: string;
  jobId: string;
  apiVersion: string;
  bypassBilling?: boolean;
  zeroDataRetention?: boolean;
  billing?: BillingMetadata;
  agentIndexOnly?: boolean;
}

interface SearchExecuteResult {
  response: SearchV2Response;
  totalResultsCount: number;
  searchCredits: number;
  scrapeCredits: number;
  totalCredits: number;
  shouldScrape: boolean;
}

export async function executeSearch(
  options: SearchOptions,
  context: SearchContext,
  logger: Logger,
): Promise<SearchExecuteResult> {
  const {
    query,
    limit,
    sources,
    categories,
    scrapeOptions,
    aiMode = "false",
  } = options;
  const {
    teamId,
    origin,
    apiKeyId,
    flags,
    requestId,
    bypassBilling,
    zeroDataRetention,
    billing,
  } = context;

  const startTime = Date.now();
  const perfLog = (step: string, duration: number) => {
    logger.info(`PERF [${step}]: ${duration}ms`);
  };
  const num_results_buffer = Math.floor(limit * 2);

  // Cache check (skip for ZDR requests)
  const isZDR = options.enterprise?.includes("zdr");
  const cacheCheckStart = Date.now();
  if (config.AI_SEARCH_CACHE_ENABLED && !isZDR) {
    const cacheKey = getCacheKey(query, aiMode, {
      limit,
      tbs: options.tbs,
      filter: options.filter,
      lang: options.lang,
      country: options.country,
      location: options.location,
      categories: categories as string[],
      sources: sources.map(s => s.type),
    });
    const cachedResult = await getSearchResult(cacheKey);
    perfLog("cache_check", Date.now() - cacheCheckStart);
    if (cachedResult) {
      try {
        const parsedResult = JSON.parse(cachedResult) as SearchV2Response;
        logger.info("Cache hit, returning cached search results");
        return {
          response: parsedResult,
          totalResultsCount:
            (parsedResult.web?.length || 0) +
            (parsedResult.images?.length || 0) +
            (parsedResult.news?.length || 0),
          searchCredits: 0, // Cached results don't consume credits
          scrapeCredits: 0,
          totalCredits: 0,
          shouldScrape: false,
        };
      } catch (error) {
        logger.warn("Failed to parse cached result", { error });
        // Continue with normal search if cache parse fails
      }
    }
  }

  // AI Preprocessing (query expansion and intent classification)
  let expandedQueries: string[] = [];
  let aiMetadata: any = undefined;

  logger.info("AI Search - Starting search", {
    query,
    aiMode,
    includeExtra: options.includeExtra,
    hasLLMModel: !!config.AI_SEARCH_LLM_MODEL,
  });

  const searchTypes = [...new Set(sources.map((s: any) => s.type))];
  const { query: searchQuery, categoryMap } = buildSearchQuery(
    query,
    categories,
  );

  let searchResponse: SearchV2Response = {
    web: [],
    images: [],
    news: [],
  };

  if (aiMode !== "false" && config.AI_SEARCH_LLM_MODEL) {
    // Phase 2 Pipeline optimization: Launch original query to SearXNG IMMEDIATELY
    const originalSearchPromise = search({
      query: searchQuery,
      logger,
      advanced: false,
      num_results: num_results_buffer,
      tbs: options.tbs,
      filter: options.filter,
      lang: options.lang,
      country: options.country,
      location: options.location,
      type: searchTypes,
      enterprise: options.enterprise,
      aiMode,
      includeExtra: options.includeExtra,
      // No aiMetadata for original query as it hasn't been generated yet
    });

    try {
      if (shouldExpandQuery(aiMode) || shouldClassifyIntent(aiMode)) {
        logger.info("AI Search - Running AI preprocessing", { aiMode });
        const preprocessStart = Date.now();
        const preprocessResult = await preprocessQuery(
          query,
          options.lang || "en",
        );
        perfLog("ai_preprocessing", Date.now() - preprocessStart);
        logger.info("AI Search - Preprocessing result", {
          hasExpandedQueries: !!preprocessResult.expandedQueries,
          expandedQueryCount: preprocessResult.expandedQueries?.length,
          intent: preprocessResult.intent,
          confidence: preprocessResult.confidence,
        });

        // Use expanded queries if expansion is enabled
        if (shouldExpandQuery(aiMode) && preprocessResult.expandedQueries) {
          expandedQueries = preprocessResult.expandedQueries.filter(
            q => q !== query && q !== searchQuery,
          );
          logger.info("AI Search - Query expansion completed", {
            originalQuery: query,
            expandedQueries,
            count: expandedQueries.length,
          });
        }

        // Store AI metadata if classification is enabled
        if (shouldClassifyIntent(aiMode)) {
          // Apply dual-track category mapping
          const categoryMapping = mapCategoriesToSearXNG(
            preprocessResult.firecrawlCategories,
          );

          const mergedCategories = [
            ...(preprocessResult.searxngCategories || []),
            ...(categoryMapping.searxngCategories || []),
          ];

          const mergedEngines = [
            ...(preprocessResult.searxngEngines || []),
            ...(categoryMapping.searxngEngines || []),
          ];

          aiMetadata = {
            intent: preprocessResult.intent,
            confidence: preprocessResult.confidence,
            firecrawlCategories: preprocessResult.firecrawlCategories,
            searxngCategories: [...new Set(mergedCategories)],
            searxngEngines: [...new Set(mergedEngines)],
            timeRange: preprocessResult.timeRange,
            expandedQueries: preprocessResult.expandedQueries || [],
            rerankModel: config.AI_SEARCH_RERANK_MODEL,
          };
          logger.info(
            "AI Search - Intent classification completed",
            aiMetadata,
          );
        }
      }
    } catch (error) {
      logger.warn("AI preprocessing failed", { error });
    }

    // Launch expanded queries in parallel
    const searchPromises: Promise<SearchV2Response>[] = [originalSearchPromise];

    if (expandedQueries.length > 0) {
      // Limit to max 3 expanded queries
      const limitedExpandedQueries = expandedQueries.slice(0, 3);
      const expandedSearchStart = Date.now();
      const expandedPromises = limitedExpandedQueries.map(q =>
        search({
          query: q,
          logger,
          advanced: false,
          num_results: num_results_buffer,
          tbs: options.tbs,
          filter: options.filter,
          lang: options.lang,
          country: options.country,
          location: options.location,
          type: searchTypes,
          enterprise: options.enterprise,
          aiMode,
          includeExtra: options.includeExtra,
          aiMetadata, // Pass AI inferred metadata to expanded queries
        }),
      );
      searchPromises.push(...expandedPromises);
    }

    // Wait for all searches
    const searchStart = Date.now();
    const results = await Promise.all(searchPromises);
    perfLog("all_searches", Date.now() - searchStart);

    // Aggregate results from original and expanded queries
    const allWebResults: any[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const q = i === 0 ? searchQuery : expandedQueries[i - 1];

      if (result.web && result.web.length > 0) {
        // Tag with query info for deduplication visibility
        result.web.forEach(r => {
          r._query = q;
        });
        allWebResults.push(...result.web);
      }

      if (result.news && result.news.length > 0) {
        if (!searchResponse.news) searchResponse.news = [];
        searchResponse.news.push(...result.news);
      }
      if (result.images && result.images.length > 0) {
        if (!searchResponse.images) searchResponse.images = [];
        searchResponse.images.push(...result.images);
      }

      // Merge Phase 6 top-level extra fields
      if (result.suggestions && !searchResponse.suggestions)
        searchResponse.suggestions = result.suggestions;
      if (result.answers && !searchResponse.answers)
        searchResponse.answers = result.answers;
      if (result.corrections && !searchResponse.corrections)
        searchResponse.corrections = result.corrections;
      if (result.knowledgeCards && !searchResponse.knowledgeCards)
        searchResponse.knowledgeCards = result.knowledgeCards;
    }

    // Process web results (deduplicate and rerank)
    if (allWebResults.length > 0) {
      searchResponse.web = allWebResults;
    }
    perfLog("result_aggregation", Date.now() - searchStart);
  } else {
    // Non-AI path
    logger.info("Searching for results");
    const searchStart = Date.now();
    searchResponse = (await search({
      query: searchQuery,
      logger,
      advanced: false,
      num_results: num_results_buffer,
      tbs: options.tbs,
      filter: options.filter,
      lang: options.lang,
      country: options.country,
      location: options.location,
      type: searchTypes,
      enterprise: options.enterprise,
      aiMode,
      includeExtra: options.includeExtra,
    })) as SearchV2Response;
  }

  // Phase 6: Add aiMetadata to response if it exists and includeExtra is true
  if (aiMetadata && options.includeExtra) {
    aiMetadata.processingTimeMs = Date.now() - startTime;
    searchResponse.aiMetadata = aiMetadata;
    logger.info("AI Search - aiMetadata added to response", aiMetadata);
  }

  if (searchResponse.web && searchResponse.web.length > 0) {
    searchResponse.web = searchResponse.web.map(result => ({
      ...result,
      category: getCategoryFromUrl(result.url, categoryMap),
    }));
  }

  if (searchResponse.news && searchResponse.news.length > 0) {
    searchResponse.news = searchResponse.news.map(result => ({
      ...result,
      category: result.url
        ? getCategoryFromUrl(result.url, categoryMap)
        : undefined,
    }));
  }

  // Aggregate results (deduplicate, coarse rank)
  if (
    aiMode !== "false" &&
    config.AI_SEARCH_DEDUP_ENABLED &&
    searchResponse.web &&
    searchResponse.web.length > 0
  ) {
    logger.info("AI Search - Applying aggregation", {
      webCount: searchResponse.web.length,
      dedupEnabled: config.AI_SEARCH_DEDUP_ENABLED,
    });
    const aggregateStart = Date.now();
    const totalCandidates = searchResponse.web.length;
    searchResponse.web = aggregateResults(
      searchResponse.web,
      config.AI_SEARCH_MAX_RESULTS_FOR_RERANK,
    );
    perfLog("aggregation", Date.now() - aggregateStart);
    if (aiMetadata) {
      aiMetadata.totalCandidates = totalCandidates;
    }
    logger.info("AI Search - Aggregation completed", {
      webCount: searchResponse.web.length,
    });
  }

  // Apply AI reranking if enabled (Must happen AFTER aggregation/coarse rank)
  if (
    aiMode !== "false" &&
    searchResponse.web &&
    searchResponse.web.length > 0 &&
    shouldRerank(aiMode)
  ) {
    logger.info("AI Search - Applying AI reranking");
    const rerankStart = Date.now();
    searchResponse.web = await rerankResults(
      query,
      searchResponse.web,
      limit, // Ask reranker for final requested limit
    );
    perfLog("reranking", Date.now() - rerankStart);
  }

  let totalResultsCount = 0;

  if (searchResponse.web && searchResponse.web.length > 0) {
    logger.info("AI Search - Processing web results", {
      count: searchResponse.web.length,
      limit,
    });
    if (searchResponse.web.length > limit) {
      searchResponse.web = searchResponse.web.slice(0, limit);
    }
    // Add fallback relevanceScore if not already provided by reranker
    if (aiMode !== "false") {
      searchResponse.web = searchResponse.web.map((result, index) => ({
        ...result,
        relevanceScore:
          result.relevanceScore !== undefined
            ? result.relevanceScore
            : result.searxngScore
              ? Math.min(1, result.searxngScore)
              : Math.max(0, 1 - index / (searchResponse.web?.length || 1)),
      }));
    }
    // Clean up internal fields from final response
    searchResponse.web = searchResponse.web.map(result => {
      const {
        searxngScore,
        engines,
        _query,
        _queryIndex,
        publishedDate,
        ...cleanResult
      } = result;
      // Only include publishedDate if it has a value
      const finalResult = { ...cleanResult };
      if (publishedDate) {
        (finalResult as any).publishedDate = publishedDate;
      }
      return finalResult;
    });
    totalResultsCount += searchResponse.web.length;
  }

  if (searchResponse.images && searchResponse.images.length > 0) {
    if (searchResponse.images.length > limit) {
      searchResponse.images = searchResponse.images.slice(0, limit);
    }
    // Add relevanceScore if aiMode is enabled
    if (aiMode !== "false") {
      searchResponse.images = searchResponse.images.map((result, index) => ({
        ...result,
        relevanceScore: Math.max(
          0,
          1 - index / (searchResponse.images?.length || 1),
        ),
      }));
    }
    // Clean up internal fields from final response
    searchResponse.images = searchResponse.images.map(result => {
      const {
        searxngScore,
        engines,
        _query,
        _queryIndex,
        publishedDate,
        ...cleanResult
      } = result;
      const finalResult = { ...cleanResult };
      if (publishedDate) {
        (finalResult as any).publishedDate = publishedDate;
      }
      return finalResult;
    });
    totalResultsCount += searchResponse.images.length;
  }

  if (searchResponse.news && searchResponse.news.length > 0) {
    if (searchResponse.news.length > limit) {
      searchResponse.news = searchResponse.news.slice(0, limit);
    }
    // Add relevanceScore if aiMode is enabled
    if (aiMode !== "false") {
      searchResponse.news = searchResponse.news.map((result, index) => ({
        ...result,
        relevanceScore: Math.max(
          0,
          1 - index / (searchResponse.news?.length || 1),
        ),
      }));
    }
    // Clean up internal fields from final response
    searchResponse.news = searchResponse.news.map(result => {
      const {
        searxngScore,
        engines,
        _query,
        _queryIndex,
        publishedDate,
        ...cleanResult
      } = result;
      const finalResult = { ...cleanResult };
      if (publishedDate) {
        (finalResult as any).publishedDate = publishedDate;
      }
      return finalResult;
    });
    totalResultsCount += searchResponse.news.length;
  }

  const creditsPerTenResults = isZDR ? 10 : 2;
  const searchCredits =
    Math.ceil(totalResultsCount / 10) * creditsPerTenResults;
  let scrapeCredits = 0;

  const shouldScrape =
    scrapeOptions?.formats && scrapeOptions.formats.length > 0;

  if (shouldScrape && scrapeOptions) {
    const scrapeStart = Date.now();
    const itemsToScrape = getItemsToScrape(searchResponse, flags);

    if (itemsToScrape.length > 0) {
      const scrapeOpts = {
        teamId,
        origin,
        timeout: options.timeout,
        scrapeOptions,
        bypassBilling: bypassBilling ?? false,
        apiKeyId,
        zeroDataRetention,
        requestId,
        billing,
        agentIndexOnly: context.agentIndexOnly,
      };

      const allDocsWithCostTracking = await scrapeSearchResults(
        itemsToScrape.map(i => i.scrapeInput),
        scrapeOpts,
        logger,
        flags,
      );

      mergeScrapedContent(
        searchResponse,
        itemsToScrape,
        allDocsWithCostTracking,
      );
      scrapeCredits = calculateScrapeCredits(allDocsWithCostTracking);
      perfLog("scraping", Date.now() - scrapeStart);
    }
  }

  const scrapeFormats = scrapeOptions?.formats
    ? scrapeOptions.formats.map((f: any) =>
        typeof f === "string" ? f : f.type,
      )
    : [];

  trackSearchRequest({
    searchId: context.jobId,
    requestId: context.requestId,
    teamId,
    query,
    origin,
    kind: billing?.endpoint ?? "search",
    apiVersion: context.apiVersion,
    lang: options.lang,
    country: options.country,
    sources: searchTypes,
    numResults: totalResultsCount,
    searchCredits,
    scrapeCredits,
    totalCredits: searchCredits + scrapeCredits,
    hasScrapeFormats: shouldScrape ?? false,
    scrapeFormats,
    isSuccessful: true,
    timeTaken: 0, // filled by caller if needed
    zeroDataRetention: zeroDataRetention ?? false,
  }).catch(err =>
    logger.warn("Search request tracking failed", { error: err }),
  );

  trackSearchResults({
    searchId: context.jobId,
    teamId,
    response: searchResponse,
    zeroDataRetention: zeroDataRetention ?? false,
    hasScrapeFormats: shouldScrape ?? false,
  }).catch(err => logger.warn("Search tracking failed", { error: err }));

  // Filter extra fields based on includeExtra parameter (Phase 6)
  const includeExtra = options.includeExtra;
  if (!includeExtra) {
    delete searchResponse.suggestions;
    delete searchResponse.answers;
    delete searchResponse.corrections;
    delete searchResponse.knowledgeCards;
    delete searchResponse.aiMetadata;
    delete searchResponse.extra; // Remove deprecated nested field
  } else if (Array.isArray(includeExtra)) {
    if (!includeExtra.includes("suggestions"))
      delete searchResponse.suggestions;
    if (!includeExtra.includes("answers")) delete searchResponse.answers;
    if (!includeExtra.includes("corrections"))
      delete searchResponse.corrections;
    if (
      !includeExtra.includes("knowledgeCards") &&
      !includeExtra.includes("infoboxes")
    ) {
      delete searchResponse.knowledgeCards;
    }
    if (!includeExtra.includes("aiMetadata")) delete searchResponse.aiMetadata;
    delete searchResponse.extra;
  }

  // Store result in cache (skip for ZDR requests)
  if (config.AI_SEARCH_CACHE_ENABLED && !isZDR) {
    const cacheStoreStart = Date.now();
    try {
      const cacheKey = getCacheKey(query, aiMode, {
        limit,
        tbs: options.tbs,
        filter: options.filter,
        lang: options.lang,
        country: options.country,
        location: options.location,
        categories: categories as string[],
        sources: sources.map(s => s.type),
      });
      const ttl = getTTLByMode(aiMode, options.tbs);
      await setSearchResult(cacheKey, JSON.stringify(searchResponse), ttl);
      logger.info("Search result stored in cache", { ttl, aiMode });
      perfLog("cache_store", Date.now() - cacheStoreStart);
    } catch (error) {
      logger.warn("Failed to store search result in cache", { error });
      // Continue even if cache storage fails
    }
  }

  perfLog("total_execute", Date.now() - startTime);
  return {
    response: searchResponse,
    totalResultsCount,
    searchCredits,
    scrapeCredits,
    totalCredits: searchCredits + scrapeCredits,
    shouldScrape: shouldScrape ?? false,
  };
}
