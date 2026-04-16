/**
 * Result Parser Unit Tests
 */

import {
  parseSearXNGResponse,
  classifyResult,
  classifyResults,
  mergeSuggestions,
  shouldIncludeExtra,
  formatExtraForResponse,
  ResultCategory,
  ClassifiedResult,
} from "../../../lib/ai-search/result-parser";

describe("result-parser", () => {
  describe("parseSearXNGResponse", () => {
    it("should parse suggestions", () => {
      const mockResponse = {
        results: [],
        answers: [],
        infoboxes: [],
        suggestions: ["test suggestion 1", "test suggestion 2"],
        corrections: [],
        engine_data: {},
      };

      const result = parseSearXNGResponse(mockResponse);

      expect(result.suggestions).toEqual(["test suggestion 1", "test suggestion 2"]);
    });

    it("should parse corrections", () => {
      const mockResponse = {
        results: [],
        answers: [],
        infoboxes: [],
        suggestions: [],
        corrections: ["test correction"],
        engine_data: {},
      };

      const result = parseSearXNGResponse(mockResponse);

      expect(result.corrections).toEqual(["test correction"]);
    });

    it("should parse answers", () => {
      const mockResponse = {
        results: [],
        answers: [
          { content: "test answer", engine: "test engine", url: "http://example.com" },
          { title: "test title", engine: "test engine" },
        ],
        infoboxes: [],
        suggestions: [],
        corrections: [],
        engine_data: {},
      };

      const result = parseSearXNGResponse(mockResponse);

      expect(result.answers).toHaveLength(2);
      expect(result.answers![0].text).toBe("test answer");
      expect(result.answers![0].engine).toBe("test engine");
      expect(result.answers![1].text).toBe("test title");
    });

    it("should parse infoboxes", () => {
      const mockResponse = {
        results: [],
        answers: [],
        infoboxes: [
          {
            infobox: "Test Infobox",
            content: { field1: "value1" },
            img_src: "http://example.com/image.jpg",
            engine: "test engine",
          },
        ],
        suggestions: [],
        corrections: [],
        engine_data: {},
      };

      const result = parseSearXNGResponse(mockResponse);

      expect(result.infoboxes).toHaveLength(1);
      expect(result.infoboxes![0].title).toBe("Test Infobox");
      expect(result.infoboxes![0].content).toEqual({ field1: "value1" });
    });

    it("should parse engine data", () => {
      const mockResponse = {
        results: [],
        answers: [],
        infoboxes: [],
        suggestions: [],
        corrections: [],
        engine_data: { engine1: { param1: "value1" } },
      };

      const result = parseSearXNGResponse(mockResponse);

      expect(result.engineData).toEqual({ engine1: { param1: "value1" } });
    });

    it("should parse unresponsive engines", () => {
      const mockResponse = {
        results: [],
        answers: [],
        infoboxes: [],
        suggestions: [],
        corrections: [],
        engine_data: {},
        unresponsive_engines: [
          { engine: "google", error_type: "timeout", suspended: false },
          { engine: "bing", error_type: "blocked", suspended: true },
        ],
      };

      const result = parseSearXNGResponse(mockResponse);

      expect(result.unresponsiveEngines).toHaveLength(2);
      expect(result.unresponsiveEngines![0].engine).toBe("google");
      expect(result.unresponsiveEngines![0].error_type).toBe("timeout");
      expect(result.unresponsiveEngines![1].suspended).toBe(true);
    });

    it("should handle empty response", () => {
      const mockResponse = {
        results: [],
        answers: [],
        infoboxes: [],
        suggestions: [],
        corrections: [],
        engine_data: {},
      };

      const result = parseSearXNGResponse(mockResponse);

      // Empty arrays are returned for consistency
      expect(result).toEqual({
        answers: [],
        corrections: [],
        engineData: {},
        infoboxes: [],
        suggestions: [],
      });
    });
  });

  describe("classifyResult", () => {
    it("should classify as images when category is images", () => {
      const result = { category: "images", url: "http://example.com", title: "Test", content: "Test content" };
      const category = classifyResult(result);

      expect(category).toBe("images");
    });

    it("should classify as images when img_src is present", () => {
      const result = { category: "web", img_src: "http://example.com/image.jpg", url: "http://example.com", title: "Test", content: "Test content" };
      const category = classifyResult(result);

      expect(category).toBe("images");
    });

    it("should classify as images when thumbnail_src is present", () => {
      const result = { category: "web", thumbnail_src: "http://example.com/thumb.jpg", url: "http://example.com", title: "Test", content: "Test content" };
      const category = classifyResult(result);

      expect(category).toBe("images");
    });

    it("should classify as news when category is news", () => {
      const result = { category: "news", url: "http://example.com", title: "Test", content: "Test content" };
      const category = classifyResult(result);

      expect(category).toBe("news");
    });

    it("should classify as news when publishedDate and news engine", () => {
      const result = {
        category: "web",
        publishedDate: "2024-01-01",
        engine: "bing news",
        url: "http://example.com",
        title: "Test",
        content: "Test content",
      };
      const category = classifyResult(result);

      expect(category).toBe("news");
    });

    it("should classify as web when no special conditions", () => {
      const result = { category: "web", url: "http://example.com", title: "Test", content: "Test content" };
      const category = classifyResult(result);

      expect(category).toBe("web");
    });

    it("should classify as web when publishedDate but not news engine", () => {
      const result = {
        category: "web",
        publishedDate: "2024-01-01",
        engine: "google",
        url: "http://example.com",
        title: "Test",
        content: "Test content",
      };
      const category = classifyResult(result);

      expect(category).toBe("web");
    });
  });

  describe("classifyResults", () => {
    it("should classify mixed results correctly", () => {
      const results = [
        { category: "web", url: "http://web1.com", title: "Web 1", content: "Content 1" },
        { category: "images", url: "http://img1.com", title: "Image 1", content: "Content 2" },
        { category: "news", url: "http://news1.com", title: "News 1", content: "Content 3" },
        { category: "web", url: "http://web2.com", title: "Web 2", content: "Content 4" },
      ];

      const classified = classifyResults(results);

      expect(classified.web).toHaveLength(2);
      expect(classified.images).toHaveLength(1);
      expect(classified.news).toHaveLength(1);
      expect(classified.web[0].category).toBe("web");
      expect(classified.images[0].category).toBe("images");
      expect(classified.news[0].category).toBe("news");
    });

    it("should preserve metadata in classified results", () => {
      const results = [
        {
          category: "web",
          url: "http://example.com",
          title: "Test",
          content: "Test content",
          score: 0.95,
          engines: ["google", "bing"],
          publishedDate: "2024-01-01",
          author: "John Doe",
        },
      ];

      const classified = classifyResults(results);

      expect(classified.web[0].searxngScore).toBe(0.95);
      expect(classified.web[0].engines).toEqual(["google", "bing"]);
      expect(classified.web[0].publishedDate).toBe("2024-01-01");
      expect(classified.web[0].author).toBe("John Doe");
    });

    it("should handle empty results array", () => {
      const classified = classifyResults([]);

      expect(classified.web).toHaveLength(0);
      expect(classified.news).toHaveLength(0);
      expect(classified.images).toHaveLength(0);
    });
  });

  describe("mergeSuggestions", () => {
    it("should merge and deduplicate suggestions", () => {
      const searxngSuggestions = ["suggestion 1", "suggestion 2"];
      const preprocessorSuggestions = ["suggestion 2", "suggestion 3"];

      const merged = mergeSuggestions(searxngSuggestions, preprocessorSuggestions);

      expect(merged).toEqual(["suggestion 1", "suggestion 2", "suggestion 3"]);
    });

    it("should handle empty arrays", () => {
      const merged = mergeSuggestions([], []);

      expect(merged).toEqual([]);
    });

    it("should handle only searxng suggestions", () => {
      const merged = mergeSuggestions(["suggestion 1"], []);

      expect(merged).toEqual(["suggestion 1"]);
    });

    it("should handle only preprocessor suggestions", () => {
      const merged = mergeSuggestions([], ["suggestion 1"]);

      expect(merged).toEqual(["suggestion 1"]);
    });
  });

  describe("shouldIncludeExtra", () => {
    it("should return true when includeExtra is true", () => {
      const result = shouldIncludeExtra(true, "false");

      expect(result).toBe(true);
    });

    it("should return true when aiMode is full", () => {
      const result = shouldIncludeExtra(false, "full");

      expect(result).toBe(true);
    });

    it("should return true when aiMode is rerank", () => {
      const result = shouldIncludeExtra(false, "rerank");

      expect(result).toBe(true);
    });

    it("should return false when includeExtra is false and aiMode is not full/rerank", () => {
      const result = shouldIncludeExtra(false, "false");

      expect(result).toBe(false);
    });

    it("should return false when aiMode is expand", () => {
      const result = shouldIncludeExtra(false, "expand");

      expect(result).toBe(false);
    });
  });

  describe("formatExtraForResponse", () => {
    it("should return all extra data when includeExtra is true", () => {
      const extra = {
        suggestions: ["suggestion 1"],
        answers: [{ text: "answer" }],
        corrections: ["correction"],
        infoboxes: [{ title: "Infobox", content: {} }],
        engineData: {},
        unresponsiveEngines: [],
      };

      const formatted = formatExtraForResponse(extra, true);

      expect(formatted).toEqual(extra);
    });

    it("should return empty object when includeExtra is false", () => {
      const extra = {
        suggestions: ["suggestion 1"],
        answers: [{ text: "answer" }],
      };

      const formatted = formatExtraForResponse(extra, false);

      expect(formatted).toEqual({});
    });

    it("should handle empty extra data", () => {
      const extra = {};

      const formatted = formatExtraForResponse(extra, true);

      expect(formatted).toEqual(extra);
    });
  });
});
