/**
 * Result Parser
 * Parses SearXNG JSON responses to extract rich metadata (suggestions, answers, corrections, infoboxes)
 */

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

export interface SearXNGExtra {
  suggestions?: string[];
  answers?: SearXNGAnswer[];
  corrections?: string[];
  infoboxes?: SearXNGInfobox[];
  engineData?: Record<string, Record<string, string>>;
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
  if (rawResponse.suggestions && Array.isArray(rawResponse.suggestions)) {
    extra.suggestions = rawResponse.suggestions;
  }

  // Parse corrections
  if (rawResponse.corrections && Array.isArray(rawResponse.corrections)) {
    extra.corrections = rawResponse.corrections;
  }

  // Parse answers (normalize different answer formats)
  if (rawResponse.answers && Array.isArray(rawResponse.answers)) {
    extra.answers = rawResponse.answers
      .filter(a => a.content || a.title)
      .map(a => ({
        text: a.content || a.title || "",
        source: a.engine,
        url: a.url,
        engine: a.engine,
      }));
  }

  // Parse infoboxes
  if (rawResponse.infoboxes && Array.isArray(rawResponse.infoboxes)) {
    extra.infoboxes = rawResponse.infoboxes
      .filter(i => i.infobox || i.content)
      .map(i => ({
        title: i.infobox || "Infobox",
        content: i.content || {},
        img_src: i.img_src,
        urls: i.urls,
        engine: i.engine,
      }));
  }

  // Parse engine data
  if (rawResponse.engine_data && typeof rawResponse.engine_data === "object") {
    extra.engineData = rawResponse.engine_data;
  }

  return extra;
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
  includeExtra: boolean = false,
  aiMode: string = "false",
): boolean {
  // Always include extra if explicitly requested
  if (includeExtra) {
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
  includeExtra: boolean = false,
): Partial<SearXNGExtra> {
  if (!includeExtra) {
    return {};
  }

  return extra;
}
