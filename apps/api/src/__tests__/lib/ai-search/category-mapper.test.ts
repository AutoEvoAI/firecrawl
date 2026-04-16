import {
  mapCategoriesToSearXNG,
  applyQueryRewrite,
  getSearXNGCategories,
  getSearXNGEngines,
} from "../../../lib/ai-search/category-mapper";

describe("category-mapper", () => {
  describe("mapCategoriesToSearXNG", () => {
    it("should map github category correctly", () => {
      const result = mapCategoriesToSearXNG(["github"]);
      expect(result.searxngCategories).toEqual(["it"]);
      expect(result.queryRewrite).toBe("site:github.com");
    });

    it("should map research category correctly", () => {
      const result = mapCategoriesToSearXNG(["research"]);
      expect(result.searxngCategories).toEqual(["science"]);
      expect(result.searxngEngines).toEqual([
        "google scholar",
        "arxiv",
        "pubmed",
      ]);
      expect(result.queryRewrite).toBe(
        "site:arxiv.org OR site:pubmed.ncbi.nlm.nih.gov",
      );
    });

    it("should map pdf category correctly", () => {
      const result = mapCategoriesToSearXNG(["pdf"]);
      expect(result.searxngCategories).toEqual(["files"]);
      expect(result.queryRewrite).toBe("filetype:pdf");
    });

    it("should map news category correctly", () => {
      const result = mapCategoriesToSearXNG(["news"]);
      expect(result.searxngCategories).toEqual(["news"]);
    });

    it("should map images category correctly", () => {
      const result = mapCategoriesToSearXNG(["images"]);
      expect(result.searxngCategories).toEqual(["images"]);
    });

    it("should handle multiple categories", () => {
      const result = mapCategoriesToSearXNG(["github", "pdf"]);
      expect(result.searxngCategories).toEqual(["it", "files"]);
      expect(result.queryRewrite).toContain("site:github.com");
      expect(result.queryRewrite).toContain("filetype:pdf");
    });

    it("should deduplicate categories", () => {
      const result = mapCategoriesToSearXNG(["github", "github"]);
      expect(result.searxngCategories).toEqual(["it"]);
    });

    it("should return empty object for no categories", () => {
      const result = mapCategoriesToSearXNG([]);
      expect(result).toEqual({});
    });

    it("should return empty object for undefined categories", () => {
      const result = mapCategoriesToSearXNG(undefined);
      expect(result).toEqual({});
    });

    it("should handle unknown categories gracefully", () => {
      const result = mapCategoriesToSearXNG(["unknown"]);
      expect(result).toEqual({});
    });

    it("should handle mixed known and unknown categories", () => {
      const result = mapCategoriesToSearXNG(["github", "unknown"]);
      expect(result.searxngCategories).toEqual(["it"]);
      expect(result.queryRewrite).toBe("site:github.com");
    });

    it("should be case-insensitive", () => {
      const result = mapCategoriesToSearXNG(["GITHUB"]);
      expect(result.searxngCategories).toEqual(["it"]);
    });
  });

  describe("applyQueryRewrite", () => {
    it("should apply query rewrite for github", () => {
      const result = applyQueryRewrite("machine learning", ["github"]);
      expect(result).toBe("machine learning (site:github.com)");
    });

    it("should apply query rewrite for pdf", () => {
      const result = applyQueryRewrite("research paper", ["pdf"]);
      expect(result).toBe("research paper (filetype:pdf)");
    });

    it("should return original query for no categories", () => {
      const result = applyQueryRewrite("test query", []);
      expect(result).toBe("test query");
    });

    it("should return original query for undefined categories", () => {
      const result = applyQueryRewrite("test query", undefined);
      expect(result).toBe("test query");
    });

    it("should combine multiple query rewrites with OR", () => {
      const result = applyQueryRewrite("code", ["github", "pdf"]);
      expect(result).toContain("code");
      expect(result).toContain("site:github.com");
      expect(result).toContain("filetype:pdf");
      expect(result).toMatch(/\(.*OR.*\)/);
    });
  });

  describe("getSearXNGCategories", () => {
    it("should return SearXNG categories for github", () => {
      const result = getSearXNGCategories(["github"]);
      expect(result).toEqual(["it"]);
    });

    it("should return empty array for no categories", () => {
      const result = getSearXNGCategories([]);
      expect(result).toEqual([]);
    });

    it("should return empty array for undefined", () => {
      const result = getSearXNGCategories(undefined);
      expect(result).toEqual([]);
    });
  });

  describe("getSearXNGEngines", () => {
    it("should return SearXNG engines for research", () => {
      const result = getSearXNGEngines(["research"]);
      expect(result).toEqual(["google scholar", "arxiv", "pubmed"]);
    });

    it("should return empty array for categories without engines", () => {
      const result = getSearXNGEngines(["github"]);
      expect(result).toEqual([]);
    });

    it("should return empty array for no categories", () => {
      const result = getSearXNGEngines([]);
      expect(result).toEqual([]);
    });

    it("should return empty array for undefined", () => {
      const result = getSearXNGEngines(undefined);
      expect(result).toEqual([]);
    });
  });
});
