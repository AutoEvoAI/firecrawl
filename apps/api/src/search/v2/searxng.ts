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
  includeExtra?: boolean;
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

    // Map safesearch
    if (options.safesearch) {
      params.safesearch = options.safesearch;
    } else if (config.AI_SEARCH_SAFESEARCH) {
      params.safesearch = config.AI_SEARCH_SAFESEARCH;
    }

    // Note: gl (country) and location are not directly supported by SearXNG
    // They can be handled through language parameter or engine-specific settings

    try {
      const response = await axiosInstance.get(finalUrl, {
        headers: {
          "Content-Type": "application/json",
        },
        params: params,
        timeout: 1200, // 1200ms timeout
      });

      const data = response.data;

      if (data && Array.isArray(data.results)) {
        const webResults: WebSearchResult[] = data.results.map(
          (a: SearXNGResult) => ({
            url: a.url,
            title: a.title,
            description: a.content,
            // SearXNG metadata for internal use (reranking, aggregation)
            searxngScore: a.score,
            engines: a.engines,
            category: a.category,
            publishedDate: a.publishedDate,
            author: a.author,
          }),
        );

        return {
          results: webResults,
          fullResponse: data as SearXNGResponse,
        };
      }

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
    let fullResponse: SearXNGResponse | null = null;

    for (let pageOffset = 0; pageOffset < pagesToFetch; pageOffset += 1) {
      const { results: pageResults, fullResponse: pageResponse } =
        await fetchPage(startPage + pageOffset);

      if (pageResults.length === 0) {
        break;
      }

      webResults = webResults.concat(pageResults);

      // Keep the first page's full response for extra data
      if (pageResponse && !fullResponse) {
        fullResponse = pageResponse;
      }

      if (webResults.length >= requestedResults) {
        break;
      }
    }

    const response: SearchV2Response = {};

    if (webResults.length > 0) {
      response.web = webResults.slice(0, requestedResults);
    }

    // Parse and include extra data if requested
    if (fullResponse) {
      const aiMode = options.aiMode || "false";
      const includeExtra = options.includeExtra || false;

      if (shouldIncludeExtra(includeExtra, aiMode)) {
        const extra = parseSearXNGResponse(fullResponse);
        response.extra = formatExtraForResponse(extra, includeExtra);
      }
    }

    return response;
  } catch (error) {
    logger.error(`SearXNG search error`, { error });
    return {};
  }
}
