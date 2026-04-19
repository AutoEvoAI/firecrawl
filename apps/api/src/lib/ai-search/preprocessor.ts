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
import { getSearchExpandModel } from "../generic-ai";

/**
 * Helper function to add timeout to promises
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
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
  lang: string = "en",
): string {
  const keyData = { operation, query: query.toLowerCase().trim(), lang };
  const keyString = JSON.stringify(keyData, Object.keys(keyData).sort());
  const hash = crypto.createHash("sha256").update(keyString).digest("hex");
  return `ai-search:preprocess:${operation}:${hash}`;
}

/**
 * Get cached LLM result
 */
async function getCachedResult<T>(cacheKey: string): Promise<T | null> {
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
  ttl: number = 3600,
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
  const startTime = Date.now();
  const perfLog = (step: string, duration: number) => {
    logger.info(`PERF [classifyIntent:${step}]: ${duration}ms`);
  };

  // Check cache first
  const cacheCheckStart = Date.now();
  const cacheKey = getPreprocessCacheKey("intent", query, lang);
  const cachedResult =
    await getCachedResult<z.infer<typeof intentSchema>>(cacheKey);
  perfLog("cache_check", Date.now() - cacheCheckStart);
  if (cachedResult) {
    perfLog("total", Date.now() - startTime);
    return cachedResult;
  }

  try {
    // Build AI-specific configuration
    const aiConfig: any = {
      model: getSearchExpandModel(),
      schema: intentSchema,
      prompt: `You are a search intent classifier. Given a user query, classify the search intent and suggest optimal search parameters. Language: ${lang}.

Classify this search query: "${query}"`,
      temperature: 0.1,
      maxRetries: 1,
    };

    const llmStart = Date.now();
    const result = await withTimeout(
      generateObject(aiConfig),
      config.AI_SEARCH_LLM_TIMEOUT,
      "Intent classification",
    );
    perfLog("llm_call", Date.now() - llmStart);

    if (!result.object) {
      throw new Error("Failed to generate intent classification result");
    }

    const classificationResult = result.object as any;

    // Cache the result
    const cacheStoreStart = Date.now();
    await setCachedResult(cacheKey, classificationResult, 3600); // 1 hour TTL
    perfLog("cache_store", Date.now() - cacheStoreStart);
    perfLog("total", Date.now() - startTime);

    return classificationResult;
  } catch (error) {
    logger.error("Intent classification failed", { error, query });
    perfLog("total", Date.now() - startTime);
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
  const startTime = Date.now();
  const perfLog = (step: string, duration: number) => {
    logger.info(`PERF [expandQuery:${step}]: ${duration}ms`);
  };

  // Check cache first
  const cacheCheckStart = Date.now();
  const cacheKey = getPreprocessCacheKey("expansion", query, lang);
  const cachedResult = await getCachedResult<string[]>(cacheKey);
  perfLog("cache_check", Date.now() - cacheCheckStart);
  if (cachedResult) {
    perfLog("total", Date.now() - startTime);
    return cachedResult;
  }

  try {
    // Build AI-specific configuration
    const aiConfig: any = {
      model: getSearchExpandModel(),
      schema: expansionSchema,
      prompt: `You are a search query expansion expert. Given a user query, generate 2-3 alternative search queries that capture different aspects or phrasings of the same intent. Keep queries concise (under 10 words). Language: ${lang}.

Expand this search query: "${query}"`,
      temperature: 0.3,
      maxRetries: 1,
    };

    const llmStart = Date.now();
    const result = await withTimeout(
      generateObject(aiConfig),
      config.AI_SEARCH_LLM_TIMEOUT,
      "Query expansion",
    );
    perfLog("llm_call", Date.now() - llmStart);

    if (!result.object) {
      throw new Error("Failed to generate query expansion result");
    }

    const queries = (result.object as any).queries;
    if (!queries) {
      throw new Error("Failed to generate query expansion result");
    }

    // Cache the result
    const cacheStoreStart = Date.now();
    await setCachedResult(cacheKey, queries, 3600); // 1 hour TTL
    perfLog("cache_store", Date.now() - cacheStoreStart);
    perfLog("total", Date.now() - startTime);

    return queries;
  } catch (error) {
    logger.error("Query expansion failed", { error, query });
    perfLog("total", Date.now() - startTime);
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
  const startTime = Date.now();
  const perfLog = (step: string, duration: number) => {
    logger.info(`PERF [preprocessQuery:${step}]: ${duration}ms`);
  };

  // Parallel execution of intent classification and query expansion
  const [intentResult, expandedQueries] = await Promise.all([
    classifyIntent(query, lang),
    expandQuery(query, lang),
  ]);
  perfLog("total", Date.now() - startTime);

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
  return aiMode === "expand" || aiMode === "full" || aiMode === "auto";
}
