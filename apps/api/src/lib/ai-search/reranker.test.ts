import {
  rerankResults,
  shouldRerank,
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

  describe("rerankResults", () => {
    it("should handle empty array", async () => {
      const ranked = await rerankResults("test query", [], 10);
      expect(ranked).toEqual([]);
    });

    it("should limit results to topK", async () => {
      // Mock the model call to return a simple reordering
      const ranked = await rerankResults("test query", [...mockResults], 2);
      // Since we don't have a real model, it will return original results
      expect(ranked.length).toBe(2);
    });

    it("should return original results on model failure", async () => {
      // Without a real model configured, it should fall back to original
      const ranked = await rerankResults("test query", [...mockResults], 10);
      expect(ranked.length).toBe(3);
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
});
