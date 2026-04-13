import {
  embeddingRerank,
  llmRerank,
  twoLevelRerank,
  shouldRerank,
  shouldUseLLMRerank,
} from "./reranker";
import { WebSearchResult } from "../entities";

describe("reranker", () => {
  const mockResults: WebSearchResult[] = [
    {
      url: "http://example1.com",
      title: "Test 1",
      description: "Desc 1",
      searxngScore: 0.9,
    },
    {
      url: "http://example2.com",
      title: "Test 2",
      description: "Desc 2",
      searxngScore: 0.7,
    },
    {
      url: "http://example3.com",
      title: "Test 3",
      description: "Desc 3",
      searxngScore: 0.8,
    },
  ];

  describe("embeddingRerank", () => {
    it("should rank results by searxngScore", async () => {
      const ranked = await embeddingRerank("test query", [...mockResults], 10);
      expect(ranked[0].url).toBe("http://example1.com");
      expect(ranked[1].url).toBe("http://example3.com");
      expect(ranked[2].url).toBe("http://example2.com");
    });

    it("should limit results to topK", async () => {
      const ranked = await embeddingRerank("test query", [...mockResults], 2);
      expect(ranked.length).toBe(2);
    });

    it("should handle results without scores", async () => {
      const resultsWithoutScores: WebSearchResult[] = [
        { url: "http://example1.com", title: "Test 1", description: "Desc 1" },
        { url: "http://example2.com", title: "Test 2", description: "Desc 2" },
      ];
      const ranked = await embeddingRerank(
        "test query",
        resultsWithoutScores,
        10,
      );
      expect(ranked.length).toBe(2);
    });

    it("should remove internal score field", async () => {
      const ranked = await embeddingRerank("test query", [...mockResults], 10);
      expect(ranked[0]).not.toHaveProperty("_embeddingScore");
    });

    it("should handle empty array", async () => {
      const ranked = await embeddingRerank("test query", [], 10);
      expect(ranked).toEqual([]);
    });
  });

  describe("llmRerank", () => {
    it("should return topK results", async () => {
      const ranked = await llmRerank("test query", [...mockResults], 2);
      expect(ranked.length).toBe(2);
    });

    it("should return all results if fewer than topK", async () => {
      const ranked = await llmRerank("test query", [...mockResults], 10);
      expect(ranked.length).toBe(3);
    });

    it("should handle empty array", async () => {
      const ranked = await llmRerank("test query", [], 10);
      expect(ranked).toEqual([]);
    });
  });

  describe("twoLevelRerank", () => {
    it("should perform two-level reranking", async () => {
      const results = Array.from({ length: 30 }, (_, i) => ({
        url: `http://example${i}.com`,
        title: `Test ${i}`,
        description: `Desc ${i}`,
        searxngScore: Math.random(),
      }));

      const ranked = await twoLevelRerank("test query", results, {
        embeddingTopK: 20,
        llmTopK: 10,
      });

      expect(ranked.length).toBe(10);
    });

    it("should skip LLM reranking when skipLLM is true", async () => {
      const results = Array.from({ length: 30 }, (_, i) => ({
        url: `http://example${i}.com`,
        title: `Test ${i}`,
        description: `Desc ${i}`,
        searxngScore: Math.random(),
      }));

      const ranked = await twoLevelRerank("test query", results, {
        embeddingTopK: 20,
        llmTopK: 10,
        skipLLM: true,
      });

      expect(ranked.length).toBe(10);
    });

    it("should skip LLM reranking when results <= llmTopK", async () => {
      const results = Array.from({ length: 5 }, (_, i) => ({
        url: `http://example${i}.com`,
        title: `Test ${i}`,
        description: `Desc ${i}`,
        searxngScore: Math.random(),
      }));

      const ranked = await twoLevelRerank("test query", results, {
        embeddingTopK: 20,
        llmTopK: 10,
      });

      expect(ranked.length).toBe(5);
    });

    it("should use default options", async () => {
      const results = Array.from({ length: 30 }, (_, i) => ({
        url: `http://example${i}.com`,
        title: `Test ${i}`,
        description: `Desc ${i}`,
        searxngScore: Math.random(),
      }));

      const ranked = await twoLevelRerank("test query", results);
      expect(ranked.length).toBe(10);
    });

    it("should handle empty array", async () => {
      const ranked = await twoLevelRerank("test query", []);
      expect(ranked).toEqual([]);
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
      expect(shouldRerank()).toBe(false);
    });
  });

  describe("shouldUseLLMRerank", () => {
    it("should return true for full mode", () => {
      expect(shouldUseLLMRerank("full")).toBe(true);
    });

    it("should return true for auto mode", () => {
      expect(shouldUseLLMRerank("auto")).toBe(true);
    });

    it("should return false for rerank mode", () => {
      expect(shouldUseLLMRerank("rerank")).toBe(false);
    });

    it("should return false for expand mode", () => {
      expect(shouldUseLLMRerank("expand")).toBe(false);
    });

    it("should return false for false mode", () => {
      expect(shouldUseLLMRerank("false")).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(shouldUseLLMRerank()).toBe(false);
    });
  });
});
