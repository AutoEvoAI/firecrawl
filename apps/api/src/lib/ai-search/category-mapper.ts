/**
 * Category Mapper for Phase 2
 * Implements dual-track mapping between Firecrawl categories and SearXNG categories/engines
 */

/**
 * Firecrawl category to SearXNG mapping configuration
 */
export interface CategoryMapping {
  searxngCategories?: string[];
  searxngEngines?: string[];
  queryRewrite?: string; // Track A: query rewrite (site:/filetype: syntax)
}

/**
 * Mapping table for Firecrawl categories to SearXNG
 * Based on design document requirements
 */
const CATEGORY_MAPPING_TABLE: Record<string, CategoryMapping> = {
  github: {
    searxngCategories: ["it"],
    queryRewrite: "site:github.com",
  },
  research: {
    searxngCategories: ["science"],
    searxngEngines: ["google scholar", "arxiv", "pubmed"],
    queryRewrite: "site:arxiv.org OR site:pubmed.ncbi.nlm.nih.gov",
  },
  pdf: {
    searxngCategories: ["files"],
    queryRewrite: "filetype:pdf",
  },
  news: {
    searxngCategories: ["news"],
    // Engines handled by SearXNG configuration
  },
  images: {
    searxngCategories: ["images"],
    // Engines handled by SearXNG configuration
  },
};

/**
 * Map Firecrawl categories to SearXNG categories and engines
 * @param categories - Firecrawl categories array
 * @returns CategoryMapping with SearXNG categories, engines, and query rewrite
 */
export function mapCategoriesToSearXNG(
  categories?: string[],
): CategoryMapping {
  if (!categories || categories.length === 0) {
    return {};
  }

  const mapping: CategoryMapping = {
    searxngCategories: [],
    searxngEngines: [],
    queryRewrite: "",
  };

  const uniqueCategories = [...new Set(categories)];

  for (const category of uniqueCategories) {
    const categoryMapping = CATEGORY_MAPPING_TABLE[category.toLowerCase()];
    if (categoryMapping) {
      // Merge SearXNG categories
      if (categoryMapping.searxngCategories) {
        mapping.searxngCategories = [
          ...(mapping.searxngCategories || []),
          ...categoryMapping.searxngCategories,
        ];
      }

      // Merge SearXNG engines
      if (categoryMapping.searxngEngines) {
        mapping.searxngEngines = [
          ...(mapping.searxngEngines || []),
          ...categoryMapping.searxngEngines,
        ];
      }

      // Build query rewrite (Track A)
      if (categoryMapping.queryRewrite) {
        if (mapping.queryRewrite) {
          mapping.queryRewrite += ` OR ${categoryMapping.queryRewrite}`;
        } else {
          mapping.queryRewrite = categoryMapping.queryRewrite;
        }
      }
    }
  }

  // Deduplicate categories and engines
  if (mapping.searxngCategories && mapping.searxngCategories.length > 0) {
    mapping.searxngCategories = [...new Set(mapping.searxngCategories)];
  }

  if (mapping.searxngEngines && mapping.searxngEngines.length > 0) {
    mapping.searxngEngines = [...new Set(mapping.searxngEngines)];
  }

  // Return empty objects if no mappings found
  if (
    (mapping.searxngCategories?.length || 0) === 0 &&
    (mapping.searxngEngines?.length || 0) === 0 &&
    !mapping.queryRewrite
  ) {
    return {};
  }

  return mapping;
}

/**
 * Apply query rewrite to the original query (Track A)
 * @param query - Original search query
 * @param categories - Firecrawl categories
 * @returns Rewritten query with site:/filetype: syntax
 */
export function applyQueryRewrite(
  query: string,
  categories?: string[],
): string {
  if (!categories || categories.length === 0) {
    return query;
  }

  const mapping = mapCategoriesToSearXNG(categories);
  if (!mapping.queryRewrite) {
    return query;
  }

  return `${query} (${mapping.queryRewrite})`;
}

/**
 * Get SearXNG categories from Firecrawl categories
 * @param categories - Firecrawl categories
 * @returns Array of SearXNG categories
 */
export function getSearXNGCategories(categories?: string[]): string[] {
  const mapping = mapCategoriesToSearXNG(categories);
  return mapping.searxngCategories || [];
}

/**
 * Get SearXNG engines from Firecrawl categories
 * @param categories - Firecrawl categories
 * @returns Array of SearXNG engines
 */
export function getSearXNGEngines(categories?: string[]): string[] {
  const mapping = mapCategoriesToSearXNG(categories);
  return mapping.searxngEngines || [];
}
