import { searxng_search } from "./searxng";
import { config } from "../../config";
import axios from "axios";

// Mock axios
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock config
jest.mock("../../config", () => ({
  config: {
    SEARXNG_ENDPOINT: "http://test.searxng.local",
    SEARXNG_ENGINES: "google,bing",
    SEARXNG_CATEGORIES: "general",
    AI_SEARCH_SAFESEARCH: "moderate",
  },
}));

describe("searxng_search", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should map engines from options", async () => {
    const mockResponse = {
      data: {
        results: [
          {
            url: "http://example.com",
            title: "Test",
            content: "Test content",
          },
        ],
      },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    await searxng_search("test query", {
      num_results: 10,
      engines: ["duckduckgo", "brave"],
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        params: expect.objectContaining({
          engines: "duckduckgo,brave",
        }),
      }),
    );
  });

  it("should map categories from options", async () => {
    const mockResponse = {
      data: {
        results: [
          {
            url: "http://example.com",
            title: "Test",
            content: "Test content",
          },
        ],
      },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    await searxng_search("test query", {
      num_results: 10,
      categories: ["news", "images"],
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        params: expect.objectContaining({
          categories: "news,images",
        }),
      }),
    );
  });

  it("should map time_range parameter", async () => {
    const mockResponse = {
      data: {
        results: [
          {
            url: "http://example.com",
            title: "Test",
            content: "Test content",
          },
        ],
      },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    await searxng_search("test query", {
      num_results: 10,
      tbs: "d7", // Past week
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        params: expect.objectContaining({
          time_range: "d7",
        }),
      }),
    );
  });

  it("should map safesearch parameter", async () => {
    const mockResponse = {
      data: {
        results: [
          {
            url: "http://example.com",
            title: "Test",
            content: "Test content",
          },
        ],
      },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    await searxng_search("test query", {
      num_results: 10,
      safesearch: "strict",
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        params: expect.objectContaining({
          safesearch: "strict",
        }),
      }),
    );
  });

  it("should use config defaults when options not provided", async () => {
    const mockResponse = {
      data: {
        results: [
          {
            url: "http://example.com",
            title: "Test",
            content: "Test content",
          },
        ],
      },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    await searxng_search("test query", {
      num_results: 10,
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        params: expect.objectContaining({
          engines: "google,bing",
          categories: "general",
          safesearch: "moderate",
        }),
      }),
    );
  });

  it("should retain SearXNG metadata in results", async () => {
    const mockResponse = {
      data: {
        results: [
          {
            url: "http://example.com",
            title: "Test",
            content: "Test content",
            score: 0.95,
            engines: ["google", "bing"],
            category: "general",
            publishedDate: "2024-01-01",
            author: "Test Author",
          },
        ],
      },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    const result = await searxng_search("test query", {
      num_results: 10,
    });

    expect(result.web?.[0]).toMatchObject({
      url: "http://example.com",
      title: "Test",
      description: "Test content",
      searxngScore: 0.95,
      engines: ["google", "bing"],
      category: "general",
      publishedDate: "2024-01-01",
      author: "Test Author",
    });
  });

  it("should handle zero results request", async () => {
    const result = await searxng_search("test query", {
      num_results: 0,
    });

    expect(result).toEqual({});
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("should handle axios error gracefully", async () => {
    mockedAxios.get.mockRejectedValue(new Error("Network error"));

    const result = await searxng_search("test query", {
      num_results: 10,
    });

    expect(result).toEqual({});
  });

  it("should handle empty results array", async () => {
    const mockResponse = {
      data: {
        results: [],
      },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    const result = await searxng_search("test query", {
      num_results: 10,
    });

    expect(result).toEqual({});
  });

  it("should handle timeout", async () => {
    mockedAxios.get.mockRejectedValue(new Error("timeout of 10000ms exceeded"));

    const result = await searxng_search("test query", {
      num_results: 10,
    });

    expect(result).toEqual({});
  });

  it("should limit results to requested number", async () => {
    const mockResponse = {
      data: {
        results: Array.from({ length: 30 }, (_, i) => ({
          url: `http://example.com/${i}`,
          title: `Test ${i}`,
          content: `Content ${i}`,
        })),
      },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    const result = await searxng_search("test query", {
      num_results: 10,
    });

    expect(result.web?.length).toBe(10);
  });

  it("should store full SearXNG response for later parsing", async () => {
    const mockResponse = {
      data: {
        results: [
          {
            url: "http://example.com",
            title: "Test",
            content: "Test content",
          },
        ],
        suggestions: ["suggestion1", "suggestion2"],
        corrections: ["correction1"],
        answers: [],
        infoboxes: [],
        engine_data: {},
      },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    const result = await searxng_search("test query", {
      num_results: 10,
    });

    expect((result as any)._searxngFullResponse).toBeDefined();
    expect((result as any)._searxngFullResponse.suggestions).toEqual([
      "suggestion1",
      "suggestion2",
    ]);
  });
});
