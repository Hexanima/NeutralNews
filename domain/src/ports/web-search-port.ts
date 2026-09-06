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
import type { UUID } from "../types/uuid.js";
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

export type WebSearchExtractionFailure =
  | {
    readonly sourceId: UUID;
    readonly kind: "partial";
  }
  | {
    readonly sourceId: UUID;
    readonly kind: "error";
    readonly error: PortError;
  };

export interface WebSearchSourceScope {
  source: NewsSource;
  domains: readonly string[];
}

export interface WebSearchResponse {
  results: readonly WebSearchResult[];
  consultedUrls: readonly ArticleUrl[];
  failedExtractions?: readonly WebSearchExtractionFailure[] | undefined;
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
