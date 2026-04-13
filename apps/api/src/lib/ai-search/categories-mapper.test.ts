import {
  mapCategoriesToNative,
  mapCategoriesToQueryRewrite,
  getCategoryFromUrl,
  getDefaultResearchSites,
} from "./categories-mapper";

describe("categories-mapper", () => {
  describe("mapCategoriesToNative", () => {
    it("should map github to it", () => {
      const result = mapCategoriesToNative(["github"]);
      expect(result).toEqual(["it"]);
    });

    it("should map research to science", () => {
      const result = mapCategoriesToNative(["research"]);
      expect(result).toEqual(["science"]);
    });

    it("should map news to news", () => {
      const result = mapCategoriesToNative(["news"]);
      expect(result).toEqual(["news"]);
    });

    it("should map images to images", () => {
      const result = mapCategoriesToNative(["images"]);
      expect(result).toEqual(["images"]);
    });

    it("should map videos to videos", () => {
      const result = mapCategoriesToNative(["videos"]);
      expect(result).toEqual(["videos"]);
    });

    it("should map pdf to files", () => {
      const result = mapCategoriesToNative(["pdf"]);
      expect(result).toEqual(["files"]);
    });

    it("should handle multiple categories", () => {
      const result = mapCategoriesToNative(["github", "news", "images"]);
      expect(result).toEqual(["it", "news", "images"]);
    });

    it("should deduplicate categories", () => {
      const result = mapCategoriesToNative(["github", "github", "news"]);
      expect(result).toEqual(["it", "news"]);
    });

    it("should handle object format categories", () => {
      const result = mapCategoriesToNative([
        { type: "github" },
        { type: "news" },
      ]);
      expect(result).toEqual(["it", "news"]);
    });

    it("should skip unknown categories", () => {
      const result = mapCategoriesToNative(["unknown", "github"]);
      expect(result).toEqual(["it"]);
    });

    it("should return empty array for no categories", () => {
      const result = mapCategoriesToNative([]);
      expect(result).toEqual([]);
    });
  });

  describe("mapCategoriesToQueryRewrite", () => {
    it("should map github to site filter", () => {
      const result = mapCategoriesToQueryRewrite(["github"]);
      expect(result.queryRewrite).toContain("site:github.com");
      expect(result.categoryMap.get("github.com")).toBe("github");
    });

    it("should map research to multiple site filters", () => {
      const result = mapCategoriesToQueryRewrite(["research"]);
      expect(result.queryRewrite).toContain("site:");
      expect(result.categoryMap.size).toBeGreaterThan(0);
    });

    it("should map pdf to filetype filter", () => {
      const result = mapCategoriesToQueryRewrite(["pdf"]);
      expect(result.queryRewrite).toContain("filetype:pdf");
      expect(result.categoryMap.has("__pdf__")).toBe(true);
    });

    it("should combine multiple filters with OR", () => {
      const result = mapCategoriesToQueryRewrite(["github", "research"]);
      expect(result.queryRewrite).toContain(" OR ");
    });

    it("should handle custom sites for research", () => {
      const customSites = ["custom1.com", "custom2.com"];
      const result = mapCategoriesToQueryRewrite([
        { type: "research", sites: customSites },
      ]);
      expect(result.queryRewrite).toContain("site:custom1.com");
      expect(result.queryRewrite).toContain("site:custom2.com");
    });

    it("should skip news/images/videos for query rewrite", () => {
      const result = mapCategoriesToQueryRewrite(["news", "images", "videos"]);
      expect(result.queryRewrite).toBe("");
    });

    it("should return empty for no categories", () => {
      const result = mapCategoriesToQueryRewrite([]);
      expect(result.queryRewrite).toBe("");
      expect(result.categoryMap.size).toBe(0);
    });
  });

  describe("getCategoryFromUrl", () => {
    it("should identify github URLs", () => {
      const categoryMap = new Map();
      const result = getCategoryFromUrl(
        "https://github.com/user/repo",
        categoryMap,
      );
      expect(result).toBe("github");
    });

    it("should identify github subdomain URLs", () => {
      const categoryMap = new Map();
      const result = getCategoryFromUrl(
        "https://api.github.com/user",
        categoryMap,
      );
      expect(result).toBe("github");
    });

    it("should identify PDF URLs", () => {
      const categoryMap = new Map([["__pdf__", "pdf"]]);
      const result = getCategoryFromUrl(
        "https://example.com/document.pdf",
        categoryMap,
      );
      expect(result).toBe("pdf");
    });

    it("should identify research sites from category map", () => {
      const categoryMap = new Map([["arxiv.org", "research"]]);
      const result = getCategoryFromUrl(
        "https://arxiv.org/abs/1234",
        categoryMap,
      );
      expect(result).toBe("research");
    });

    it("should identify subdomain research sites", () => {
      const categoryMap = new Map([["nature.com", "research"]]);
      const result = getCategoryFromUrl(
        "https://www.nature.com/articles",
        categoryMap,
      );
      expect(result).toBe("research");
    });

    it("should return undefined for unknown URLs", () => {
      const categoryMap = new Map();
      const result = getCategoryFromUrl(
        "https://unknown.com/page",
        categoryMap,
      );
      expect(result).toBeUndefined();
    });

    it("should handle invalid URLs gracefully", () => {
      const categoryMap = new Map();
      const result = getCategoryFromUrl("not-a-url", categoryMap);
      expect(result).toBeUndefined();
    });

    it("should handle empty category map", () => {
      const categoryMap = new Map();
      const result = getCategoryFromUrl(
        "https://github.com/user/repo",
        categoryMap,
      );
      expect(result).toBe("github"); // Still identifies github
    });
  });

  describe("getDefaultResearchSites", () => {
    it("should return array of research sites", () => {
      const sites = getDefaultResearchSites();
      expect(Array.isArray(sites)).toBe(true);
      expect(sites.length).toBeGreaterThan(0);
    });

    it("should include arxiv.org", () => {
      const sites = getDefaultResearchSites();
      expect(sites).toContain("arxiv.org");
    });

    it("should include scholar.google.com", () => {
      const sites = getDefaultResearchSites();
      expect(sites).toContain("scholar.google.com");
    });

    it("should include pubmed.ncbi.nlm.nih.gov", () => {
      const sites = getDefaultResearchSites();
      expect(sites).toContain("pubmed.ncbi.nlm.nih.gov");
    });
  });
});
