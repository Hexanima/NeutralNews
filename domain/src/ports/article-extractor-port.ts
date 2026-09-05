import type {
  Article,
  EvidenceFragment,
} from "../entities/article-evidence.js";
import type { AsyncResult } from "../types/result.js";
import type {
  LimitedPortOperationOptions,
  PortError,
} from "./common.js";

export type ArticleExtractionStatus = "full_text" | "partial";

export interface ArticleExtractionResult {
  article: Article;
  evidence: readonly EvidenceFragment[];
  extractionStatus: ArticleExtractionStatus;
}

export interface ArticleExtractorPort {
  extractArticle: (input: {
    article: Article;
    fallbackEvidence: readonly EvidenceFragment[];
    options?: LimitedPortOperationOptions | undefined;
  }) => AsyncResult<ArticleExtractionResult, PortError>;
}
