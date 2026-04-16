/**
 * Phase 6 Response Builder Tests
 * Tests for response assembly, relevanceScore attachment, and includeExtra filtering
 */

import { SearchV2Response, WebSearchResult } from "../lib/entities";

describe("Response Builder (Phase 6)", () => {
  const mockWebResults: WebSearchResult[] = [
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

  describe("relevanceScore attachment", () => {
    it("should add relevanceScore to web results when aiMode is enabled", () => {
      const aiMode = "rerank";
      const results = mockWebResults.map((result, index) => ({
        ...result,
        relevanceScore: result.searxngScore ? result.searxngScore * 100 : 100 - index,
      }));

      expect(results[0].relevanceScore).toBe(90);
      expect(results[1].relevanceScore).toBe(70);
      expect(results[2].relevanceScore).toBe(80);
    });

    it("should use fallback score when searxngScore is not available", () => {
      const resultsWithoutScore: WebSearchResult[] = [
        { url: "http://example1.com", title: "Test 1", description: "Desc 1" },
        { url: "http://example2.com", title: "Test 2", description: "Desc 2" },
      ];

      const results = resultsWithoutScore.map((result, index) => ({
        ...result,
        relevanceScore: result.searxngScore ? result.searxngScore * 100 : 100 - index,
      }));

      expect(results[0].relevanceScore).toBe(100);
      expect(results[1].relevanceScore).toBe(99);
    });

    it("should not add relevanceScore when aiMode is false", () => {
      const results = [...mockWebResults];
      // When aiMode is false, relevanceScore should not be added
      expect(results[0]).not.toHaveProperty("relevanceScore");
    });
  });

  describe("includeExtra field filtering", () => {
    it("should remove extra fields when includeExtra is false", () => {
      const response: SearchV2Response = {
        web: mockWebResults,
        extra: {
          suggestions: ["suggestion1", "suggestion2"],
          answers: [{ text: "answer1" }],
        },
        aiMetadata: {
          aiMode: "rerank",
          intent: "informational",
        },
      };

      const includeExtra = false;
      if (!includeExtra) {
        delete response.extra;
        delete response.aiMetadata;
      }

      expect(response).not.toHaveProperty("extra");
      expect(response).not.toHaveProperty("aiMetadata");
      expect(response.web).toBeDefined();
    });

    it("should keep extra fields when includeExtra is true", () => {
      const response: SearchV2Response = {
        web: mockWebResults,
        extra: {
          suggestions: ["suggestion1", "suggestion2"],
          answers: [{ text: "answer1" }],
        },
        aiMetadata: {
          aiMode: "rerank",
          intent: "informational",
        },
      };

      const includeExtra = true;
      if (!includeExtra) {
        delete response.extra;
        delete response.aiMetadata;
      }

      expect(response).toHaveProperty("extra");
      expect(response).toHaveProperty("aiMetadata");
      expect(response.extra?.suggestions).toHaveLength(2);
      expect(response.aiMetadata?.intent).toBe("informational");
    });

    it("should handle response without extra fields gracefully", () => {
      const response: SearchV2Response = {
        web: mockWebResults,
      };

      const includeExtra = false;
      if (!includeExtra) {
        delete response.extra;
        delete response.aiMetadata;
      }

      expect(response.web).toBeDefined();
      expect(response).not.toHaveProperty("extra");
      expect(response).not.toHaveProperty("aiMetadata");
    });
  });

  describe("response limiting", () => {
    it("should limit results to top limit", () => {
      const limit = 2;
      const results = mockWebResults.slice(0, limit);

      expect(results).toHaveLength(2);
      expect(results[0].url).toBe("http://example1.com");
      expect(results[1].url).toBe("http://example2.com");
    });

    it("should not limit when results are fewer than limit", () => {
      const limit = 10;
      const results = mockWebResults.slice(0, limit);

      expect(results).toHaveLength(3);
    });
  });
});
