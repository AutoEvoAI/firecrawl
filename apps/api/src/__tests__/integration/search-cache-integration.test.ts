/**
 * Integration tests for search cache module
 * These tests require a running Redis instance
 * Run with: npm test -- search-cache-integration.test.ts
 */

import {
  getCacheKey,
  getSearchResult,
  setSearchResult,
  invalidateCache,
  getTTLByMode,
} from "../../lib/search-cache";
import { redisEvictConnection } from "../../services/redis";

describe("search-cache integration", () => {
  const testKey = "ai-search:test:integration";
  const testValue = JSON.stringify({
    web: [{ url: "http://example.com", title: "Test" }],
  });

  beforeAll(async () => {
    // Clean up any existing test data
    await invalidateCache("ai-search:test:*");
  });

  afterAll(async () => {
    // Clean up test data
    await invalidateCache("ai-search:test:*");
  });

  describe("cache operations", () => {
    it("should store and retrieve cached result", async () => {
      await setSearchResult(testKey, testValue, 60);
      const retrieved = await getSearchResult(testKey);

      expect(retrieved).toBe(testValue);
    });

    it("should return null for non-existent key", async () => {
      const retrieved = await getSearchResult("ai-search:test:nonexistent");
      expect(retrieved).toBeNull();
    });

    it("should invalidate cache by pattern", async () => {
      await setSearchResult("ai-search:test:pattern1", testValue, 60);
      await setSearchResult("ai-search:test:pattern2", testValue, 60);

      const count = await invalidateCache("ai-search:test:pattern*");
      expect(count).toBeGreaterThanOrEqual(2);

      const retrieved1 = await getSearchResult("ai-search:test:pattern1");
      const retrieved2 = await getSearchResult("ai-search:test:pattern2");
      expect(retrieved1).toBeNull();
      expect(retrieved2).toBeNull();
    });
  });

  describe("cache key consistency", () => {
    it("should generate same key for identical inputs", () => {
      const key1 = getCacheKey("test query", "false", { limit: 10 });
      const key2 = getCacheKey("test query", "false", { limit: 10 });
      expect(key1).toBe(key2);
    });

    it("should generate different keys for different aiMode", () => {
      const key1 = getCacheKey("test query", "false", { limit: 10 });
      const key2 = getCacheKey("test query", "expand", { limit: 10 });
      expect(key1).not.toBe(key2);
    });
  });

  describe("TTL by mode", () => {
    it("should return correct TTL for each mode", () => {
      expect(getTTLByMode("expand")).toBe(900);
      expect(getTTLByMode("rerank")).toBe(900);
      expect(getTTLByMode("full")).toBe(900);
      expect(getTTLByMode("auto")).toBe(900);
      expect(getTTLByMode("false")).toBe(1800);
    });
  });

  describe("cache expiration", () => {
    it("should expire after TTL", async () => {
      const shortTTLKey = "ai-search:test:short";
      await setSearchResult(shortTTLKey, testValue, 1); // 1 second TTL

      // Should exist immediately
      let retrieved = await getSearchResult(shortTTLKey);
      expect(retrieved).toBe(testValue);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be expired
      retrieved = await getSearchResult(shortTTLKey);
      expect(retrieved).toBeNull();
    }, 3000); // 3 second timeout
  });

  describe("cache with different aiMode TTLs", () => {
    it("should use different TTLs for different aiMode", async () => {
      const nonAiKey = "ai-search:test:nonai";
      const aiKey = "ai-search:test:ai";

      await setSearchResult(nonAiKey, testValue, getTTLByMode("false"));
      await setSearchResult(aiKey, testValue, getTTLByMode("expand"));

      const nonAiRetrieved = await getSearchResult(nonAiKey);
      const aiRetrieved = await getSearchResult(aiKey);

      expect(nonAiRetrieved).toBe(testValue);
      expect(aiRetrieved).toBe(testValue);

      // Cleanup
      await redisEvictConnection.del(nonAiKey, aiKey);
    });
  });
});
