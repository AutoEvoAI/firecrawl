import type { Action } from "../controllers/v1/types";
import type { BrandingProfile } from "../types/branding";
import type { SearXNGExtra } from "./ai-search/result-parser";

export type PageOptions = {
  includeMarkdown?: boolean;
  includeExtract?: boolean;
  onlyMainContent?: boolean;
  includeHtml?: boolean;
  includeRawHtml?: boolean;
  fallback?: boolean;
  fetchPageContent?: boolean;
  waitFor?: number;
  screenshot?: boolean;
  fullPageScreenshot?: boolean;
  headers?: Record<string, string>;
  replaceAllPathsWithAbsolutePaths?: boolean;
  parsePDF?: boolean;
  removeTags?: string | string[];
  onlyIncludeTags?: string | string[];
  includeLinks?: boolean;
  useFastMode?: boolean; // beta
  disableJsDom?: boolean; // beta
  atsv?: boolean; // anti-bot solver, beta
  actions?: Action[]; // beta
  geolocation?: {
    country?: string;
  };
  skipTlsVerification?: boolean;
  removeBase64Images?: boolean;
  mobile?: boolean;
};

export type ExtractorOptions = {
  mode:
    | "markdown"
    | "llm-extraction"
    | "llm-extraction-from-markdown"
    | "llm-extraction-from-raw-html";
  extractionPrompt?: string;
  extractionSchema?: Record<string, any>;
  userPrompt?: string;
};

export type SearchOptions = {
  limit?: number;
  tbs?: string;
  filter?: string;
  lang?: string;
  country?: string;
  location?: string;
};

export class Document {
  id?: string;
  url?: string; // Used only in /search for now
  content: string;
  markdown?: string;
  html?: string;
  rawHtml?: string;
  llm_extraction?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
  type?: string;
  metadata: {
    sourceURL?: string;
    [key: string]: any;
  };
  childrenLinks?: string[];
  provider?: string;
  warning?: string;
  actions?: {
    screenshots?: string[];
    scrapes?: ScrapeActionContent[];
    javascriptReturns?: {
      type: string;
      value: unknown;
    }[];
    pdfs?: string[];
  };
  branding?: BrandingProfile;

  index?: number;
  linksOnPage?: string[]; // Add this new field as a separate property

  constructor(data: Partial<Document>) {
    if (!data.content) {
      throw new Error("Missing required fields");
    }
    this.content = data.content;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
    this.type = data.type || "unknown";
    this.metadata = data.metadata || { sourceURL: "" };
    this.markdown = data.markdown || "";
    this.childrenLinks = data.childrenLinks || undefined;
    this.provider = data.provider || undefined;
    this.linksOnPage = data.linksOnPage; // Assign linksOnPage if provided
  }
}

export class SearchResult {
  url: string;
  title: string;
  description: string;

  constructor(url: string, title: string, description: string) {
    this.url = url;
    this.title = title;
    this.description = description;
  }

  toString(): string {
    return `SearchResult(url=${this.url}, title=${this.title}, description=${this.description})`;
  }
}

interface ImageSearchResult {
  title?: string;
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  url?: string;
  position?: number;
  answer?: string;
}

interface NewsSearchResult {
  title?: string;
  url?: string;
  snippet?: string;
  date?: string;
  imageUrl?: string;
  position?: number;
  category?: string;
  // Scraped content fields
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  screenshot?: string;
  metadata?: Record<string, any>;
  answer?: string;
}

export interface WebSearchResult {
  url: string;
  title: string;
  description: string;
  position?: number;
  category?: string;
  // SearXNG metadata (for internal use in reranking/aggregation)
  searxngScore?: number;
  engines?: string[];
  publishedDate?: string;
  author?: string;
  // AI relevance score (Phase 6)
  relevanceScore?: number;
  // Scraped content fields
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  screenshot?: string;
  metadata?: Record<string, any>;
  answer?: string;

  // Internal tags for deduplication tracking
  _query?: string;
  _queryIndex?: number;
}

export type SearchResultType = "web" | "images" | "news";

export interface AIMetadata {
  aiMode?: string;
  processingTimeMs?: number;
  phaseTimes?: Record<string, number>;
  cacheHit?: boolean;
  expandedQueries?: string[];
  intent?: string;
  confidence?: number;
  firecrawlCategories?: string[];
  searxngCategories?: string[];
  searxngEngines?: string[];
  timeRange?: string | null;
  reranked?: boolean;
  rerankModel?: string;
  totalCandidates?: number;
}

export interface SearchV2Response {
  web?: WebSearchResult[];
  images?: WebSearchResult[];
  news?: WebSearchResult[];
  // Phase 6: Top-level extra fields (not nested under 'extra')
  suggestions?: string[];
  answers?: Array<{
    text: string;
    source?: string;
    url?: string;
    engine?: string;
  }>;
  corrections?: string[];
  knowledgeCards?: Array<{
    title: string;
    content: Record<string, any>;
    img_src?: string;
    urls?: Array<{ title: string; url: string }>;
    engine?: string;
  }>;
  aiMetadata?: AIMetadata;
  // Keep 'extra' for backward compatibility (deprecated)
  extra?: SearXNGExtra;
}

export interface ScrapeActionContent {
  url: string;
  html: string;
}
