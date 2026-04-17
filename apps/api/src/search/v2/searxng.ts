import axios from "axios";
import http from "http";
import https from "https";
import { config } from "../../config";
import { SearchV2Response, WebSearchResult } from "../../lib/entities";
import { logger } from "../../lib/logger";
import {
  parseSearXNGResponse,
  shouldIncludeExtra,
  formatExtraForResponse,
  classifyResults,
  ClassifiedResult,
} from "../../lib/ai-search/result-parser";

// Create axios instance with keep-alive connection pool
const axiosInstance = axios.create({
  httpAgent: new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: 5000,
  }),
  httpsAgent: new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: 5000,
  }),
});

interface SearchOptions {
  tbs?: string;
  filter?: string;
  lang?: string;
  country?: string;
  location?: string;
  num_results: number;
  page?: number;
  categories?: string[];
  engines?: string[];
  time_range?: string;
  safesearch?: string;
  aiMode?: string;
  includeExtra?: boolean | string[];
}

interface SearXNGResult {
  url: string;
  title: string;
  content: string;
  score?: number;
  engines?: string[];
  category?: string;
  publishedDate?: string;
  author?: string;
  img_src?: string;
  thumbnail_src?: string;
  [key: string]: any;
}

interface SearXNGResponse {
  results: SearXNGResult[];
  answers: any[];
  infoboxes: any[];
  suggestions: string[];
  corrections: string[];
  engine_data: Record<string, Record<string, string>>;
}

export async function searxng_search(
  q: string,
  options: SearchOptions,
): Promise<SearchV2Response> {
  const resultsPerPage = 20;
  const requestedResults = Math.max(options.num_results, 0);
  const startPage = options.page ?? 1;

  const url = config.SEARXNG_ENDPOINT!;
  const cleanedUrl = url.endsWith("/") ? url.slice(0, -1) : url;
  const finalUrl = cleanedUrl + "/search";

  const fetchPage = async (
    page: number,
  ): Promise<{
    results: WebSearchResult[];
    fullResponse: SearXNGResponse | null;
    classifiedResults?: {
      web: ClassifiedResult[];
      news: ClassifiedResult[];
      images: ClassifiedResult[];
    };
  }> => {
    const params: Record<string, any> = {
      q: q,
      language: options.lang || "en",
      pageno: page,
      format: "json",
    };

    // Map engines from config or options
    if (options.engines && options.engines.length > 0) {
      params.engines = options.engines.join(",");
    } else if (config.SEARXNG_ENGINES) {
      params.engines = config.SEARXNG_ENGINES;
    }

    // Map categories from config or options
    if (options.categories && options.categories.length > 0) {
      params.categories = options.categories.join(",");
    } else if (config.SEARXNG_CATEGORIES) {
      params.categories = config.SEARXNG_CATEGORIES;
    }

    // Map time_range (tbs parameter)
    // Mapping: qdr:h/qdr:d -> day, qdr:w/qdr:m -> month, qdr:y -> year
    if (options.tbs) {
      if (options.tbs.includes("h") || options.tbs.includes("d")) {
        params.time_range = "day";
      } else if (options.tbs.includes("w") || options.tbs.includes("m")) {
        params.time_range = "month";
      } else if (options.tbs.includes("y")) {
        params.time_range = "year";
      }
    }

    // Map safesearch (convert string values to numeric for SearXNG)
    let safesearchValue = "0"; // default: no filtering
    if (options.safesearch) {
      if (options.safesearch === "moderate" || options.safesearch === "1") {
        safesearchValue = "1";
      } else if (
        options.safesearch === "strict" ||
        options.safesearch === "2"
      ) {
        safesearchValue = "2";
      } else if (options.safesearch === "off" || options.safesearch === "0") {
        safesearchValue = "0";
      } else {
        safesearchValue = options.safesearch;
      }
    } else if (config.AI_SEARCH_SAFESEARCH) {
      if (
        config.AI_SEARCH_SAFESEARCH === "moderate" ||
        config.AI_SEARCH_SAFESEARCH === "1"
      ) {
        safesearchValue = "1";
      } else if (
        config.AI_SEARCH_SAFESEARCH === "strict" ||
        config.AI_SEARCH_SAFESEARCH === "2"
      ) {
        safesearchValue = "2";
      } else if (
        config.AI_SEARCH_SAFESEARCH === "off" ||
        config.AI_SEARCH_SAFESEARCH === "0"
      ) {
        safesearchValue = "0";
      } else {
        safesearchValue = config.AI_SEARCH_SAFESEARCH;
      }
    }
    params.safesearch = safesearchValue;

    // Note: gl (country) and location are not directly supported by SearXNG
    // They can be handled through language parameter or engine-specific settings

    try {
      logger.info("AI Search - SearXNG request", {
        finalUrl,
        params,
        aiMode: options.aiMode,
        includeExtra: options.includeExtra,
      });
      const response = await axiosInstance.get(finalUrl, {
        headers: {
          "Content-Type": "application/json",
        },
        params: params,
        timeout: 5000, // Increased timeout to 5000ms to handle slow search engine responses
      });

      const data = response.data;
      logger.info("AI Search - SearXNG response received", {
        hasResults: Array.isArray(data.results),
        resultCount: data.results?.length,
        hasSuggestions: !!data.suggestions,
        hasAnswers: !!data.answers,
        hasCorrections: !!data.corrections,
        hasInfoboxes: !!data.infoboxes,
        dataKeys: Object.keys(data),
      });

      if (data && Array.isArray(data.results)) {
        // Classify results into web/news/images buckets
        const classified = classifyResults(data.results);
        logger.info("AI Search - Results classified", {
          webCount: classified.web.length,
          newsCount: classified.news.length,
          imagesCount: classified.images.length,
        });

        // Convert ClassifiedResult to WebSearchResult (preserving metadata)
        const webResults: WebSearchResult[] = classified.web.map(
          (r: ClassifiedResult) => ({
            url: r.url,
            title: r.title,
            description: r.description,
            // SearXNG metadata for internal use (reranking, aggregation)
            searxngScore: r.searxngScore,
            engines: r.engines,
            category: r.category,
            publishedDate: r.publishedDate,
            author: r.author,
          }),
        );

        logger.info("AI Search - fetchPage returning", {
          resultCount: webResults.length,
          hasFullResponse: !!data,
        });
        return {
          results: webResults,
          fullResponse: data as SearXNGResponse,
          classifiedResults: classified,
        };
      }

      logger.info("AI Search - fetchPage returning null (no results)");
      return { results: [], fullResponse: null };
    } catch (error) {
      logger.error(`SearXNG search failed for page ${page}`, { error, params });
      return { results: [], fullResponse: null };
    }
  };

  try {
    if (requestedResults === 0) {
      return {};
    }

    const pagesToFetch = Math.max(
      1,
      Math.ceil(requestedResults / resultsPerPage),
    );
    let webResults: WebSearchResult[] = [];
    let newsResults: WebSearchResult[] = [];
    let imagesResults: WebSearchResult[] = [];
    let fullResponse: SearXNGResponse | null = null;

    for (let pageOffset = 0; pageOffset < pagesToFetch; pageOffset += 1) {
      const {
        results: pageResults,
        fullResponse: pageResponse,
        classifiedResults: pageClassified,
      } = await fetchPage(startPage + pageOffset);

      logger.info("AI Search - Page fetched", {
        pageOffset,
        resultCount: pageResults.length,
        hasPageResponse: !!pageResponse,
      });

      if (pageResults.length === 0) {
        break;
      }

      webResults = webResults.concat(pageResults);

      // Add news and images results if available
      if (pageClassified) {
        newsResults = newsResults.concat(
          pageClassified.news.map((r: ClassifiedResult) => ({
            url: r.url,
            title: r.title,
            description: r.description,
            searxngScore: r.searxngScore,
            engines: r.engines,
            category: r.category,
            publishedDate: r.publishedDate,
            author: r.author,
          })),
        );

        imagesResults = imagesResults.concat(
          pageClassified.images.map((r: ClassifiedResult) => ({
            url: r.url,
            title: r.title,
            description: r.description,
            searxngScore: r.searxngScore,
            engines: r.engines,
            category: r.category,
            publishedDate: r.publishedDate,
            author: r.author,
          })),
        );
      }

      // Keep the first page's full response for extra data
      if (pageResponse && !fullResponse) {
        fullResponse = pageResponse;
        logger.info("AI Search - fullResponse set from page", { pageOffset });
      }

      if (webResults.length >= requestedResults) {
        break;
      }
    }

    const response: SearchV2Response = {};

    if (webResults.length > 0) {
      response.web = webResults.slice(0, requestedResults);
    }

    if (newsResults.length > 0) {
      response.news = newsResults;
    }

    if (imagesResults.length > 0) {
      response.images = imagesResults;
    }

    // Parse and include extra data if requested
    logger.info("AI Search - Before extra data check", {
      hasFullResponse: !!fullResponse,
    });
    if (fullResponse) {
      const aiMode = options.aiMode || "false";
      const includeExtra = options.includeExtra || false;
      const shouldInclude = shouldIncludeExtra(includeExtra, aiMode);
      logger.info("AI Search - Checking if extra data should be included", {
        aiMode,
        includeExtra,
        shouldInclude,
      });

      if (shouldInclude) {
        logger.info("AI Search - Parsing extra data from SearXNG response");
        const extra = parseSearXNGResponse(fullResponse);
        logger.info("AI Search - Formatting extra data for response", {
          includeExtra,
        });

        // Phase 6: Expand extra fields to top level instead of nesting under 'extra'
        const formattedExtra = formatExtraForResponse(extra, includeExtra);
        if (formattedExtra.suggestions) {
          response.suggestions = formattedExtra.suggestions;
        }
        if (formattedExtra.answers) {
          response.answers = formattedExtra.answers;
        }
        if (formattedExtra.corrections) {
          response.corrections = formattedExtra.corrections;
        }
        if (formattedExtra.infoboxes) {
          response.knowledgeCards = formattedExtra.infoboxes;
        }
        logger.info("AI Search - Extra data added to response", {
          hasSuggestions: !!response.suggestions,
          hasAnswers: !!response.answers,
          hasCorrections: !!response.corrections,
          hasKnowledgeCards: !!response.knowledgeCards,
        });
      } else {
        logger.info(
          "AI Search - Extra data not included (shouldIncludeExtra returned false)",
        );
      }
    } else {
      logger.info("AI Search - Extra data not included (fullResponse is null)");
    }

    logger.info("AI Search - SearXNG search completed", {
      webCount: response.web?.length,
      hasExtra: !!response.extra,
    });
    return response;
  } catch (error) {
    logger.error(`SearXNG search error`, { error });
    return { web: [], images: [], news: [] };
  }
}
