import {
  deduplicateResults,
  aggregateByCategory,
  coarseRank,
  prepareForReranker,
  aggregateResults,
} from "./aggregator";
import { WebSearchResult } from "../entities";

describe("aggregator", () => {
  describe("deduplicateResults", () => {
    it("should remove duplicate URLs", () => {
      const results: WebSearchResult[] = [
        { url: "http://example.com", title: "Test 1", description: "Desc 1" },
        { url: "http://example.com", title: "Test 2", description: "Desc 2" },
        { url: "http://example.org", title: "Test 3", description: "Desc 3" },
      ];
      const { uniqueResults } = deduplicateResults(results);
      expect(uniqueResults.length).toBe(2);
    });

    it("should keep result with higher score", () => {
      const results: WebSearchResult[] = [
        {
          url: "http://example.com",
          title: "Test 1",
          description: "Desc 1",
          searxngScore: 0.5,
        },
        {
          url: "http://example.com",
          title: "Test 2",
          description: "Desc 2",
          searxngScore: 0.8,
        },
      ];
      const { uniqueResults } = deduplicateResults(results);
      expect(uniqueResults[0].searxngScore).toBe(0.8);
    });

    it("should merge engine lists", () => {
      const results: WebSearchResult[] = [
        {
          url: "http://example.com",
          title: "Test 1",
          description: "Desc 1",
          engines: ["google"],
        },
        {
          url: "http://example.com",
          title: "Test 2",
          description: "Desc 2",
          engines: ["bing"],
        },
      ];
      const { uniqueResults } = deduplicateResults(results);
      expect(uniqueResults[0].engines).toEqual(["google", "bing"]);
    });

    it("should track hit counts", () => {
      const results: WebSearchResult[] = [
        { url: "http://example.com", title: "Test 1", description: "Desc 1" },
        { url: "http://example.com", title: "Test 2", description: "Desc 2" },
        { url: "http://example.org", title: "Test 3", description: "Desc 3" },
      ];
      const { hitCounts } = deduplicateResults(results);
      expect(hitCounts.get("http://example.com")).toBe(2);
      expect(hitCounts.get("http://example.org")).toBe(1);
    });

    it("should normalize URLs (www prefix)", () => {
      const results: WebSearchResult[] = [
        { url: "http://example.com", title: "Test 1", description: "Desc 1" },
        {
          url: "http://www.example.com",
          title: "Test 2",
          description: "Desc 2",
        },
      ];
      const { uniqueResults } = deduplicateResults(results);
      expect(uniqueResults.length).toBe(1);
    });

    it("should normalize URLs (trailing slash)", () => {
      const results: WebSearchResult[] = [
        { url: "http://example.com", title: "Test 1", description: "Desc 1" },
        { url: "http://example.com/", title: "Test 2", description: "Desc 2" },
      ];
      const { uniqueResults } = deduplicateResults(results);
      expect(uniqueResults.length).toBe(1);
    });

    it("should remove tracking parameters", () => {
      const results: WebSearchResult[] = [
        {
          url: "http://example.com?utm_source=test",
          title: "Test 1",
          description: "Desc 1",
        },
        { url: "http://example.com", title: "Test 2", description: "Desc 2" },
      ];
      const { uniqueResults } = deduplicateResults(results);
      expect(uniqueResults.length).toBe(1);
    });

    it("should handle empty array", () => {
      const { uniqueResults, hitCounts } = deduplicateResults([]);
      expect(uniqueResults).toEqual([]);
      expect(hitCounts.size).toBe(0);
    });
  });

  describe("aggregateByCategory", () => {
    it("should group results by category", () => {
      const results: WebSearchResult[] = [
        {
          url: "http://example1.com",
          title: "Test 1",
          description: "Desc 1",
          category: "github",
        },
        {
          url: "http://example2.com",
          title: "Test 2",
          description: "Desc 2",
          category: "github",
        },
        {
          url: "http://example3.com",
          title: "Test 3",
          description: "Desc 3",
          category: "news",
        },
      ];
      const categoryMap = aggregateByCategory(results);
      expect(categoryMap.get("github")).toHaveLength(2);
      expect(categoryMap.get("news")).toHaveLength(1);
    });

    it("should use general as default category", () => {
      const results: WebSearchResult[] = [
        { url: "http://example.com", title: "Test 1", description: "Desc 1" },
      ];
      const categoryMap = aggregateByCategory(results);
      expect(categoryMap.get("general")).toHaveLength(1);
    });

    it("should handle empty array", () => {
      const categoryMap = aggregateByCategory([]);
      expect(categoryMap.size).toBe(0);
    });
  });

  describe("coarseRank", () => {
    it("should rank by combined score", () => {
      const results: WebSearchResult[] = [
        {
          url: "http://example1.com",
          title: "Test 1",
          description: "Desc 1",
          searxngScore: 0.5,
        },
        {
          url: "http://example2.com",
          title: "Test 2",
          description: "Desc 2",
          searxngScore: 0.8,
        },
      ];
      const hitCounts = new Map([
        ["http://example1.com", 1],
        ["http://example2.com", 1],
      ]);
      const ranked = coarseRank(results, hitCounts);
      expect(ranked[0].url).toBe("http://example2.com");
    });

    it("should boost score with hit count", () => {
      const results: WebSearchResult[] = [
        {
          url: "http://example1.com",
          title: "Test 1",
          description: "Desc 1",
          searxngScore: 0.5,
        },
        {
          url: "http://example2.com",
          title: "Test 2",
          description: "Desc 2",
          searxngScore: 0.5,
        },
      ];
      const hitCounts = new Map([
        ["http://example1.com", 3],
        ["http://example2.com", 1],
      ]);
      const ranked = coarseRank(results, hitCounts);
      expect(ranked[0].url).toBe("http://example1.com");
    });

    it("should handle missing scores", () => {
      const results: WebSearchResult[] = [
        { url: "http://example1.com", title: "Test 1", description: "Desc 1" },
        { url: "http://example2.com", title: "Test 2", description: "Desc 2" },
      ];
      const hitCounts = new Map([
        ["http://example1.com", 1],
        ["http://example2.com", 1],
      ]);
      const ranked = coarseRank(results, hitCounts);
      expect(ranked).toHaveLength(2);
    });

    it("should sort in descending order", () => {
      const results: WebSearchResult[] = [
        {
          url: "http://example1.com",
          title: "Test 1",
          description: "Desc 1",
          searxngScore: 0.3,
        },
        {
          url: "http://example2.com",
          title: "Test 2",
          description: "Desc 2",
          searxngScore: 0.9,
        },
        {
          url: "http://example3.com",
          title: "Test 3",
          description: "Desc 3",
          searxngScore: 0.6,
        },
      ];
      const hitCounts = new Map([
        ["http://example1.com", 1],
        ["http://example2.com", 1],
        ["http://example3.com", 1],
      ]);
      const ranked = coarseRank(results, hitCounts);
      expect(ranked[0].url).toBe("http://example2.com");
      expect(ranked[1].url).toBe("http://example3.com");
      expect(ranked[2].url).toBe("http://example1.com");
    });
  });

  describe("prepareForReranker", () => {
    it("should limit results to max", () => {
      const results: WebSearchResult[] = Array.from(
        { length: 100 },
        (_, i) => ({
          url: `http://example${i}.com`,
          title: `Test ${i}`,
          description: `Desc ${i}`,
        }),
      );
      const prepared = prepareForReranker(results, 50);
      expect(prepared.length).toBe(50);
    });

    it("should remove internal _combinedScore field", () => {
      const results: WebSearchResult[] = [
        {
          url: "http://example.com",
          title: "Test",
          description: "Desc",
        } as any,
      ];
      (results[0] as any)._combinedScore = 0.9;
      const prepared = prepareForReranker(results, 10);
      expect(prepared[0]).not.toHaveProperty("_combinedScore");
    });

    it("should handle empty array", () => {
      const prepared = prepareForReranker([], 10);
      expect(prepared).toEqual([]);
    });
  });

  describe("aggregateResults", () => {
    it("should perform full aggregation pipeline", () => {
      const results: WebSearchResult[] = [
        {
          url: "http://example.com",
          title: "Test 1",
          description: "Desc 1",
          searxngScore: 0.5,
          engines: ["google"],
        },
        {
          url: "http://example.com",
          title: "Test 2",
          description: "Desc 2",
          searxngScore: 0.8,
          engines: ["bing"],
        },
        {
          url: "http://example.org",
          title: "Test 3",
          description: "Desc 3",
          searxngScore: 0.9,
          engines: ["google"],
        },
      ];
      const aggregated = aggregateResults(results, 50);

      // Should deduplicate
      expect(aggregated.length).toBe(2);

      // Should rank (higher score first)
      expect(aggregated[0].url).toBe("http://example.org");

      // Should remove internal fields
      expect(aggregated[0]).not.toHaveProperty("_combinedScore");
    });

    it("should limit results", () => {
      const results: WebSearchResult[] = Array.from(
        { length: 100 },
        (_, i) => ({
          url: `http://example${i}.com`,
          title: `Test ${i}`,
          description: `Desc ${i}`,
          searxngScore: Math.random(),
        }),
      );
      const aggregated = aggregateResults(results, 10);
      expect(aggregated.length).toBe(10);
    });

    it("should handle empty array", () => {
      const aggregated = aggregateResults([]);
      expect(aggregated).toEqual([]);
    });
  });
});
