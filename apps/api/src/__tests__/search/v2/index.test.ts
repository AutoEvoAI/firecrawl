import { search } from "../../../search/v2/index";
import { searxng_search } from "../../../search/v2/searxng";
import { fire_engine_search_v2 } from "../../../search/v2/fireEngine-v2";
import { ddgSearch } from "../../../search/v2/ddgsearch";
import { Logger } from "winston";
import { config } from "../../../config";

// Mock the search functions
jest.mock("../../../search/v2/searxng");
jest.mock("../../../search/v2/fireEngine-v2");
jest.mock("../../../search/v2/ddgsearch");

// Mock config
jest.mock("../../../config", () => ({
  config: {
    FIRE_ENGINE_BETA_URL: undefined,
    SEARXNG_ENDPOINT: "http://localhost:8888",
    AI_SEARCH_MAX_RESULTS_FOR_RERANK: 20,
  },
}));

const mockedSearxngSearch = searxng_search as jest.MockedFunction<
  typeof searxng_search
>;
const mockedFireEngineSearch = fire_engine_search_v2 as jest.MockedFunction<
  typeof fire_engine_search_v2
>;
const mockedDdgSearch = ddgSearch as jest.MockedFunction<typeof ddgSearch>;

describe("search/v2/index", () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  } as unknown as Logger;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("search fallback", () => {
    it("should use fire engine if available", async () => {
      // Temporarily set FIRE_ENGINE_BETA_URL for this test
      (config as any).FIRE_ENGINE_BETA_URL = "http://localhost:3000";
      mockedFireEngineSearch.mockResolvedValue({
        web: [
          {
            url: "http://example.com",
            title: "Result",
            description: "Description",
          },
        ],
      });

      const result = await search({
        query: "test",
        logger: mockLogger,
        num_results: 5,
      });

      expect(mockedFireEngineSearch).toHaveBeenCalled();
      expect(result.web).toBeDefined();

      // Reset config
      (config as any).FIRE_ENGINE_BETA_URL = undefined;
    });

    it("should fallback to SearXNG if fire engine not available", async () => {
      mockedSearxngSearch.mockResolvedValue({
        web: [
          {
            url: "http://example.com",
            title: "Result",
            description: "Description",
          },
        ],
      });

      const result = await search({
        query: "test",
        logger: mockLogger,
        num_results: 5,
      });

      expect(mockedSearxngSearch).toHaveBeenCalled();
      expect(result.web).toBeDefined();
    });

    it("should fallback to DuckDuckGo if SearXNG returns no results", async () => {
      mockedSearxngSearch.mockResolvedValue({});
      mockedDdgSearch.mockResolvedValue({
        web: [
          {
            url: "http://example.com",
            title: "Result",
            description: "Description",
          },
        ],
      });

      const result = await search({
        query: "test",
        logger: mockLogger,
        num_results: 5,
      });

      expect(mockedDdgSearch).toHaveBeenCalled();
      expect(result.web).toBeDefined();
    });

    it("should return empty response if all fallbacks fail", async () => {
      mockedSearxngSearch.mockResolvedValue({});
      mockedDdgSearch.mockResolvedValue({});

      const result = await search({
        query: "test",
        logger: mockLogger,
        num_results: 5,
      });

      expect(result).toEqual({});
    });
  });

  describe("AI metadata passing", () => {
    it("should pass AI metadata to SearXNG in single query mode", async () => {
      mockedSearxngSearch.mockResolvedValue({ web: [] });

      await search({
        query: "test",
        logger: mockLogger,
        aiMode: "full",
        aiMetadata: {
          searxngCategories: ["science"],
          searxngEngines: ["arxiv"],
          timeRange: "day",
        },
        num_results: 5,
      });

      expect(mockedSearxngSearch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          categories: ["science"],
          engines: ["arxiv"],
          time_range: "day",
          aiMode: "full",
        }),
      );
    });

    it("should pass includeExtra flag to SearXNG", async () => {
      mockedSearxngSearch.mockResolvedValue({ web: [] });

      await search({
        query: "test",
        logger: mockLogger,
        aiMode: "full",
        includeExtra: true,
        num_results: 5,
      });

      expect(mockedSearxngSearch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          includeExtra: true,
        }),
      );
    });
  });
});
