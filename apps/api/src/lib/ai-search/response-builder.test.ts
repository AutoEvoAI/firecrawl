import {
  buildSearchResponse,
  addAiMetadata,
  formatForCache,
  shouldIncludeAIMetadata,
} from "./response-builder";
import { SearchV2Response } from "../entities";

describe("response-builder", () => {
  describe("buildSearchResponse", () => {
    it("should build response with results", () => {
      const results: SearchV2Response = {
        web: [
          { url: "http://example.com", title: "Test", description: "Desc" },
        ],
      };
      const response = buildSearchResponse(results);
      expect(response.web).toEqual(results.web);
    });

    it("should include extra data when requested", () => {
      const results: SearchV2Response = {
        web: [
          { url: "http://example.com", title: "Test", description: "Desc" },
        ],
      };
      const extra = { suggestions: ["s1"] };
      const response = buildSearchResponse(results, extra, true);
      expect(response.extra).toEqual(extra);
    });

    it("should not include extra data when not requested", () => {
      const results: SearchV2Response = {
        web: [
          { url: "http://example.com", title: "Test", description: "Desc" },
        ],
      };
      const extra = { suggestions: ["s1"] };
      const response = buildSearchResponse(results, extra, false);
      expect(response.extra).toBeUndefined();
    });

    it("should add AI metadata when provided", () => {
      const results: SearchV2Response = {
        web: [
          { url: "http://example.com", title: "Test", description: "Desc" },
        ],
      };
      const aiMetadata = { aiMode: "full", processingTimeMs: 1000 };
      const response = buildSearchResponse(results, null, false, aiMetadata);
      expect((response as any).aiMetadata).toEqual(aiMetadata);
    });

    it("should not add AI metadata when empty", () => {
      const results: SearchV2Response = {
        web: [
          { url: "http://example.com", title: "Test", description: "Desc" },
        ],
      };
      const response = buildSearchResponse(results, null, false, {});
      expect((response as any).aiMetadata).toBeUndefined();
    });
  });

  describe("addAiMetadata", () => {
    it("should add all provided metadata fields", () => {
      const metadata = addAiMetadata({
        aiMode: "full",
        processingTimeMs: 1000,
        phaseTimes: { cache: 50, search: 200 },
        cacheHit: true,
        expandedQueries: ["test query expanded"],
        intent: "research",
        reranked: true,
      });
      expect(metadata).toEqual({
        aiMode: "full",
        processingTimeMs: 1000,
        phaseTimes: { cache: 50, search: 200 },
        cacheHit: true,
        expandedQueries: ["test query expanded"],
        intent: "research",
        reranked: true,
      });
    });

    it("should add only provided metadata fields", () => {
      const metadata = addAiMetadata({
        aiMode: "expand",
        cacheHit: false,
      });
      expect(metadata).toEqual({
        aiMode: "expand",
        cacheHit: false,
      });
      expect(metadata.processingTimeMs).toBeUndefined();
      expect(metadata.intent).toBeUndefined();
    });

    it("should return empty object when no params", () => {
      const metadata = addAiMetadata({});
      expect(metadata).toEqual({});
    });
  });

  describe("formatForCache", () => {
    it("should stringify response for cache", () => {
      const results: SearchV2Response = {
        web: [
          { url: "http://example.com", title: "Test", description: "Desc" },
        ],
      };
      const cached = formatForCache(results);
      expect(typeof cached).toBe("string");
      const parsed = JSON.parse(cached);
      expect(parsed.web).toEqual(results.web);
    });

    it("should include extra data in cache", () => {
      const results: SearchV2Response = {
        web: [
          { url: "http://example.com", title: "Test", description: "Desc" },
        ],
      };
      const extra = { suggestions: ["s1"] };
      const cached = formatForCache(results, extra);
      const parsed = JSON.parse(cached);
      expect(parsed.extra).toEqual(extra);
    });
  });

  describe("shouldIncludeAIMetadata", () => {
    it("should include metadata for non-false aiMode", () => {
      expect(shouldIncludeAIMetadata("expand")).toBe(true);
      expect(shouldIncludeAIMetadata("rerank")).toBe(true);
      expect(shouldIncludeAIMetadata("full")).toBe(true);
      expect(shouldIncludeAIMetadata("auto")).toBe(true);
    });

    it("should not include metadata for false aiMode", () => {
      expect(shouldIncludeAIMetadata("false")).toBe(false);
    });

    it("should not include metadata for undefined aiMode", () => {
      expect(shouldIncludeAIMetadata()).toBe(false);
    });
  });
});
