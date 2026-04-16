import { createOpenAI } from "@ai-sdk/openai";
import { config } from "../config";
import { createOllama } from "ollama-ai-provider";
import { anthropic } from "@ai-sdk/anthropic";
import { groq } from "@ai-sdk/groq";
import { google } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { fireworks } from "@ai-sdk/fireworks";
import { deepinfra } from "@ai-sdk/deepinfra";
import { createVertex } from "@ai-sdk/google-vertex";

type Provider =
  | "openai"
  | "ollama"
  | "anthropic"
  | "groq"
  | "google"
  | "openrouter"
  | "fireworks"
  | "deepinfra"
  | "vertex";
const defaultProvider: Provider = config.OLLAMA_BASE_URL ? "ollama" : "openai";

const providerList: Record<Provider, any> = {
  openai: createOpenAI({
    apiKey: config.OPENAI_API_KEY,
    baseURL: config.OPENAI_BASE_URL,
  }), //OPENAI_API_KEY
  ollama: createOllama({
    baseURL: config.OLLAMA_BASE_URL,
  }),
  anthropic, //ANTHROPIC_API_KEY
  groq, //GROQ_API_KEY
  google, //GOOGLE_GENERATIVE_AI_API_KEY
  openrouter: createOpenRouter({
    apiKey: config.OPENROUTER_API_KEY,
  }),
  fireworks, //FIREWORKS_API_KEY
  deepinfra, //DEEPINFRA_API_KEY
  vertex: createVertex({
    project: "firecrawl",
    //https://github.com/vercel/ai/issues/6644 bug
    baseURL:
      "https://aiplatform.googleapis.com/v1/projects/firecrawl/locations/global/publishers/google",
    location: "global",
    googleAuthOptions: config.VERTEX_CREDENTIALS
      ? {
          credentials: JSON.parse(atob(config.VERTEX_CREDENTIALS)),
        }
      : {
          keyFile: "./gke-key.json",
        },
  }),
};

export function getModel(name: string, provider: Provider = defaultProvider) {
  if (name === "gemini-2.5-pro") {
    name = "gemini-2.5-pro";
  }
  const modelName = config.MODEL_NAME || name;
  // o3-mini returns empty text via the Responses API — force Chat Completions
  if (provider === "openai" && modelName.startsWith("o3-mini")) {
    return providerList.openai.chat(modelName);
  }
  return providerList[provider](modelName);
}

export function getEmbeddingModel(
  name: string,
  provider: Provider = defaultProvider,
) {
  return config.MODEL_EMBEDDING_NAME
    ? providerList[provider].embedding(config.MODEL_EMBEDDING_NAME)
    : providerList[provider].embedding(name);
}

// Module-level cache for AI search model instances
let searchExpandModelInstance: any = null;
let searchRerankModelInstance: any = null;

/**
 * Get the AI Search Expand Model (Phase 1: query expansion + intent classification)
 * This is isolated from the global MODEL_NAME configuration
 */
export function getSearchExpandModel() {
  if (searchExpandModelInstance) {
    return searchExpandModelInstance;
  }

  const modelName = config.AI_SEARCH_EXPAND_MODEL || "gpt-4o-mini";
  const providerName = config.AI_SEARCH_EXPAND_PROVIDER as Provider || defaultProvider;
  const endpoint = config.AI_SEARCH_EXPAND_ENDPOINT;
  const apiKey = config.AI_SEARCH_EXPAND_API_KEY;

  let provider: any;

  if (endpoint) {
    // Create independent provider instance with custom endpoint
    if (providerName === "openai") {
      provider = createOpenAI({
        baseURL: endpoint,
        apiKey: apiKey || config.OPENAI_API_KEY,
      });
    } else if (providerName === "ollama") {
      provider = createOllama({
        baseURL: endpoint,
      });
    } else {
      // Fallback to global provider for other types
      provider = providerList[providerName];
    }
  } else {
    // Reuse global provider instance
    provider = providerList[providerName];
  }

  // Get the model (directly use modelName, not affected by MODEL_NAME override)
  searchExpandModelInstance = provider(modelName);
  return searchExpandModelInstance;
}

/**
 * Get the AI Search Rerank Model (Phase 5: search result reranking)
 * This is isolated from the global MODEL_NAME configuration
 */
export function getSearchRerankModel() {
  if (searchRerankModelInstance) {
    return searchRerankModelInstance;
  }

  const modelName = config.AI_SEARCH_RERANK_MODEL || "bge-reranker-v2-m3";
  const providerName = config.AI_SEARCH_RERANK_PROVIDER as Provider || "ollama";
  const endpoint = config.AI_SEARCH_RERANK_ENDPOINT;
  const apiKey = config.AI_SEARCH_RERANK_API_KEY;

  let provider: any;

  if (endpoint) {
    // Create independent provider instance with custom endpoint
    if (providerName === "openai") {
      provider = createOpenAI({
        baseURL: endpoint,
        apiKey: apiKey || config.OPENAI_API_KEY,
      });
    } else if (providerName === "ollama") {
      provider = createOllama({
        baseURL: endpoint,
      });
    } else {
      // Fallback to global provider for other types
      provider = providerList[providerName];
    }
  } else {
    // Reuse global provider instance
    provider = providerList[providerName];
  }

  // Get the model (directly use modelName, not affected by MODEL_NAME override)
  searchRerankModelInstance = provider(modelName);
  return searchRerankModelInstance;
}
