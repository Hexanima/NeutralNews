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
  type ArticleMergeReference,
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
  type WebSearchExtractionFailure,
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
export type HybridDiscoveryFailureType = PortError["type"] | "PartialExtraction";

export interface HybridDiscoveryFailure {
  readonly stage: HybridDiscoveryFailureStage;
  readonly errorType: HybridDiscoveryFailureType;
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
  const selectedMediaSources = new Set<UUID>();
  const availableMediaSourceCount = new Set(
    candidates.flatMap(({ article }) =>
      sourcesById.get(article.sourceId)?.type === "media" ? [article.sourceId] : []
    ),
  ).size;
  const requiredMediaSourceCount = Math.min(
    minimumSourceCount,
    availableMediaSourceCount,
  );

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
      const scoreFor = (input: { readonly candidate: Candidate }): number => {
        const source = sourcesById.get(input.candidate.article.sourceId);
        const sourceId = input.candidate.article.sourceId;
        const orientation = classifiedOrientation(source);
        const mediaScore = source?.type === "media" &&
            !selectedMediaSources.has(sourceId) &&
            selectedMediaSources.size < requiredMediaSourceCount
          ? 4
          : 0;
        const sourceScore = selectedSources.has(sourceId) ? 0 : 2;
        const orientationScore = orientation === undefined || selectedOrientations.has(orientation)
          ? 0
          : 1;

        return mediaScore + sourceScore + orientationScore;
      };
      const leftScore = scoreFor(left);
      const rightScore = scoreFor(right);

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
    if (sourcesById.get(selectedCandidate.candidate.article.sourceId)?.type === "media") {
      selectedMediaSources.add(selectedCandidate.candidate.article.sourceId);
    }
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
  const availableSources = [...sourcesById.values()].filter(
    (source) => source.active && source.approvalStatus === "approved",
  );
  const requiredSourceCount = Math.min(
    minimumSourceCount,
    new Set(
      availableSources
        .filter((source) => source.type === "media")
        .map((source) => source.id),
    ).size,
  );
  const requiredOrientationCount = Math.min(
    minimumOrientationCount,
    new Set(
      availableSources
        .map(classifiedOrientation)
        .filter((orientation): orientation is NewsSourceOrientation => orientation !== undefined),
    ).size,
  );
  const mediaSourceIds = new Set(
    articles
      .filter((article) => sourcesById.get(article.sourceId)?.type === "media")
      .map((article) => article.sourceId),
  );
  const selectedSourceIds = new Set(articles.map((article) => article.sourceId));
  const orientations = new Set(
    [...selectedSourceIds]
      .map((sourceId) => classifiedOrientation(sourcesById.get(sourceId)))
      .filter((orientation): orientation is NewsSourceOrientation => orientation !== undefined),
  );

  return articles.length >= minimumArticleCount &&
    mediaSourceIds.size >= requiredSourceCount &&
    orientations.size >= requiredOrientationCount
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

const partialExtractionFailure = (sourceId: UUID): HybridDiscoveryFailure => ({
  stage: "extraction",
  sourceId,
  errorType: "PartialExtraction",
});

const failureFromWebExtraction = (
  failure: WebSearchExtractionFailure,
): HybridDiscoveryFailure => failure.kind === "partial"
  ? partialExtractionFailure(failure.sourceId)
  : failureFromPort("extraction", failure.error, failure.sourceId);

const isCancelled = (error: PortError): error is PortCancelledError =>
  error.type === "PortCancelled";

const combineArticleMergeGroups = (input: {
  readonly rssGroups: readonly ArticleMergeGroup[];
  readonly deduplicatedGroups: readonly ArticleMergeGroup[];
}): readonly ArticleMergeGroup[] => {
  const canonicalIdByArticleId = new Map<UUID, UUID>();
  const canonicalUrlByArticleId = new Map<UUID, ArticleUrl>();

  for (const group of input.deduplicatedGroups) {
    canonicalUrlByArticleId.set(group.canonicalArticleId, group.canonicalUrl);
    for (const reference of group.references) {
      canonicalIdByArticleId.set(reference.articleId, group.canonicalArticleId);
    }
  }

  const groupsByCanonicalId = new Map<
    UUID,
    { canonicalUrl: ArticleUrl; referencesByArticleId: Map<UUID, ArticleMergeReference> }
  >();

  for (const group of [...input.rssGroups, ...input.deduplicatedGroups]) {
    const canonicalArticleId =
      canonicalIdByArticleId.get(group.canonicalArticleId) ?? group.canonicalArticleId;
    const existing = groupsByCanonicalId.get(canonicalArticleId);
    const referencesByArticleId = existing?.referencesByArticleId ?? new Map<
      UUID,
      ArticleMergeReference
    >();

    for (const reference of group.references) {
      referencesByArticleId.set(reference.articleId, reference);
    }

    groupsByCanonicalId.set(canonicalArticleId, {
      canonicalUrl:
        canonicalUrlByArticleId.get(canonicalArticleId) ??
        existing?.canonicalUrl ??
        group.canonicalUrl,
      referencesByArticleId,
    });
  }

  return [...groupsByCanonicalId].flatMap(([canonicalArticleId, group]) =>
    group.referencesByArticleId.size > 1
      ? [{
          canonicalArticleId,
          canonicalUrl: group.canonicalUrl,
          references: [...group.referencesByArticleId.values()],
        }]
      : [],
  );
};

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

    const approvedSources = payload.sources.filter(
      ({ source }) => source.active && source.approvalStatus === "approved",
    );

    const rss = await aggregateRssFeedsUseCase.execute(
      { rssFeedReader },
      {
        sources: approvedSources,
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

      if (extraction.value.extractionStatus === "partial") {
        failures.push(partialExtractionFailure(article.sourceId));
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
          failures.push(
            ...(search.value.failedExtractions ?? []).map(failureFromWebExtraction),
          );
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
    const articleMergeGroups = combineArticleMergeGroups({
      rssGroups: rss.value.articleMergeGroups,
      deduplicatedGroups: deduplicated.articleMergeGroups,
    });

    return ok({
      articles: selected,
      evidence: evidenceForArticles(deduplicated.evidence, selected),
      articleMergeGroups: articleMergeGroups.filter((group) => selectedIds.has(group.canonicalArticleId)),
      coverage: coverageFor(selected, sourcesById),
      failedSources: failures,
      consultedUrls,
    });
  },
};
