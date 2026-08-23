import type {
  Article,
  EvidenceFragment,
} from "../entities/article-evidence.js";
import type { AsyncResult } from "../types/result.js";
import type {
  LimitedPortOperationOptions,
  PortError,
} from "./common.js";

export interface ArticleExtractionResult {
  article: Article;
  evidence: readonly EvidenceFragment[];
}

export interface ArticleExtractorPort {
  extractArticle: (input: {
    article: Article;
    options?: LimitedPortOperationOptions | undefined;
  }) => AsyncResult<ArticleExtractionResult, PortError>;
}
