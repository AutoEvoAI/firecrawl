import {
  parseSearXNGResponse,
  mergeSuggestions,
  shouldIncludeExtra,
  formatExtraForResponse,
} from "./result-parser";

describe("result-parser", () => {
  describe("parseSearXNGResponse", () => {
    it("should parse suggestions", () => {
      const response = {
        results: [],
        answers: [],
        infoboxes: [],
        suggestions: ["suggestion1", "suggestion2"],
        corrections: [],
        engine_data: {},
      };
      const result = parseSearXNGResponse(response);
      expect(result.suggestions).toEqual(["suggestion1", "suggestion2"]);
    });

    it("should parse corrections", () => {
      const response = {
        results: [],
        answers: [],
        infoboxes: [],
        suggestions: [],
        corrections: ["correction1"],
        engine_data: {},
      };
      const result = parseSearXNGResponse(response);
      expect(result.corrections).toEqual(["correction1"]);
    });

    it("should parse answers", () => {
      const response = {
        results: [],
        answers: [
          { content: "Answer text", engine: "google" },
          { title: "Title only", engine: "bing" },
        ],
        infoboxes: [],
        suggestions: [],
        corrections: [],
        engine_data: {},
      };
      const result = parseSearXNGResponse(response);
      expect(result.answers).toHaveLength(2);
      expect(result.answers?.[0].text).toBe("Answer text");
      expect(result.answers?.[0].source).toBe("google");
      expect(result.answers?.[1].text).toBe("Title only");
    });

    it("should filter empty answers", () => {
      const response = {
        results: [],
        answers: [
          { content: "", engine: "google" },
          { title: "", engine: "bing" },
        ],
        infoboxes: [],
        suggestions: [],
        corrections: [],
        engine_data: {},
      };
      const result = parseSearXNGResponse(response);
      expect(result.answers).toHaveLength(0);
    });

    it("should parse infoboxes", () => {
      const response = {
        results: [],
        answers: [],
        infoboxes: [
          {
            infobox: "Infobox title",
            content: { field1: "value1" },
            img_src: "http://example.com/image.jpg",
          },
        ],
        suggestions: [],
        corrections: [],
        engine_data: {},
      };
      const result = parseSearXNGResponse(response);
      expect(result.infoboxes).toHaveLength(1);
      expect(result.infoboxes?.[0].title).toBe("Infobox title");
      expect(result.infoboxes?.[0].content).toEqual({ field1: "value1" });
    });

    it("should parse engine data", () => {
      const response = {
        results: [],
        answers: [],
        infoboxes: [],
        suggestions: [],
        corrections: [],
        engine_data: {
          google: { time: "0.5" },
          bing: { time: "0.3" },
        },
      };
      const result = parseSearXNGResponse(response);
      expect(result.engineData).toEqual({
        google: { time: "0.5" },
        bing: { time: "0.3" },
      });
    });

    it("should handle empty response", () => {
      const response = {
        results: [],
        answers: [],
        infoboxes: [],
        suggestions: [],
        corrections: [],
        engine_data: {},
      };
      const result = parseSearXNGResponse(response);
      expect(result).toEqual({});
    });

    it("should handle null/undefined fields", () => {
      const response = {
        results: [],
        answers: null as any,
        infoboxes: undefined as any,
        suggestions: null as any,
        corrections: undefined as any,
        engine_data: null as any,
      };
      const result = parseSearXNGResponse(response);
      expect(result).toEqual({});
    });
  });

  describe("mergeSuggestions", () => {
    it("should merge suggestions from both sources", () => {
      const result = mergeSuggestions(["s1", "s2"], ["s3", "s4"]);
      expect(result).toEqual(["s1", "s2", "s3", "s4"]);
    });

    it("should deduplicate suggestions", () => {
      const result = mergeSuggestions(["s1", "s2"], ["s2", "s3"]);
      expect(result).toEqual(["s1", "s2", "s3"]);
    });

    it("should handle empty arrays", () => {
      expect(mergeSuggestions([], [])).toEqual([]);
      expect(mergeSuggestions(["s1"], [])).toEqual(["s1"]);
      expect(mergeSuggestions([], ["s1"])).toEqual(["s1"]);
    });

    it("should handle null/undefined defaults", () => {
      expect(mergeSuggestions(undefined as any, undefined as any)).toEqual([]);
    });
  });

  describe("shouldIncludeExtra", () => {
    it("should include when includeExtra is true", () => {
      expect(shouldIncludeExtra(true, "false")).toBe(true);
    });

    it("should include when aiMode is full", () => {
      expect(shouldIncludeExtra(false, "full")).toBe(true);
    });

    it("should include when aiMode is rerank", () => {
      expect(shouldIncludeExtra(false, "rerank")).toBe(true);
    });

    it("should not include when includeExtra is false and aiMode is false", () => {
      expect(shouldIncludeExtra(false, "false")).toBe(false);
    });

    it("should not include when includeExtra is false and aiMode is expand", () => {
      expect(shouldIncludeExtra(false, "expand")).toBe(false);
    });

    it("should not include when includeExtra is false and aiMode is auto", () => {
      expect(shouldIncludeExtra(false, "auto")).toBe(false);
    });
  });

  describe("formatExtraForResponse", () => {
    it("should return extra when includeExtra is true", () => {
      const extra = {
        suggestions: ["s1"],
        answers: [{ text: "answer" }],
        corrections: ["c1"],
        infoboxes: [{ title: "Infobox", content: {} }],
        engineData: {},
      };
      const result = formatExtraForResponse(extra, true);
      expect(result).toEqual(extra);
    });

    it("should return empty object when includeExtra is false", () => {
      const extra = {
        suggestions: ["s1"],
        answers: [{ text: "answer" }],
      };
      const result = formatExtraForResponse(extra, false);
      expect(result).toEqual({});
    });

    it("should handle empty extra", () => {
      const result = formatExtraForResponse({}, true);
      expect(result).toEqual({});
    });
  });
});
