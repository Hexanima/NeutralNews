import type {
  Article,
  ArticleUrl,
  EvidenceFragment,
} from "../entities/article-evidence.js";
import type { NewsSource } from "../entities/news-source.js";
import type { AsyncResult } from "../types/result.js";
import type { UUID } from "../types/uuid.js";
import type {
  LimitedPortOperationOptions,
  PortError,
} from "./common.js";

export interface RssFeedReadResult {
  sourceId: UUID;
  feedUrl: ArticleUrl;
  articles: readonly Article[];
  evidence: readonly EvidenceFragment[];
}

export interface RssFeedReaderPort {
  readFeed: (input: {
    source: NewsSource;
    feedUrl: ArticleUrl;
    options?: LimitedPortOperationOptions | undefined;
  }) => AsyncResult<RssFeedReadResult, PortError>;
}
