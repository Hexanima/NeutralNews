import type {
  Article,
  ArticleUrl,
  EvidenceFragment,
} from "../entities/article-evidence.js";
import type { IsoDateTimeString } from "../entities/news-source.js";
import type { UUID } from "../types/uuid.js";

export const defaultArticleTrackingParameters = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
] as const;

export interface ArticleDeduplicationOptions {
  readonly trackingParameters?: readonly string[] | undefined;
}

export interface ArticleMergeReference {
  readonly articleId: UUID;
  readonly sourceId: UUID;
  readonly url: ArticleUrl;
  readonly title: string;
  readonly publishedAt?: IsoDateTimeString | undefined;
}

export interface ArticleMergeGroup {
  readonly canonicalArticleId: UUID;
  readonly canonicalUrl: ArticleUrl;
  readonly references: readonly ArticleMergeReference[];
}

export interface DeduplicateArticlesInput extends ArticleDeduplicationOptions {
  readonly articles: readonly Article[];
  readonly evidence: readonly EvidenceFragment[];
}

export interface DeduplicatedArticlesResult {
  readonly articles: readonly Article[];
  readonly evidence: readonly EvidenceFragment[];
  readonly articleMergeGroups: readonly ArticleMergeGroup[];
}

interface ArticleCandidate {
  readonly article: Article;
  readonly canonicalUrl: ArticleUrl;
  readonly normalizedTitle: string;
}

interface ArticleGroup {
  readonly canonicalArticle: Article;
  readonly canonicalUrl: ArticleUrl;
  readonly canonicalTitle: string;
  readonly canonicalPublishedAt?: IsoDateTimeString | undefined;
  readonly canonicalUrls: Set<ArticleUrl>;
  readonly references: ArticleMergeReference[];
}

const strongTitleSimilarityThreshold = 0.92;
const compatibleDateWindowMs = 48 * 60 * 60 * 1000;
const contradictorTokens = new Set(["no", "nunca", "jamas", "sin", "ni"]);

const configuredTrackingParameters = (
  trackingParameters: readonly string[] | undefined,
): Set<string> =>
  new Set(
    (trackingParameters ?? defaultArticleTrackingParameters)
      .map((parameter) => parameter.trim().toLowerCase())
      .filter((parameter) => parameter !== ""),
  );

export const canonicalizeArticleUrl = (
  articleUrl: ArticleUrl,
  options: ArticleDeduplicationOptions = {},
): ArticleUrl => {
  const url = new URL(articleUrl);
  const trackingParameters = configuredTrackingParameters(
    options.trackingParameters,
  );

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  for (const parameter of Array.from(url.searchParams.keys())) {
    if (trackingParameters.has(parameter.toLowerCase())) {
      url.searchParams.delete(parameter);
    }
  }

  url.searchParams.sort();

  return url.toString() as ArticleUrl;
};

export const normalizeArticleTitle = (title: string): string =>
  title
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const lowInformationTitleTokens = new Set([
  "a",
  "de",
  "del",
  "el",
  "en",
  "la",
  "las",
  "los",
  "un",
  "una",
]);

const titleTokens = (normalizedTitle: string): readonly string[] =>
  normalizedTitle
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token !== "");

const significantTitleTokens = (normalizedTitle: string): readonly string[] =>
  titleTokens(normalizedTitle).filter(
    (token) => !lowInformationTitleTokens.has(token),
  );

const orderedTokenBigrams = (tokens: readonly string[]): readonly string[] => {
  const bigrams: string[] = [];

  for (let index = 0; index < tokens.length - 1; index += 1) {
    bigrams.push(`${tokens[index]} ${tokens[index + 1]}`);
  }

  return bigrams;
};

const orderedBigramDiceSimilarity = (left: string, right: string): number => {
  const leftBigrams = orderedTokenBigrams(significantTitleTokens(left));
  const rightBigrams = orderedTokenBigrams(significantTitleTokens(right));

  if (leftBigrams.length === 0 || rightBigrams.length === 0) {
    return 0;
  }

  const remainingRightBigrams = new Map<string, number>();

  for (const bigram of rightBigrams) {
    remainingRightBigrams.set(
      bigram,
      (remainingRightBigrams.get(bigram) ?? 0) + 1,
    );
  }

  let intersectionSize = 0;

  for (const bigram of leftBigrams) {
    const remainingCount = remainingRightBigrams.get(bigram) ?? 0;

    if (remainingCount === 0) {
      continue;
    }

    intersectionSize += 1;
    remainingRightBigrams.set(bigram, remainingCount - 1);
  }

  return (2 * intersectionSize) / (leftBigrams.length + rightBigrams.length);
};

const removeContradictorTokens = (normalizedTitle: string): string =>
  normalizedTitle
    .split(" ")
    .filter((token) => !contradictorTokens.has(token))
    .join(" ");

const hasContradictorToken = (normalizedTitle: string): boolean =>
  normalizedTitle
    .split(" ")
    .some((token) => contradictorTokens.has(token));

const hasContradictorMismatch = (left: string, right: string): boolean => {
  if (hasContradictorToken(left) === hasContradictorToken(right)) {
    return false;
  }

  return (
    orderedBigramDiceSimilarity(
      removeContradictorTokens(left),
      removeContradictorTokens(right),
    ) >= strongTitleSimilarityThreshold
  );
};

const datesAreCompatible = (
  left: IsoDateTimeString | undefined,
  right: IsoDateTimeString | undefined,
): boolean => {
  if (left === undefined || right === undefined) {
    return false;
  }

  return Math.abs(Date.parse(left) - Date.parse(right)) <= compatibleDateWindowMs;
};

const titlesMatchForDeduplication = (
  left: ArticleCandidate,
  right: ArticleGroup,
): boolean => {
  const exactTitleMatch = left.normalizedTitle === right.canonicalTitle;

  if (left.article.publishedAt === undefined || right.canonicalPublishedAt === undefined) {
    return exactTitleMatch;
  }

  if (!datesAreCompatible(left.article.publishedAt, right.canonicalPublishedAt)) {
    return false;
  }

  if (hasContradictorMismatch(left.normalizedTitle, right.canonicalTitle)) {
    return false;
  }

  return (
    exactTitleMatch ||
    orderedBigramDiceSimilarity(left.normalizedTitle, right.canonicalTitle) >=
      strongTitleSimilarityThreshold
  );
};

const toMergeReference = (article: Article): ArticleMergeReference => ({
  articleId: article.id,
  sourceId: article.sourceId,
  url: article.url,
  title: article.title,
  publishedAt: article.publishedAt,
});

const createGroup = (candidate: ArticleCandidate): ArticleGroup => ({
  canonicalArticle: {
    ...candidate.article,
    url: candidate.canonicalUrl,
  },
  canonicalUrl: candidate.canonicalUrl,
  canonicalTitle: candidate.normalizedTitle,
  canonicalPublishedAt: candidate.article.publishedAt,
  canonicalUrls: new Set([candidate.canonicalUrl]),
  references: [toMergeReference(candidate.article)],
});

const articleMatchesGroup = (
  candidate: ArticleCandidate,
  group: ArticleGroup,
): boolean =>
  group.canonicalUrls.has(candidate.canonicalUrl) ||
  titlesMatchForDeduplication(candidate, group);

export const deduplicateArticles = ({
  articles,
  evidence,
  trackingParameters,
}: DeduplicateArticlesInput): DeduplicatedArticlesResult => {
  const groups: ArticleGroup[] = [];
  const canonicalUrlByArticleId = new Map<UUID, ArticleUrl>();
  const canonicalArticleIdByArticleId = new Map<UUID, UUID>();

  for (const article of articles) {
    const candidate: ArticleCandidate = {
      article,
      canonicalUrl: canonicalizeArticleUrl(article.url, { trackingParameters }),
      normalizedTitle: normalizeArticleTitle(article.title),
    };
    const matchingGroup = groups.find((group) =>
      articleMatchesGroup(candidate, group),
    );

    canonicalUrlByArticleId.set(article.id, candidate.canonicalUrl);

    if (matchingGroup === undefined) {
      groups.push(createGroup(candidate));
      canonicalArticleIdByArticleId.set(article.id, article.id);
      continue;
    }

    canonicalArticleIdByArticleId.set(
      article.id,
      matchingGroup.canonicalArticle.id,
    );
    matchingGroup.canonicalUrls.add(candidate.canonicalUrl);
    matchingGroup.references.push(toMergeReference(article));
  }

  return {
    articles: groups.map((group) => group.canonicalArticle),
    evidence: evidence.map((fragment) => ({
      ...fragment,
      provenance: {
        ...fragment.provenance,
        articleId:
          canonicalArticleIdByArticleId.get(fragment.provenance.articleId) ??
          fragment.provenance.articleId,
        url:
          canonicalUrlByArticleId.get(fragment.provenance.articleId) ??
          canonicalizeArticleUrl(fragment.provenance.url, { trackingParameters }),
      },
    })),
    articleMergeGroups: groups
      .filter((group) => group.references.length > 1)
      .map((group) => ({
        canonicalArticleId: group.canonicalArticle.id,
        canonicalUrl: group.canonicalUrl,
        references: group.references,
      })),
  };
};
