import {
  getCacheKey,
  getSearchResult,
  setSearchResult,
  invalidateCache,
  getTTLByMode,
} from "./search-cache";
import { redisEvictConnection } from "../services/redis";

// Mock Redis connection
jest.mock("../services/redis", () => ({
  redisEvictConnection: {
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    keys: jest.fn(),
  },
}));

describe("search-cache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getCacheKey", () => {
    it("should generate consistent cache keys for same input", () => {
      const key1 = getCacheKey("test query", "false", { limit: 10 });
      const key2 = getCacheKey("test query", "false", { limit: 10 });
      expect(key1).toBe(key2);
    });

    it("should generate different keys for different queries", () => {
      const key1 = getCacheKey("query one", "false", { limit: 10 });
      const key2 = getCacheKey("query two", "false", { limit: 10 });
      expect(key1).not.toBe(key2);
    });

    it("should generate different keys for different aiMode", () => {
      const key1 = getCacheKey("test query", "false", { limit: 10 });
      const key2 = getCacheKey("test query", "expand", { limit: 10 });
      expect(key1).not.toBe(key2);
    });

    it("should generate different keys for different options", () => {
      const key1 = getCacheKey("test query", "false", { limit: 10 });
      const key2 = getCacheKey("test query", "false", { limit: 20 });
      expect(key1).not.toBe(key2);
    });

    it("should normalize query case", () => {
      const key1 = getCacheKey("Test Query", "false", { limit: 10 });
      const key2 = getCacheKey("test query", "false", { limit: 10 });
      expect(key1).toBe(key2);
    });

    it("should handle empty options", () => {
      const key = getCacheKey("test query", "false");
      expect(key).toBeDefined();
      expect(typeof key).toBe("string");
    });
  });

  describe("getSearchResult", () => {
    it("should return cached result when found", async () => {
      const mockResult = '{"web":[{"url":"http://example.com"}]}';
      (redisEvictConnection.get as jest.Mock).mockResolvedValue(mockResult);

      const result = await getSearchResult("test-key");
      expect(result).toBe(mockResult);
      expect(redisEvictConnection.get).toHaveBeenCalledWith("test-key");
    });

    it("should return null when cache miss", async () => {
      (redisEvictConnection.get as jest.Mock).mockResolvedValue(null);

      const result = await getSearchResult("test-key");
      expect(result).toBeNull();
    });

    it("should return null on Redis error", async () => {
      (redisEvictConnection.get as jest.Mock).mockRejectedValue(
        new Error("Redis error"),
      );

      const result = await getSearchResult("test-key");
      expect(result).toBeNull();
    });
  });

  describe("setSearchResult", () => {
    it("should store result with TTL", async () => {
      (redisEvictConnection.setex as jest.Mock).mockResolvedValue("OK");

      await setSearchResult("test-key", "test-value", 300);
      expect(redisEvictConnection.setex).toHaveBeenCalledWith(
        "test-key",
        300,
        "test-value",
      );
    });

    it("should store result without TTL", async () => {
      (redisEvictConnection.set as jest.Mock).mockResolvedValue("OK");

      await setSearchResult("test-key", "test-value");
      expect(redisEvictConnection.set).toHaveBeenCalledWith(
        "test-key",
        "test-value",
      );
    });

    it("should handle Redis error gracefully", async () => {
      (redisEvictConnection.setex as jest.Mock).mockRejectedValue(
        new Error("Redis error"),
      );

      // Should not throw
      await expect(
        setSearchResult("test-key", "test-value", 300),
      ).resolves.toBeUndefined();
    });
  });

  describe("invalidateCache", () => {
    it("should delete keys matching pattern", async () => {
      (redisEvictConnection.keys as jest.Mock).mockResolvedValue([
        "key1",
        "key2",
      ]);
      (redisEvictConnection.del as jest.Mock).mockResolvedValue(2);

      const count = await invalidateCache("ai-search:*");
      expect(count).toBe(2);
      expect(redisEvictConnection.keys).toHaveBeenCalledWith("ai-search:*");
      expect(redisEvictConnection.del).toHaveBeenCalledWith("key1", "key2");
    });

    it("should return 0 when no keys match", async () => {
      (redisEvictConnection.keys as jest.Mock).mockResolvedValue([]);

      const count = await invalidateCache("ai-search:*");
      expect(count).toBe(0);
      expect(redisEvictConnection.del).not.toHaveBeenCalled();
    });

    it("should handle Redis error gracefully", async () => {
      (redisEvictConnection.keys as jest.Mock).mockRejectedValue(
        new Error("Redis error"),
      );

      const count = await invalidateCache("ai-search:*");
      expect(count).toBe(0);
    });
  });

  describe("getTTLByMode", () => {
    it("should return 900s for AI modes", () => {
      expect(getTTLByMode("expand")).toBe(900);
      expect(getTTLByMode("rerank")).toBe(900);
      expect(getTTLByMode("full")).toBe(900);
      expect(getTTLByMode("auto")).toBe(900);
    });

    it("should return 1800s for non-AI mode", () => {
      const ttl = getTTLByMode("false");
      expect(ttl).toBe(1800);
    });

    it("should return 300s for day/hour tbs", () => {
      expect(getTTLByMode("false", "qdr:h")).toBe(300);
      expect(getTTLByMode("false", "qdr:d")).toBe(300);
    });

    it("should return 300s for week/month tbs", () => {
      expect(getTTLByMode("false", "qdr:w")).toBe(300);
      expect(getTTLByMode("false", "qdr:m")).toBe(300);
    });

    it("should return 300s for year tbs", () => {
      expect(getTTLByMode("false", "qdr:y")).toBe(300);
    });

    it("should return 900s for unknown mode", () => {
      const ttl = getTTLByMode("unknown");
      expect(ttl).toBe(900);
    });

    it("should return 900s for unknown mode", () => {
      expect(getTTLByMode("unknown")).toBe(900);
    });

    it("should use tbs parameter for dynamic TTL", () => {
      expect(getTTLByMode("false", "qdr:h")).toBe(300);
    });
  });
});
