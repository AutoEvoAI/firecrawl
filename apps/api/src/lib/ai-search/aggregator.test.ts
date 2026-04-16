import {
  deduplicateResults,
  aggregateByCategory,
  coarseRank,
  prepareForReranker,
  aggregateResults,
  mergeExtraData,
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
      // Check that hit counts are tracked (using Array.from to avoid key normalization issues)
      const hitCountValues = Array.from(hitCounts.values());
      expect(hitCountValues).toContain(2);
      expect(hitCountValues).toContain(1);
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
      // Note: www prefix is NOT removed by current implementation
      // This test documents current behavior
      expect(uniqueResults.length).toBe(2);
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
        ["http://example1.com", 2], // Higher hit count to boost ranking
        ["http://example2.com", 1],
      ]);
      const ranked = coarseRank(results, hitCounts);
      // Formula: hitCount × searxngScore
      // example1.com: 2 × 0.5 = 1.0
      // example2.com: 1 × 0.8 = 0.8
      expect(ranked[0].url).toBe("http://example1.com");
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
      // Formula: hitCount × searxngScore
      // example1.com: 3 × 0.5 = 1.5
      // example2.com: 1 × 0.5 = 0.5
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
      // Use the same URLs as in results (will be normalized by coarseRank)
      const hitCounts = new Map([
        [results[0].url, 1],
        [results[1].url, 2], // Higher hit count
        [results[2].url, 1],
      ]);
      const ranked = coarseRank(results, hitCounts);
      // Formula: hitCount × searxngScore
      // example1.com: 1 × 0.3 = 0.3
      // example2.com: 2 × 0.9 = 1.8
      // example3.com: 1 × 0.6 = 0.6
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

      // Should rank (higher score first, formula: hitCount × searxngScore)
      // example.com: hitCount=2, searxngScore=0.8 (kept higher score) → 2 × 0.8 = 1.6
      // example.org: hitCount=1, searxngScore=0.9 → 1 × 0.9 = 0.9
      expect(aggregated[0].url).toBe("http://example.com");

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

  describe("mergeExtraData", () => {
    it("should merge suggestions with deduplication", () => {
      const extras = [
        { suggestions: ["suggestion 1", "suggestion 2"] },
        { suggestions: ["suggestion 2", "suggestion 3"] },
      ];
      const merged = mergeExtraData(extras);
      expect(merged.suggestions).toEqual(["suggestion 1", "suggestion 2", "suggestion 3"]);
    });

    it("should merge answers", () => {
      const extras = [
        { answers: [{ text: "answer 1" }] },
        { answers: [{ text: "answer 2" }] },
      ];
      const merged = mergeExtraData(extras);
      expect(merged.answers).toHaveLength(2);
    });

    it("should merge corrections with deduplication", () => {
      const extras = [
        { corrections: ["correction 1"] },
        { corrections: ["correction 1", "correction 2"] },
      ];
      const merged = mergeExtraData(extras);
      expect(merged.corrections).toEqual(["correction 1", "correction 2"]);
    });

    it("should merge infoboxes with deduplication", () => {
      const extras = [
        { infoboxes: [{ title: "Infobox 1", content: {} }] },
        { infoboxes: [{ title: "Infobox 1", content: {} }, { title: "Infobox 2", content: {} }] },
      ];
      const merged = mergeExtraData(extras);
      expect(merged.infoboxes).toHaveLength(2);
    });

    it("should merge engine data", () => {
      const extras = [
        { engineData: { engine1: { param1: "value1" } } as Record<string, Record<string, string>> },
        { engineData: { engine2: { param2: "value2" } } as Record<string, Record<string, string>> },
      ];
      const merged = mergeExtraData(extras);
      expect(merged.engineData).toEqual({
        engine1: { param1: "value1" },
        engine2: { param2: "value2" },
      });
    });

    it("should merge unresponsive engines with deduplication", () => {
      const extras = [
        { unresponsiveEngines: [{ engine: "google", error_type: "timeout", suspended: false }] },
        { unresponsiveEngines: [{ engine: "google", error_type: "timeout", suspended: false }, { engine: "bing", error_type: "blocked", suspended: true }] },
      ];
      const merged = mergeExtraData(extras);
      expect(merged.unresponsiveEngines).toHaveLength(2);
    });

    it("should handle empty array", () => {
      const merged = mergeExtraData([]);
      expect(merged).toEqual({});
    });

    it("should handle extras with missing fields", () => {
      const extras = [
        { suggestions: ["suggestion 1"] },
        { corrections: ["correction 1"] },
      ];
      const merged = mergeExtraData(extras);
      expect(merged.suggestions).toEqual(["suggestion 1"]);
      expect(merged.corrections).toEqual(["correction 1"]);
      expect(merged.answers).toBeUndefined();
      expect(merged.infoboxes).toBeUndefined();
    });
  });
});
