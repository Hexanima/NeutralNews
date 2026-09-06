import type {
  Article,
  ArticleUrl,
  EvidenceFragment,
} from "../entities/article-evidence.js";
import type { NewsSourceCatalogEntry } from "../catalog/news-source-catalog.js";
import {
  ExternalPortError,
  PortCancelledError,
  PortLimitExceededError,
  type LimitedPortOperationOptions,
  type PortError,
  type RssFeedReaderPort,
} from "../ports/index.js";
import {
  deduplicateArticles,
  filterArticlesByTopic,
  type ArticleDeduplicationOptions,
  type ArticleTopicMatchingPreferences,
  type ArticleMergeGroup,
} from "../services/index.js";
import { err, ok } from "../types/result.js";
import type { UseCase } from "../types/usecase.js";
import type { UUID } from "../types/uuid.js";

export interface AggregateRssFeedsDependencies {
  readonly rssFeedReader: RssFeedReaderPort;
}

export interface AggregateRssFeedsPayload {
  readonly sources: readonly NewsSourceCatalogEntry[];
  readonly options?: LimitedPortOperationOptions | undefined;
  readonly deduplication?: ArticleDeduplicationOptions | undefined;
  readonly topicMatching?: {
    readonly query: string;
    readonly preferences?: Partial<ArticleTopicMatchingPreferences> | undefined;
  } | undefined;
}

export interface AggregateRssFeedSuccess {
  readonly sourceId: UUID;
  readonly feedUrl: ArticleUrl;
  readonly articleCount: number;
  readonly evidenceCount: number;
}

export interface AggregateRssFeedFailure {
  readonly sourceId: UUID;
  readonly feedUrl: ArticleUrl;
  readonly errorType: PortError["type"];
  readonly operationName?: string | undefined;
  readonly category?: string | undefined;
  readonly statusCode?: number | undefined;
  readonly limitName?: string | undefined;
}

export interface AggregateRssFeedsResult {
  readonly articles: readonly Article[];
  readonly evidence: readonly EvidenceFragment[];
  readonly articleMergeGroups: readonly ArticleMergeGroup[];
  readonly successfulFeeds: readonly AggregateRssFeedSuccess[];
  readonly failedFeeds: readonly AggregateRssFeedFailure[];
}

const operationName = "rss.feed.aggregate";
const defaultMaxConcurrency = 3;

const isSignalAborted = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;

type RssCatalogEntry = NewsSourceCatalogEntry & {
  readonly discovery: { readonly mode: "rss"; readonly feedUrl: ArticleUrl };
};

type FeedOutcome =
  | {
      readonly ok: true;
      readonly value: AggregateRssFeedSuccess;
      readonly articles: readonly Article[];
      readonly evidence: readonly EvidenceFragment[];
    }
  | { readonly ok: false; readonly value: AggregateRssFeedFailure };

const isActiveRssEntry = (
  entry: NewsSourceCatalogEntry,
): entry is RssCatalogEntry =>
  entry.source.active && entry.discovery.mode === "rss";

const normalizeMaxConcurrency = (value: number | undefined): number =>
  value === undefined ? defaultMaxConcurrency : Math.max(1, Math.floor(value));

const failureFromError = (
  entry: RssCatalogEntry,
  error: PortError,
): AggregateRssFeedFailure => ({
  sourceId: entry.source.id,
  feedUrl: entry.discovery.feedUrl,
  errorType: error.type,
  ...("operationName" in error ? { operationName: error.operationName } : {}),
  ...(error instanceof ExternalPortError ? { category: error.category } : {}),
  ...(error instanceof ExternalPortError && error.statusCode !== undefined
    ? { statusCode: error.statusCode }
    : {}),
  ...(error instanceof PortLimitExceededError
    ? { limitName: error.limitName }
    : {}),
});


export const aggregateRssFeedsUseCase: UseCase<
  AggregateRssFeedsDependencies,
  AggregateRssFeedsPayload,
  AggregateRssFeedsResult,
  PortCancelledError
> = {
  execute: async ({ rssFeedReader }, { sources, options, deduplication, topicMatching }) => {
    const signal = options?.signal;

    if (isSignalAborted(signal)) {
      return err(new PortCancelledError(operationName));
    }

    const rssEntries = sources.filter(isActiveRssEntry);
    const maxConcurrency = normalizeMaxConcurrency(options?.maxConcurrency);
    const outcomes: FeedOutcome[] = [];
    let nextIndex = 0;

    const readNext = async (): Promise<void> => {
      while (nextIndex < rssEntries.length) {
        if (isSignalAborted(signal)) {
          return;
        }

        const index = nextIndex;
        nextIndex += 1;
        const entry = rssEntries[index]!;
        const result = await rssFeedReader.readFeed({
          source: entry.source,
          feedUrl: entry.discovery.feedUrl,
          options,
        });

        outcomes[index] = result.ok
          ? {
              ok: true,
              value: {
                sourceId: result.value.sourceId,
                feedUrl: result.value.feedUrl,
                articleCount: result.value.articles.length,
                evidenceCount: result.value.evidence.length,
              },
              articles: result.value.articles,
              evidence: result.value.evidence,
            }
          : {
              ok: false,
              value: failureFromError(entry, result.error),
            };
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(maxConcurrency, rssEntries.length) },
        () => readNext(),
      ),
    );

    const completedOutcomes = outcomes.filter(
      (outcome): outcome is FeedOutcome => outcome !== undefined,
    );
    const deduplicated = deduplicateArticles({
      articles: completedOutcomes.flatMap((outcome) =>
        outcome.ok ? outcome.articles : [],
      ),
      evidence: completedOutcomes.flatMap((outcome) =>
        outcome.ok ? outcome.evidence : [],
      ),
      trackingParameters: deduplication?.trackingParameters,
    });
    const filtered = topicMatching === undefined
      ? deduplicated
      : filterArticlesByTopic({
          ...deduplicated,
          query: topicMatching.query,
          preferences: topicMatching.preferences,
        });
    const aggregation: AggregateRssFeedsResult = {
      ...filtered,
      articleMergeGroups: deduplicated.articleMergeGroups,
      successfulFeeds: completedOutcomes.flatMap((outcome) =>
        outcome.ok ? [outcome.value] : [],
      ),
      failedFeeds: completedOutcomes.flatMap((outcome) =>
        outcome.ok ? [] : [outcome.value],
      ),
    };

    if (isSignalAborted(signal)) {
      return err(new PortCancelledError(operationName));
    }

    return ok(aggregation);
  },
};
