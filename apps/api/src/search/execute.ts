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
  includeExtra?: boolean;
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

  const num_results_buffer = Math.floor(limit * 2);

  // Cache check (skip for ZDR requests)
  const isZDR = options.enterprise?.includes("zdr");
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
  let expandedQueries: string[] = [query];
  let aiMetadata: any = undefined;

  if (aiMode !== "false" && config.AI_SEARCH_LLM_MODEL) {
    try {
      if (shouldExpandQuery(aiMode) || shouldClassifyIntent(aiMode)) {
        logger.info("Running AI preprocessing", { aiMode });
        const preprocessResult = await preprocessQuery(query, options.lang || "en");
        
        // Use expanded queries if expansion is enabled
        if (shouldExpandQuery(aiMode)) {
          expandedQueries = preprocessResult.expandedQueries;
          logger.info("Query expansion completed", { 
            originalQuery: query, 
            expandedQueries,
            count: expandedQueries.length 
          });
        }
        
        // Store AI metadata if classification is enabled
        if (shouldClassifyIntent(aiMode)) {
          aiMetadata = {
            intent: preprocessResult.intent,
            confidence: preprocessResult.confidence,
            firecrawlCategories: preprocessResult.firecrawlCategories,
            searxngCategories: preprocessResult.searxngCategories,
            searxngEngines: preprocessResult.searxngEngines,
            timeRange: preprocessResult.timeRange,
          };
          logger.info("Intent classification completed", aiMetadata);
        }
      }
    } catch (error) {
      logger.warn("AI preprocessing failed, using original query", { error });
      // Fallback to original query if preprocessing fails
      expandedQueries = [query];
    }
  }

  logger.info("Searching for results");

  const searchTypes = [...new Set(sources.map((s: any) => s.type))];
  const { query: searchQuery, categoryMap } = buildSearchQuery(
    query,
    categories,
  );

  const searchResponse = (await search({
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
  })) as SearchV2Response;

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

  // Aggregate results (deduplicate, coarse rank, prepare for reranker)
  // Only apply aggregation when AI features are enabled
  if (
    aiMode !== "false" &&
    config.AI_SEARCH_DEDUP_ENABLED &&
    searchResponse.web
  ) {
    searchResponse.web = aggregateResults(
      searchResponse.web,
      config.AI_SEARCH_MAX_RESULTS_FOR_RERANK,
    );
  }

  let totalResultsCount = 0;

  if (searchResponse.web && searchResponse.web.length > 0) {
    if (searchResponse.web.length > limit) {
      searchResponse.web = searchResponse.web.slice(0, limit);
    }
    totalResultsCount += searchResponse.web.length;
  }

  if (searchResponse.images && searchResponse.images.length > 0) {
    if (searchResponse.images.length > limit) {
      searchResponse.images = searchResponse.images.slice(0, limit);
    }
    totalResultsCount += searchResponse.images.length;
  }

  if (searchResponse.news && searchResponse.news.length > 0) {
    if (searchResponse.news.length > limit) {
      searchResponse.news = searchResponse.news.slice(0, limit);
    }
    totalResultsCount += searchResponse.news.length;
  }

  const creditsPerTenResults = isZDR ? 10 : 2;
  const searchCredits =
    Math.ceil(totalResultsCount / 10) * creditsPerTenResults;
  let scrapeCredits = 0;

  const shouldScrape =
    scrapeOptions?.formats && scrapeOptions.formats.length > 0;

  if (shouldScrape && scrapeOptions) {
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

  // Store result in cache (skip for ZDR requests)
  if (config.AI_SEARCH_CACHE_ENABLED && !isZDR) {
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
    } catch (error) {
      logger.warn("Failed to store search result in cache", { error });
      // Continue even if cache storage fails
    }
  }

  return {
    response: searchResponse,
    totalResultsCount,
    searchCredits,
    scrapeCredits,
    totalCredits: searchCredits + scrapeCredits,
    shouldScrape: shouldScrape ?? false,
  };
}
