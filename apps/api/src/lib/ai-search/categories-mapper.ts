/**
 * Categories Mapper
 * Maps category options to both query rewrite format and native SearXNG categories
 */

type CategoryOption = string | { type: string; sites?: string[] };

// Default research sites
const DEFAULT_RESEARCH_SITES = [
  "arxiv.org",
  "scholar.google.com",
  "pubmed.ncbi.nlm.nih.gov",
  "researchgate.net",
  "nature.com",
  "science.org",
  "ieee.org",
  "acm.org",
  "springer.com",
  "wiley.com",
  "sciencedirect.com",
  "plos.org",
  "biorxiv.org",
  "medrxiv.org",
];

// Category mapping to SearXNG native categories
const CATEGORY_TO_SEARXNG: Record<string, string> = {
  github: "it",
  research: "science",
  news: "news",
  images: "images",
  videos: "videos",
  pdf: "files",
};

/**
 * Map category options to native SearXNG categories
 * @param categories - Array of category options
 * @returns Array of SearXNG category strings
 */
export function mapCategoriesToNative(categories: CategoryOption[]): string[] {
  const nativeCategories: string[] = [];

  for (const category of categories) {
    let categoryType: string;

    if (typeof category === "string") {
      categoryType = category;
    } else {
      categoryType = category.type;
    }

    const mappedCategory = CATEGORY_TO_SEARXNG[categoryType];
    if (mappedCategory && !nativeCategories.includes(mappedCategory)) {
      nativeCategories.push(mappedCategory);
    }
  }

  return nativeCategories;
}

/**
 * Map category options to query rewrite format (site: filters)
 * @param categories - Array of category options
 * @returns Object with query string and category map
 */
export function mapCategoriesToQueryRewrite(categories: CategoryOption[]): {
  queryRewrite: string;
  categoryMap: Map<string, string>;
} {
  const siteFilters: string[] = [];
  const categoryMap = new Map<string, string>();
  let hasPdfFilter = false;

  for (const category of categories) {
    let categoryType: string;
    let customSites: string[] | undefined;

    if (typeof category === "string") {
      categoryType = category;
    } else {
      categoryType = category.type;
      customSites = category.sites;
    }

    switch (categoryType) {
      case "github":
        siteFilters.push("site:github.com");
        categoryMap.set("github.com", "github");
        break;

      case "research":
        const sites = customSites || DEFAULT_RESEARCH_SITES;
        for (const site of sites) {
          siteFilters.push(`site:${site}`);
          categoryMap.set(site, "research");
        }
        break;

      case "pdf":
        hasPdfFilter = true;
        categoryMap.set("__pdf__", "pdf");
        break;

      case "news":
      case "images":
      case "videos":
        // These use native SearXNG categories, not query rewrite
        break;

      default:
        // Unknown category, skip
        break;
    }
  }

  // Build the OR filter for sites
  let queryRewrite = "";
  if (siteFilters.length > 0) {
    queryRewrite = " (" + siteFilters.join(" OR ") + ")";
  }

  // Add filetype:pdf filter if PDF category is requested
  if (hasPdfFilter) {
    queryRewrite += " filetype:pdf";
  }

  return { queryRewrite, categoryMap };
}

/**
 * Determine the category for a given URL
 * @param url - The URL to categorize
 * @param categoryMap - Map of hostnames to categories
 * @returns The category name or undefined
 */
export function getCategoryFromUrl(
  url: string,
  categoryMap: Map<string, string>,
): string | undefined {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname.toLowerCase();

    // Check if URL points to a PDF file
    if (pathname.endsWith(".pdf") && categoryMap.has("__pdf__")) {
      return "pdf";
    }

    // Direct match for GitHub
    if (hostname === "github.com" || hostname.endsWith(".github.com")) {
      return "github";
    }

    // Check against category map for other sites
    for (const [site, category] of categoryMap.entries()) {
      if (site === "__pdf__") continue; // Skip the special PDF marker

      if (
        hostname === site.toLowerCase() ||
        hostname.endsWith("." + site.toLowerCase())
      ) {
        return category;
      }
    }
  } catch (e) {
    // Invalid URL, skip
  }

  return undefined;
}

/**
 * Get default research sites
 * @returns Array of default research site domains
 */
export function getDefaultResearchSites(): string[] {
  return [...DEFAULT_RESEARCH_SITES];
}
