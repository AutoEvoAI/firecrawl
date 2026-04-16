import {
  classifyIntent,
  expandQuery,
  preprocessQuery,
  shouldExpandQuery,
  shouldClassifyIntent,
} from "./preprocessor";
import { generateObject } from "ai";
import { redisEvictConnection } from "../../services/redis";
import { config } from "../../config";

// Mock the AI SDK
jest.mock("ai");
const mockedGenerateObject = generateObject as jest.MockedFunction<
  typeof generateObject
>;

// Mock Redis connection
jest.mock("../../services/redis", () => ({
  redisEvictConnection: {
    get: jest.fn(),
    setex: jest.fn(),
  },
}));

// Mock config
jest.mock("../../config", () => ({
  config: {
    AI_SEARCH_LLM_MODEL: "gpt-4o-mini",
    AI_SEARCH_LLM_API_KEY: "test-key",
    AI_SEARCH_LLM_BASE_URL: "https://test.com",
    AI_SEARCH_LLM_TIMEOUT: 100, // Short timeout for tests
  },
}));

describe("preprocessor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("classifyIntent", () => {
    it("should classify intent using LLM", async () => {
      mockedGenerateObject.mockResolvedValue({
        object: {
          intent: "informational",
          confidence: 0.9,
          firecrawlCategories: [],
          searxngCategories: ["general"],
        },
      } as any);

      const result = await classifyIntent("how to learn programming");
      expect(result.intent).toBe("informational");
      expect(result.confidence).toBe(0.9);
    });

    it("should return fallback on error", async () => {
      mockedGenerateObject.mockRejectedValue(new Error("LLM error"));

      const result = await classifyIntent("test query");
      expect(result.intent).toBe("informational");
      expect(result.confidence).toBe(0.5);
    });

    it("should handle all intent types", async () => {
      const intents = [
        "informational",
        "navigational",
        "transactional",
        "research",
      ];

      for (const intent of intents) {
        mockedGenerateObject.mockResolvedValue({
          object: {
            intent,
            confidence: 0.8,
            firecrawlCategories: [],
            searxngCategories: ["general"],
          },
        } as any);

        const result = await classifyIntent("test");
        expect(result.intent).toBe(intent);
      }
    });
  });

  describe("expandQuery", () => {
    it("should expand query using LLM", async () => {
      mockedGenerateObject.mockResolvedValue({
        object: {
          queries: [
            "how to learn programming for beginners",
            "programming tutorial guide",
          ],
        },
      } as any);

      const result = await expandQuery("learn programming");
      expect(result).toEqual([
        "how to learn programming for beginners",
        "programming tutorial guide",
      ]);
    });

    it("should return original query on error", async () => {
      mockedGenerateObject.mockRejectedValue(new Error("LLM error"));

      const result = await expandQuery("learn programming");
      expect(result).toEqual(["learn programming"]);
    });
  });

  describe("preprocessQuery", () => {
    it("should classify intent and expand query in parallel", async () => {
      mockedGenerateObject
        .mockResolvedValueOnce({
          object: {
            intent: "informational",
            confidence: 0.9,
            firecrawlCategories: [],
            searxngCategories: ["general"],
          },
        } as any)
        .mockResolvedValueOnce({
          object: {
            queries: ["expanded query 1", "expanded query 2"],
          },
        } as any);

      const result = await preprocessQuery("test query");
      expect(result.intent).toBe("informational");
      expect(result.expandedQueries).toEqual([
        "expanded query 1",
        "expanded query 2",
      ]);
    });

    it("should handle LLM errors gracefully", async () => {
      mockedGenerateObject.mockRejectedValue(new Error("LLM error"));

      const result = await preprocessQuery("test");
      expect(result.intent).toBe("informational");
      expect(result.expandedQueries).toEqual(["test"]);
    });
  });

  describe("shouldExpandQuery", () => {
    it("should return true for expand mode", () => {
      expect(shouldExpandQuery("expand")).toBe(true);
    });

    it("should return true for full mode", () => {
      expect(shouldExpandQuery("full")).toBe(true);
    });

    it("should return true for auto mode", () => {
      expect(shouldExpandQuery("auto")).toBe(true);
    });

    it("should return false for rerank mode", () => {
      expect(shouldExpandQuery("rerank")).toBe(false);
    });

    it("should return false for false mode", () => {
      expect(shouldExpandQuery("false")).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(shouldExpandQuery()).toBe(false);
    });
  });

  describe("shouldClassifyIntent", () => {
    it("should return true for full mode", () => {
      expect(shouldClassifyIntent("full")).toBe(true);
    });

    it("should return true for auto mode", () => {
      expect(shouldClassifyIntent("auto")).toBe(true);
    });

    it("should return false for expand mode", () => {
      expect(shouldClassifyIntent("expand")).toBe(false);
    });

    it("should return false for rerank mode", () => {
      expect(shouldClassifyIntent("rerank")).toBe(false);
    });

    it("should return false for false mode", () => {
      expect(shouldClassifyIntent("false")).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(shouldClassifyIntent()).toBe(false);
    });
  });

  describe("caching", () => {
    it("should use cached result for classifyIntent", async () => {
      const cachedResult = {
        intent: "informational",
        confidence: 0.9,
        firecrawlCategories: [],
        searxngCategories: ["general"],
      };
      (redisEvictConnection.get as jest.Mock).mockResolvedValue(
        JSON.stringify(cachedResult)
      );

      const result = await classifyIntent("test query");
      expect(result).toEqual(cachedResult);
      expect(redisEvictConnection.get).toHaveBeenCalled();
      expect(mockedGenerateObject).not.toHaveBeenCalled();
    });

    it("should cache classifyIntent result", async () => {
      (redisEvictConnection.get as jest.Mock).mockResolvedValue(null);
      mockedGenerateObject.mockResolvedValue({
        object: {
          intent: "informational",
          confidence: 0.9,
          firecrawlCategories: [],
          searxngCategories: ["general"],
        },
      } as any);

      await classifyIntent("test query");
      expect(redisEvictConnection.setex).toHaveBeenCalled();
    });

    it("should use cached result for expandQuery", async () => {
      const cachedResult = ["expanded query 1", "expanded query 2"];
      (redisEvictConnection.get as jest.Mock).mockResolvedValue(
        JSON.stringify(cachedResult)
      );

      const result = await expandQuery("test query");
      expect(result).toEqual(cachedResult);
      expect(redisEvictConnection.get).toHaveBeenCalled();
      expect(mockedGenerateObject).not.toHaveBeenCalled();
    });

    it("should cache expandQuery result", async () => {
      (redisEvictConnection.get as jest.Mock).mockResolvedValue(null);
      mockedGenerateObject.mockResolvedValue({
        object: {
          queries: ["expanded query 1", "expanded query 2"],
        },
      } as any);

      await expandQuery("test query");
      expect(redisEvictConnection.setex).toHaveBeenCalled();
    });

    it("should handle cache errors gracefully for classifyIntent", async () => {
      (redisEvictConnection.get as jest.Mock).mockRejectedValue(
        new Error("Redis error")
      );
      mockedGenerateObject.mockResolvedValue({
        object: {
          intent: "informational",
          confidence: 0.9,
          firecrawlCategories: [],
          searxngCategories: ["general"],
        },
      } as any);

      const result = await classifyIntent("test query");
      expect(result.intent).toBe("informational");
    });

    it("should handle cache errors gracefully for expandQuery", async () => {
      (redisEvictConnection.get as jest.Mock).mockRejectedValue(
        new Error("Redis error")
      );
      mockedGenerateObject.mockResolvedValue({
        object: {
          queries: ["expanded query 1", "expanded query 2"],
        },
      } as any);

      const result = await expandQuery("test query");
      expect(result).toEqual(["expanded query 1", "expanded query 2"]);
    });
  });

  describe("timeout protection", () => {
    it("should handle timeout for classifyIntent", async () => {
      (redisEvictConnection.get as jest.Mock).mockResolvedValue(null);
      mockedGenerateObject.mockImplementation(
        () =>
          new Promise(resolve =>
            setTimeout(() => resolve({ object: {} } as any), 200)
          )
      );

      const result = await classifyIntent("test query");
      expect(result.intent).toBe("informational"); // Fallback
    });

    it("should handle timeout for expandQuery", async () => {
      (redisEvictConnection.get as jest.Mock).mockResolvedValue(null);
      mockedGenerateObject.mockImplementation(
        () =>
          new Promise(resolve =>
            setTimeout(() => resolve({ object: {} } as any), 200)
          )
      );

      const result = await expandQuery("test query");
      expect(result).toEqual(["test query"]); // Fallback
    });
  });
});
