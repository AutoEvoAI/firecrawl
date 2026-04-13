/**
 * AI Preprocessor
 * Performs query expansion and intent classification using LLM
 */

import { generateObject } from "ai";
import { z } from "zod";
import { config } from "../../config";
import { logger } from "../logger";

/**
 * Intent classification schema
 */
const intentSchema = z.object({
  intent: z.enum([
    "informational",
    "navigational",
    "transactional",
    "research",
  ]),
  confidence: z.number().min(0).max(1),
  firecrawlCategories: z
    .array(z.enum(["github", "research", "pdf"]))
    .optional(),
  searxngCategories: z
    .array(
      z.enum([
        "general",
        "images",
        "news",
        "science",
        "it",
        "files",
        "videos",
        "social media",
      ]),
    )
    .optional(),
  searxngEngines: z.array(z.string()).optional(),
  timeRange: z.enum(["day", "month", "year", "null"]).optional(),
  reasoning: z.string().optional(),
});

/**
 * Query expansion schema
 */
const expansionSchema = z.object({
  queries: z.array(z.string()).max(3).min(2),
});

/**
 * Classify user intent using LLM
 * @param query - The search query
 * @param lang - Language for the query
 * @returns Intent classification result with full category mapping
 */
export async function classifyIntent(
  query: string,
  lang: string = "en",
): Promise<{
  intent: string;
  confidence: number;
  firecrawlCategories?: string[];
  searxngCategories?: string[];
  searxngEngines?: string[];
  timeRange?: string;
  reasoning?: string;
}> {
  try {
    // Build AI-specific configuration
    const aiConfig: any = {
      model: config.AI_SEARCH_LLM_MODEL || "gpt-4o-mini",
      schema: intentSchema,
      prompt: `You are a search intent classifier. Given a user query, classify the search intent and suggest optimal search parameters. Language: ${lang}.

Classify this search query: "${query}"`,
      temperature: 0.1,
      maxRetries: 1,
    };

    // Add AI-specific API key if provided
    if (config.AI_SEARCH_LLM_API_KEY) {
      aiConfig.apiKey = config.AI_SEARCH_LLM_API_KEY;
    }

    // Add AI-specific base URL if provided
    if (config.AI_SEARCH_LLM_BASE_URL) {
      aiConfig.baseURL = config.AI_SEARCH_LLM_BASE_URL;
    }

    const result = await generateObject(aiConfig);

    if (!result.object) {
      throw new Error("Failed to generate intent classification result");
    }

    return result.object as any;
  } catch (error) {
    logger.error("Intent classification failed", { error, query });
    // Fallback to informational intent
    return {
      intent: "informational",
      confidence: 0.5,
      firecrawlCategories: [],
      searxngCategories: ["general"],
    };
  }
}

/**
 * Expand query using LLM
 * @param query - The search query
 * @param lang - Language for the query
 * @returns Query expansion result with 2-3 alternative queries
 */
export async function expandQuery(
  query: string,
  lang: string = "en",
): Promise<string[]> {
  try {
    // Build AI-specific configuration
    const aiConfig: any = {
      model: config.AI_SEARCH_LLM_MODEL || "gpt-4o-mini",
      schema: expansionSchema,
      prompt: `You are a search query expansion expert. Given a user query, generate 2-3 alternative search queries that capture different aspects or phrasings of the same intent. Keep queries concise (under 10 words). Language: ${lang}.

Expand this search query: "${query}"`,
      temperature: 0.3,
      maxRetries: 1,
    };

    // Add AI-specific API key if provided
    if (config.AI_SEARCH_LLM_API_KEY) {
      aiConfig.apiKey = config.AI_SEARCH_LLM_API_KEY;
    }

    // Add AI-specific base URL if provided
    if (config.AI_SEARCH_LLM_BASE_URL) {
      aiConfig.baseURL = config.AI_SEARCH_LLM_BASE_URL;
    }

    const result = await generateObject(aiConfig);

    if (!result.object) {
      throw new Error("Failed to generate query expansion result");
    }

    const queries = (result.object as any).queries;
    if (!queries) {
      throw new Error("Failed to generate query expansion result");
    }

    return queries;
  } catch (error) {
    logger.error("Query expansion failed", { error, query });
    // Fallback to original query only
    return [query];
  }
}

/**
 * Preprocess query (classify intent and expand in parallel)
 * @param query - The search query
 * @param lang - Language for the query
 * @returns Preprocessing result with intent and expanded queries
 */
export async function preprocessQuery(
  query: string,
  lang: string = "en",
): Promise<{
  intent: string;
  confidence: number;
  firecrawlCategories?: string[];
  searxngCategories?: string[];
  searxngEngines?: string[];
  timeRange?: string;
  expandedQueries: string[];
}> {
  // Parallel execution of intent classification and query expansion
  const [intentResult, expandedQueries] = await Promise.all([
    classifyIntent(query, lang),
    expandQuery(query, lang),
  ]);

  return {
    intent: intentResult.intent,
    confidence: intentResult.confidence,
    firecrawlCategories: intentResult.firecrawlCategories,
    searxngCategories: intentResult.searxngCategories,
    searxngEngines: intentResult.searxngEngines,
    timeRange: intentResult.timeRange,
    expandedQueries,
  };
}

/**
 * Determine if query expansion should be applied
 * @param aiMode - The AI mode
 * @returns Whether to apply query expansion
 */
export function shouldExpandQuery(aiMode: string = "false"): boolean {
  return aiMode === "expand" || aiMode === "full" || aiMode === "auto";
}

/**
 * Determine if intent classification should be applied
 * @param aiMode - The AI mode
 * @returns Whether to apply intent classification
 */
export function shouldClassifyIntent(aiMode: string = "false"): boolean {
  return aiMode === "full" || aiMode === "auto";
}
