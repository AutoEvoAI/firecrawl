/**
 * AI Reranker Tests
 */

import { rerankResults, shouldRerank } from "./reranker";
import { WebSearchResult } from "../entities";

// Mock the config and logger
jest.mock("../../config", () => ({
  config: {
    AI_SEARCH_RERANK_MODEL: "jina-reranker-v3",
    AI_SEARCH_RERANK_PROVIDER: "jina",
    AI_SEARCH_RERANK_ENDPOINT: "https://api.jina.ai/v1/rerank",
    AI_SEARCH_RERANK_API_KEY: "test-api-key",
    AI_SEARCH_RERANK_TIMEOUT: 3000,
  },
}));

jest.mock("../logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../generic-ai", () => ({
  getSearchRerankModel: jest.fn(() => ({
    provider: "test",
  })),
}));

// Mock fetch globally
global.fetch = jest.fn();

describe("reranker", () => {
  const mockResults: WebSearchResult[] = [
    {
      url: "http://example1.com",
      title: "Test Result 1",
      description: "Description 1",
    },
    {
      url: "http://example2.com",
      title: "Test Result 2",
      description: "Description 2",
    },
    {
      url: "http://example3.com",
      title: "Test Result 3",
      description: "Description 3",
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("rerankResults with Jina API", () => {
    it("should call Jina rerank API and parse response", async () => {
      const mockJinaResponse = {
        model: "jina-reranker-v3",
        object: "list",
        usage: { total_tokens: 1083 },
        results: [
          { index: 2, relevance_score: 0.95 },
          { index: 0, relevance_score: 0.85 },
          { index: 1, relevance_score: 0.75 },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockJinaResponse,
      });

      const result = await rerankResults("test query", mockResults, 3);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.jina.ai/v1/rerank",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-api-key",
          },
          body: expect.stringContaining("test query"),
        })
      );

      expect(result).toHaveLength(3);
      expect(result[0].url).toBe("http://example3.com");
      expect(result[0].relevanceScore).toBe(0.95);
      expect(result[1].url).toBe("http://example1.com");
      expect(result[1].relevanceScore).toBe(0.85);
    });

    it("should handle empty array", async () => {
      const result = await rerankResults("test query", [], 10);
      expect(result).toEqual([]);
    });

    it("should limit results to topK", async () => {
      const mockJinaResponse = {
        model: "jina-reranker-v3",
        object: "list",
        usage: { total_tokens: 1083 },
        results: [
          { index: 2, relevance_score: 0.95 },
          { index: 0, relevance_score: 0.85 },
          { index: 1, relevance_score: 0.75 },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockJinaResponse,
      });

      const result = await rerankResults("test query", mockResults, 2);
      expect(result.length).toBe(2);
    });

    it("should return original results on API failure", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const result = await rerankResults("test query", mockResults, 10);
      expect(result).toBeDefined();
      expect(result).toEqual(mockResults.slice(0, 10));
    });

    it("should return original results on fetch error", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));

      const result = await rerankResults("test query", mockResults, 10);
      expect(result).toBeDefined();
      expect(result).toEqual(mockResults.slice(0, 10));
    });
  });

  describe("shouldRerank", () => {
    it("should return true for rerank mode", () => {
      expect(shouldRerank("rerank")).toBe(true);
    });

    it("should return true for full mode", () => {
      expect(shouldRerank("full")).toBe(true);
    });

    it("should return true for auto mode", () => {
      expect(shouldRerank("auto")).toBe(true);
    });

    it("should return false for expand mode", () => {
      expect(shouldRerank("expand")).toBe(false);
    });

    it("should return false for false mode", () => {
      expect(shouldRerank("false")).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(shouldRerank(undefined)).toBe(false);
    });
  });
});
