import type {
  Article,
  ArticleUrl,
  EvidenceFragment,
} from "../entities/article-evidence.js";
import type {
  NewsSource,
  NewsSourceOrientation,
  NewsSourceRegion,
} from "../entities/news-source.js";
import type { NewsSourceCatalogEntry } from "../catalog/news-source-catalog.js";
import {
  type ArticleDeduplicationOptions,
  type ArticleMergeGroup,
  type ArticleTopicMatchingPreferences,
  deduplicateArticles,
} from "../services/index.js";
import {
  type ArticleExtractorPort,
  type LimitedPortOperationOptions,
  PortCancelledError,
  type PortError,
  type RssFeedReaderPort,
  type WebSearchPort,
  type WebSearchSourceScope,
} from "../ports/index.js";
import { err, ok } from "../types/result.js";
import type { UseCase } from "../types/usecase.js";
import type { UUID } from "../types/uuid.js";
import {
  aggregateRssFeedsUseCase,
  type AggregateRssFeedFailure,
} from "./rss-feed-aggregation-usecase.js";

export type HybridDiscoveryCoverage = "complete" | "partial";
export type HybridDiscoveryFailureStage = "rss" | "extraction" | "web_search";

export interface HybridDiscoveryFailure {
  readonly stage: HybridDiscoveryFailureStage;
  readonly errorType: PortError["type"];
  readonly sourceId?: UUID | undefined;
  readonly operationName?: string | undefined;
  readonly category?: string | undefined;
}

export interface HybridDiscoveryResult {
  readonly articles: readonly Article[];
  readonly evidence: readonly EvidenceFragment[];
  readonly articleMergeGroups: readonly ArticleMergeGroup[];
  readonly coverage: HybridDiscoveryCoverage;
  readonly failedSources: readonly HybridDiscoveryFailure[];
  readonly consultedUrls: readonly ArticleUrl[];
}

export interface DiscoverHybridEvidenceDependencies {
  readonly rssFeedReader: RssFeedReaderPort;
  readonly articleExtractor: ArticleExtractorPort;
  readonly webSearch: WebSearchPort;
}

export interface DiscoverHybridEvidencePayload {
  readonly sources: readonly NewsSourceCatalogEntry[];
  readonly query: string;
  readonly language?: NewsSource["language"] | undefined;
  readonly region?: NewsSourceRegion | undefined;
  readonly allowedDomains?: readonly string[] | undefined;
  readonly blockedDomains?: readonly string[] | undefined;
  readonly options?: LimitedPortOperationOptions | undefined;
  readonly deduplication?: ArticleDeduplicationOptions | undefined;
  readonly topicMatchingPreferences?: Partial<ArticleTopicMatchingPreferences> | undefined;
}

interface Candidate {
  readonly article: Article;
  readonly order: number;
}

const minimumArticleCount = 3;
const maximumArticleCount = 6;
const minimumSourceCount = 3;
const minimumOrientationCount = 2;
const maximumArticlesPerSource = 2;
const operationName = "discovery.hybrid";

const sourceScopesFrom = (
  sources: readonly NewsSourceCatalogEntry[],
): readonly WebSearchSourceScope[] => sources.flatMap((entry) =>
  entry.source.active &&
  entry.source.approvalStatus === "approved" &&
  entry.discovery.domains !== undefined &&
  entry.discovery.domains.length > 0
    ? [{ source: entry.source, domains: entry.discovery.domains }]
    : [],
);

const classifiedOrientation = (
  source: NewsSource | undefined,
): NewsSourceOrientation | undefined =>
  source?.orientation === undefined || source.orientation === "sin_clasificar"
    ? undefined
    : source.orientation;

const selectCandidates = (
  candidates: readonly Candidate[],
  sourcesById: ReadonlyMap<UUID, NewsSource>,
): readonly Article[] => {
  const selected: Article[] = [];
  const remaining = [...candidates];
  const selectedBySource = new Map<UUID, number>();
  const selectedSources = new Set<UUID>();
  const selectedOrientations = new Set<NewsSourceOrientation>();

  while (selected.length < maximumArticleCount) {
    const eligible = remaining
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) =>
        (selectedBySource.get(candidate.article.sourceId) ?? 0) < maximumArticlesPerSource,
      );

    if (eligible.length === 0) {
      break;
    }

    eligible.sort((left, right) => {
      const leftSource = sourcesById.get(left.candidate.article.sourceId);
      const rightSource = sourcesById.get(right.candidate.article.sourceId);
      const leftScore =
        (leftSource?.type === "media" ? 4 : 0) +
        (selectedSources.has(left.candidate.article.sourceId) ? 0 : 2) +
        (classifiedOrientation(leftSource) === undefined || selectedOrientations.has(classifiedOrientation(leftSource)!) ? 0 : 1);
      const rightScore =
        (rightSource?.type === "media" ? 4 : 0) +
        (selectedSources.has(right.candidate.article.sourceId) ? 0 : 2) +
        (classifiedOrientation(rightSource) === undefined || selectedOrientations.has(classifiedOrientation(rightSource)!) ? 0 : 1);

      return rightScore - leftScore || left.candidate.order - right.candidate.order;
    });

    const selectedCandidate = eligible[0]!;
    remaining.splice(selectedCandidate.index, 1);
    selected.push(selectedCandidate.candidate.article);
    selectedBySource.set(
      selectedCandidate.candidate.article.sourceId,
      (selectedBySource.get(selectedCandidate.candidate.article.sourceId) ?? 0) + 1,
    );
    selectedSources.add(selectedCandidate.candidate.article.sourceId);
    const orientation = classifiedOrientation(
      sourcesById.get(selectedCandidate.candidate.article.sourceId),
    );
    if (orientation !== undefined) {
      selectedOrientations.add(orientation);
    }
  }

  return selected;
};

const coverageFor = (
  articles: readonly Article[],
  sourcesById: ReadonlyMap<UUID, NewsSource>,
): HybridDiscoveryCoverage => {
  const sourceIds = new Set(
    articles
      .filter((article) => sourcesById.get(article.sourceId)?.type === "media")
      .map((article) => article.sourceId),
  );
  const orientations = new Set(
    [...sourceIds]
      .map((sourceId) => classifiedOrientation(sourcesById.get(sourceId)))
      .filter((orientation): orientation is NewsSourceOrientation => orientation !== undefined),
  );

  return articles.length >= minimumArticleCount &&
    sourceIds.size >= minimumSourceCount &&
    orientations.size >= minimumOrientationCount
    ? "complete"
    : "partial";
};

const failureFromRss = (failure: AggregateRssFeedFailure): HybridDiscoveryFailure => ({
  stage: "rss",
  sourceId: failure.sourceId,
  errorType: failure.errorType,
  ...(failure.operationName === undefined ? {} : { operationName: failure.operationName }),
  ...(failure.category === undefined ? {} : { category: failure.category }),
});

const failureFromPort = (
  stage: Exclude<HybridDiscoveryFailureStage, "rss">,
  error: PortError,
  sourceId?: UUID,
): HybridDiscoveryFailure => ({
  stage,
  errorType: error.type,
  ...(sourceId === undefined ? {} : { sourceId }),
  ...("operationName" in error ? { operationName: error.operationName } : {}),
  ...("category" in error ? { category: error.category } : {}),
});

const isCancelled = (error: PortError): error is PortCancelledError =>
  error.type === "PortCancelled";

const evidenceForArticles = (
  evidence: readonly EvidenceFragment[],
  articles: readonly Article[],
): readonly EvidenceFragment[] => {
  const articleIds = new Set(articles.map((article) => article.id));

  return evidence.filter((fragment) => articleIds.has(fragment.provenance.articleId));
};

export const discoverHybridEvidenceUseCase: UseCase<
  DiscoverHybridEvidenceDependencies,
  DiscoverHybridEvidencePayload,
  HybridDiscoveryResult,
  PortCancelledError
> = {
  execute: async ({ rssFeedReader, articleExtractor, webSearch }, payload) => {
    if (payload.options?.signal?.aborted) {
      return err(new PortCancelledError(operationName));
    }

    const rss = await aggregateRssFeedsUseCase.execute(
      { rssFeedReader },
      {
        sources: payload.sources,
        options: payload.options,
        deduplication: payload.deduplication,
        topicMatching: {
          query: payload.query,
          preferences: payload.topicMatchingPreferences,
        },
      },
    );

    if (!rss.ok) {
      return rss;
    }

    const sourcesById = new Map<UUID, NewsSource>(
      payload.sources.map((entry) => [entry.source.id, entry.source]),
    );
    const failures: HybridDiscoveryFailure[] = rss.value.failedFeeds.map(failureFromRss);
    const rssCandidates = rss.value.articles.map((article, order) => ({ article, order }));
    const initiallySelected = selectCandidates(rssCandidates, sourcesById);
    const extractedArticles: Article[] = [];
    let extractedEvidence: EvidenceFragment[] = [];

    for (const article of initiallySelected) {
      const fallbackEvidence = evidenceForArticles(rss.value.evidence, [article]);
      const extraction = await articleExtractor.extractArticle({
        article,
        fallbackEvidence,
        options: payload.options,
      });

      if (!extraction.ok) {
        if (isCancelled(extraction.error)) {
          return err(extraction.error);
        }

        failures.push(failureFromPort("extraction", extraction.error, article.sourceId));
        extractedArticles.push(article);
        extractedEvidence = [...extractedEvidence, ...fallbackEvidence];
        continue;
      }

      extractedArticles.push(extraction.value.article);
      extractedEvidence = [...extractedEvidence, ...extraction.value.evidence];
    }

    let combinedArticles = extractedArticles;
    let combinedEvidence = extractedEvidence;
    let consultedUrls: readonly ArticleUrl[] = [];
    let selected = selectCandidates(
      combinedArticles.map((article, order) => ({ article, order })),
      sourcesById,
    );

    if (coverageFor(selected, sourcesById) === "partial") {
      const sourceScopes = sourceScopesFrom(payload.sources);

      if (sourceScopes.length > 0) {
        const search = await webSearch.search({
          sourceScopes,
          query: payload.query,
          language: payload.language,
          region: payload.region,
          allowedDomains: payload.allowedDomains,
          blockedDomains: payload.blockedDomains,
          options: { ...payload.options, maxItems: maximumArticleCount },
        });

        if (!search.ok) {
          if (isCancelled(search.error)) {
            return err(search.error);
          }

          failures.push(failureFromPort("web_search", search.error));
        } else {
          consultedUrls = search.value.consultedUrls;
          for (const result of search.value.results) {
            sourcesById.set(result.source.id, result.source);
          }
          combinedArticles = [...combinedArticles, ...search.value.results.map((result) => result.article)];
          combinedEvidence = [...combinedEvidence, ...search.value.results.map((result) => result.evidence)];
        }
      }
    }

    const deduplicated = deduplicateArticles({
      articles: combinedArticles,
      evidence: combinedEvidence,
      trackingParameters: payload.deduplication?.trackingParameters,
    });
    selected = selectCandidates(
      deduplicated.articles.map((article, order) => ({ article, order })),
      sourcesById,
    );
    const selectedIds = new Set(selected.map((article) => article.id));

    return ok({
      articles: selected,
      evidence: evidenceForArticles(deduplicated.evidence, selected),
      articleMergeGroups: deduplicated.articleMergeGroups.filter((group) =>
        selectedIds.has(group.canonicalArticleId),
      ),
      coverage: coverageFor(selected, sourcesById),
      failedSources: failures,
      consultedUrls,
    });
  },
};
