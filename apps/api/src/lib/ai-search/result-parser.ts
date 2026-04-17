/**
 * Result Parser
 * Parses SearXNG JSON responses to extract rich metadata (suggestions, answers, corrections, infoboxes)
 */

export type ResultCategory = "web" | "news" | "images";

export interface ClassifiedResult {
  url: string;
  title: string;
  description: string;
  category: ResultCategory;
  // SearXNG metadata for internal use (reranking, aggregation)
  searxngScore?: number;
  engines?: string[];
  publishedDate?: string;
  author?: string;
  img_src?: string;
  thumbnail_src?: string;
}

interface SearXNGAnswer {
  text: string;
  source?: string;
  url?: string;
  engine?: string;
}

interface SearXNGInfobox {
  title: string;
  content: Record<string, any>;
  img_src?: string;
  urls?: Array<{ title: string; url: string }>;
  engine?: string;
}

interface UnresponsiveEngine {
  engine: string;
  error_type: string;
  suspended: boolean;
}

export interface SearXNGExtra {
  suggestions?: string[];
  answers?: SearXNGAnswer[];
  corrections?: string[];
  infoboxes?: SearXNGInfobox[];
  engineData?: Record<string, Record<string, string>>;
  unresponsiveEngines?: UnresponsiveEngine[];
}

interface SearXNGResponse {
  results: any[];
  answers: Array<{
    title?: string;
    content?: string;
    url?: string;
    engine?: string;
  }>;
  infoboxes: Array<{
    infobox?: string;
    content?: Record<string, any>;
    img_src?: string;
    urls?: Array<{ title: string; url: string }>;
    engine?: string;
  }>;
  suggestions: string[];
  corrections: string[];
  engine_data: Record<string, Record<string, string>>;
  unresponsive_engines?: Array<{
    engine: string;
    error_type: string;
    suspended: boolean;
  }>;
}

/**
 * Parse SearXNG response and extract rich metadata
 * @param rawResponse - Raw SearXNG JSON response
 * @returns Parsed extra data
 */
export function parseSearXNGResponse(
  rawResponse: SearXNGResponse,
): SearXNGExtra {
  const extra: SearXNGExtra = {};

  // Parse suggestions
  if (
    rawResponse.suggestions &&
    Array.isArray(rawResponse.suggestions) &&
    rawResponse.suggestions.length > 0
  ) {
    extra.suggestions = rawResponse.suggestions;
  }

  // Parse corrections
  if (
    rawResponse.corrections &&
    Array.isArray(rawResponse.corrections) &&
    rawResponse.corrections.length > 0
  ) {
    extra.corrections = rawResponse.corrections;
  }

  // Parse answers (normalize different answer formats)
  if (rawResponse.answers && Array.isArray(rawResponse.answers)) {
    const answers = rawResponse.answers
      .filter(a => a.content || a.title)
      .map(a => ({
        text: a.content || a.title || "",
        source: a.engine,
        url: a.url,
        engine: a.engine,
      }));
    if (answers.length > 0) {
      extra.answers = answers;
    }
  }

  // Parse infoboxes
  if (rawResponse.infoboxes && Array.isArray(rawResponse.infoboxes)) {
    const infoboxes = rawResponse.infoboxes
      .filter(i => i.infobox || i.content)
      .map(i => ({
        title: i.infobox || "Infobox",
        content: i.content || {},
        img_src: i.img_src,
        urls: i.urls,
        engine: i.engine,
      }));
    if (infoboxes.length > 0) {
      extra.infoboxes = infoboxes;
    }
  }

  // Parse engine data
  if (
    rawResponse.engine_data &&
    typeof rawResponse.engine_data === "object" &&
    Object.keys(rawResponse.engine_data).length > 0
  ) {
    extra.engineData = rawResponse.engine_data;
  }

  // Parse unresponsive engines
  if (
    rawResponse.unresponsive_engines &&
    Array.isArray(rawResponse.unresponsive_engines) &&
    rawResponse.unresponsive_engines.length > 0
  ) {
    extra.unresponsiveEngines = rawResponse.unresponsive_engines;
  }

  return extra;
}

/**
 * Classify a single result into web/news/images category
 * @param result - SearXNG result
 * @returns Result category
 */
export function classifyResult(result: any): ResultCategory {
  // Images: category === "images" or has img_src
  if (result.category === "images" || result.img_src || result.thumbnail_src) {
    return "images";
  }

  // News: category === "news" or has publishedDate and from news engine
  if (
    result.category === "news" ||
    (result.publishedDate && isNewsEngine(result.engine))
  ) {
    return "news";
  }

  // Default to web
  return "web";
}

/**
 * Check if engine is a news engine
 * @param engine - Engine name
 * @returns Whether the engine is a news engine
 */
function isNewsEngine(engine?: string): boolean {
  if (!engine) return false;
  const newsEngines = [
    "bing news",
    "google news",
    "news",
    "newsapi",
    "newsboat",
    "newspaper",
  ];
  return newsEngines.some(ne => engine.toLowerCase().includes(ne));
}

/**
 * Classify all results into web/news/images buckets
 * @param results - Array of SearXNG results
 * @returns Classified results separated by category
 */
export function classifyResults(results: any[]): {
  web: ClassifiedResult[];
  news: ClassifiedResult[];
  images: ClassifiedResult[];
} {
  const classified: {
    web: ClassifiedResult[];
    news: ClassifiedResult[];
    images: ClassifiedResult[];
  } = {
    web: [],
    news: [],
    images: [],
  };

  for (const result of results) {
    const category = classifyResult(result);

    const classifiedResult: ClassifiedResult = {
      url: result.url,
      title: result.title,
      description: result.content,
      category,
      // Preserve SearXNG metadata for internal use (Phase 5 reranking)
      searxngScore: result.score,
      engines: result.engines,
      publishedDate: result.publishedDate,
      author: result.author,
      img_src: result.img_src,
      thumbnail_src: result.thumbnail_src,
    };

    classified[category].push(classifiedResult);
  }

  return classified;
}

/**
 * Merge suggestions from preprocessor with SearXNG suggestions
 * @param searxngSuggestions - Suggestions from SearXNG
 * @param preprocessorSuggestions - Suggestions from AI preprocessor
 * @returns Deduplicated merged suggestions
 */
export function mergeSuggestions(
  searxngSuggestions: string[] = [],
  preprocessorSuggestions: string[] = [],
): string[] {
  const allSuggestions = [...searxngSuggestions, ...preprocessorSuggestions];
  const uniqueSuggestions = Array.from(new Set(allSuggestions));
  return uniqueSuggestions;
}

/**
 * Determine if extra data should be included in response
 * @param includeExtra - The includeExtra parameter from request
 * @param aiMode - The AI mode used
 * @returns Whether to include extra data
 */
export function shouldIncludeExtra(
  includeExtra: boolean | string[] = false,
  aiMode: string = "false",
): boolean {
  // Always include extra if explicitly requested (boolean true or non-empty array)
  if (
    includeExtra === true ||
    (Array.isArray(includeExtra) && includeExtra.length > 0)
  ) {
    return true;
  }

  // Include extra for AI modes that benefit from it
  if (aiMode === "full" || aiMode === "rerank") {
    return true;
  }

  return false;
}

/**
 * Format extra data for API response
 * @param extra - The parsed extra data
 * @param includeExtra - Whether to include all extra data
 * @returns Formatted extra data for response
 */
export function formatExtraForResponse(
  extra: SearXNGExtra,
  includeExtra: boolean | string[] = false,
): Partial<SearXNGExtra> {
  if (includeExtra === false) {
    return {};
  }

  if (includeExtra === true) {
    return extra;
  }

  if (Array.isArray(includeExtra)) {
    const formatted: Partial<SearXNGExtra> = {};
    if (includeExtra.includes("suggestions")) {
      formatted.suggestions = extra.suggestions;
    }
    if (includeExtra.includes("answers")) {
      formatted.answers = extra.answers;
    }
    if (includeExtra.includes("corrections")) {
      formatted.corrections = extra.corrections;
    }
    if (
      includeExtra.includes("knowledgeCards") ||
      includeExtra.includes("infoboxes")
    ) {
      formatted.infoboxes = extra.infoboxes;
    }
    // aiMetadata is handled separately in executeSearch.ts
    return formatted;
  }

  return {};
}
