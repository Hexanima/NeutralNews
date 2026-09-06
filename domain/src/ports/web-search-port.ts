import type {
  Article,
  ArticleUrl,
  EvidenceFragment,
} from "../entities/article-evidence.js";
import type {
  LanguageCode,
  NewsSource,
  NewsSourceRegion,
} from "../entities/news-source.js";
import type { AsyncResult } from "../types/result.js";
import type {
  LimitedPortOperationOptions,
  PortError,
} from "./common.js";

export interface WebSearchResult {
  source: NewsSource;
  article: Article;
  evidence: EvidenceFragment;
}

export interface WebSearchSourceScope {
  source: NewsSource;
  domains: readonly string[];
}

export interface WebSearchResponse {
  results: readonly WebSearchResult[];
  consultedUrls: readonly ArticleUrl[];
}

export interface WebSearchPort {
  search: (input: {
    sourceScopes: readonly WebSearchSourceScope[];
    query: string;
    language?: LanguageCode | undefined;
    region?: NewsSourceRegion | undefined;
    allowedDomains?: readonly string[] | undefined;
    blockedDomains?: readonly string[] | undefined;
    options?: LimitedPortOperationOptions | undefined;
  }) => AsyncResult<WebSearchResponse, PortError>;
}
