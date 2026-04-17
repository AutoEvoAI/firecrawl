import { SearchV2Response, SearchResultType } from "../../lib/entities";
import { config } from "../../config";
import { fire_engine_search_v2 } from "./fireEngine-v2";
import { searxng_search } from "./searxng";
import { ddgSearch } from "./ddgsearch";
import { Logger } from "winston";

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
  includeExtra?: boolean | string[];
  aiMetadata?: {
    searxngCategories?: string[];
    searxngEngines?: string[];
    timeRange?: string;
  };
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
  } = options;

  try {
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
