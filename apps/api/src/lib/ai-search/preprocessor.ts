/**
 * AI Preprocessor
 * Performs query expansion and intent classification using LLM
 */

import { generateObject } from "ai";
import { z } from "zod";
import { config } from "../../config";
import { logger } from "../logger";
import { redisEvictConnection } from "../../services/redis";
import crypto from "crypto";

/**
 * Helper function to add timeout to promises
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      logger.warn(`${operation} timed out after ${timeoutMs}ms`);
      reject(new Error(`${operation} timeout`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Generate cache key for LLM preprocessing results
 */
function getPreprocessCacheKey(
  operation: "intent" | "expansion",
  query: string,
  lang: string = "en"
): string {
  const keyData = { operation, query: query.toLowerCase().trim(), lang };
  const keyString = JSON.stringify(keyData, Object.keys(keyData).sort());
  const hash = crypto.createHash("sha256").update(keyString).digest("hex");
  return `ai-search:preprocess:${operation}:${hash}`;
}

/**
 * Get cached LLM result
 */
async function getCachedResult<T>(
  cacheKey: string
): Promise<T | null> {
  try {
    const value = await redisEvictConnection.get(cacheKey);
    if (value) {
      logger.info(`LLM cache hit for ${cacheKey}`);
      return JSON.parse(value) as T;
    }
    return null;
  } catch (error) {
    logger.error(`Failed to get LLM cache for ${cacheKey}: ${error}`);
    return null;
  }
}

/**
 * Cache LLM result with TTL
 */
async function setCachedResult(
  cacheKey: string,
  result: any,
  ttl: number = 3600
): Promise<void> {
  try {
    await redisEvictConnection.setex(cacheKey, ttl, JSON.stringify(result));
    logger.info(`LLM result cached for ${cacheKey} (TTL: ${ttl}s)`);
  } catch (error) {
    logger.error(`Failed to cache LLM result for ${cacheKey}: ${error}`);
  }
}

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
  timeRange: z.enum(["day", "month", "year"]).nullable().optional(),
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
  timeRange?: string | null;
  reasoning?: string;
}> {
  // Check cache first
  const cacheKey = getPreprocessCacheKey("intent", query, lang);
  const cachedResult = await getCachedResult<z.infer<typeof intentSchema>>(
    cacheKey
  );
  if (cachedResult) {
    return cachedResult;
  }

  try {
    // Build AI-specific configuration
    const aiConfig: {
      model: string;
      schema: z.ZodSchema;
      prompt: string;
      temperature: number;
      maxRetries: number;
      apiKey?: string;
      baseURL?: string;
    } = {
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

    const result = await withTimeout(
      generateObject(aiConfig),
      config.AI_SEARCH_LLM_TIMEOUT,
      "Intent classification"
    );

    if (!result.object) {
      throw new Error("Failed to generate intent classification result");
    }

    const classificationResult = result.object as any;
    
    // Cache the result
    await setCachedResult(cacheKey, classificationResult, 3600); // 1 hour TTL

    return classificationResult;
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
  // Check cache first
  const cacheKey = getPreprocessCacheKey("expansion", query, lang);
  const cachedResult = await getCachedResult<string[]>(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  try {
    // Build AI-specific configuration
    const aiConfig: {
      model: string;
      schema: z.ZodSchema;
      prompt: string;
      temperature: number;
      maxRetries: number;
      apiKey?: string;
      baseURL?: string;
    } = {
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

    const result = await withTimeout(
      generateObject(aiConfig),
      config.AI_SEARCH_LLM_TIMEOUT,
      "Query expansion"
    );

    if (!result.object) {
      throw new Error("Failed to generate query expansion result");
    }

    const queries = (result.object as any).queries;
    if (!queries) {
      throw new Error("Failed to generate query expansion result");
    }

    // Cache the result
    await setCachedResult(cacheKey, queries, 3600); // 1 hour TTL

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
  timeRange?: string | null;
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
