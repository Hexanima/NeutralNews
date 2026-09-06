import type { Article, EvidenceFragment } from "../entities/article-evidence.js";

export interface ArticleTopicMatchingPreferences {
  readonly minimumScore: number;
  readonly maxCandidates: number;
}

export interface ArticleTopicCandidate {
  readonly article: Article;
  readonly score: number;
}

export interface FilterArticlesByTopicInput {
  readonly query: string;
  readonly articles: readonly Article[];
  readonly evidence: readonly EvidenceFragment[];
  readonly preferences?: Partial<ArticleTopicMatchingPreferences> | undefined;
}

export interface FilteredArticlesByTopicResult {
  readonly articles: readonly Article[];
  readonly evidence: readonly EvidenceFragment[];
  readonly candidates: readonly ArticleTopicCandidate[];
}

export const defaultArticleTopicMatchingPreferences: ArticleTopicMatchingPreferences = {
  minimumScore: 30,
  maxCandidates: 30,
};

const lowInformationTokens = new Set([
  "a", "al", "con", "de", "del", "el", "en", "la", "las", "lo", "los",
  "para", "por", "que", "se", "su", "sus", "un", "una", "y",
]);

export const normalizeTopicMatchText = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (value: string): readonly string[] =>
  normalizeTopicMatchText(value)
    .split(" ")
    .filter((token) => token !== "");

const significantTokens = (value: string): readonly string[] =>
  [...new Set(tokens(value).filter((token) => !lowInformationTokens.has(token)))];

const tokenSet = (value: string): ReadonlySet<string> => new Set(tokens(value));

const entityTokens = (query: string): ReadonlySet<string> =>
  new Set(
    query
      .split(/\s+/)
      .filter((token) => /^\p{Lu}/u.test(token))
      .map(normalizeTopicMatchText)
      .filter((token) => token !== "" && !lowInformationTokens.has(token)),
  );

const containsPhrase = (text: string, phrase: string): boolean =>
  phrase !== "" && ` ${normalizeTopicMatchText(text)} `.includes(` ${phrase} `);

const matchedCount = (terms: readonly string[], text: string): number => {
  const textTokens = tokenSet(text);
  return terms.filter((term) => textTokens.has(term)).length;
};

const normalizedPreferences = (
  value: Partial<ArticleTopicMatchingPreferences> | undefined,
): ArticleTopicMatchingPreferences => ({
  minimumScore: Math.min(
    100,
    Math.max(0, Math.floor(value?.minimumScore ?? defaultArticleTopicMatchingPreferences.minimumScore)),
  ),
  maxCandidates: Math.min(
    100,
    Math.max(1, Math.floor(value?.maxCandidates ?? defaultArticleTopicMatchingPreferences.maxCandidates)),
  ),
});

export const filterArticlesByTopic = ({
  query,
  articles,
  evidence,
  preferences,
}: FilterArticlesByTopicInput): FilteredArticlesByTopicResult => {
  const terms = significantTokens(query);

  if (terms.length === 0) {
    return { articles: [], evidence: [], candidates: [] };
  }

  const phrase = normalizeTopicMatchText(query);
  const entities = entityTokens(query);
  const settings = normalizedPreferences(preferences);
  const summariesByArticleId = new Map<string, EvidenceFragment[]>();

  for (const fragment of evidence) {
    if (fragment.provenance.contentKind !== "rss_summary") {
      continue;
    }

    const summaries = summariesByArticleId.get(fragment.provenance.articleId) ?? [];
    summaries.push(fragment);
    summariesByArticleId.set(fragment.provenance.articleId, summaries);
  }

  const candidates = articles.flatMap<ArticleTopicCandidate>((article) => {
    const summaries = summariesByArticleId.get(article.id) ?? [];
    const summaryText = summaries.map((summary) => summary.text).join(" ");
    const titleMatches = matchedCount(terms, article.title);
    const summaryMatches = matchedCount(terms, summaryText);
    const titlePhrase = containsPhrase(article.title, phrase);
    const summaryPhrase = containsPhrase(summaryText, phrase);
    const titleEntity = [...entities].some((entity) => tokenSet(article.title).has(entity));
    const summaryEntity = [...entities].some((entity) => tokenSet(summaryText).has(entity));
    const eligible = titlePhrase || summaryPhrase || titleEntity || summaryEntity || titleMatches + summaryMatches >= 2;

    if (!eligible) {
      return [];
    }

    const score = Math.min(
      100,
      titleMatches * 20 + summaryMatches * 10 + (titlePhrase ? 40 : 0) + (!titlePhrase && summaryPhrase ? 30 : 0) + (titleEntity ? 35 : 0) + (!titleEntity && summaryEntity ? 25 : 0),
    );

    return score >= settings.minimumScore ? [{ article, score }] : [];
  });

  const ordered = candidates
    .sort((left, right) => right.score - left.score || left.article.id.localeCompare(right.article.id))
    .slice(0, settings.maxCandidates);
  const articleIds = new Set(ordered.map((candidate) => candidate.article.id));

  return {
    articles: ordered.map((candidate) => candidate.article),
    evidence: evidence.filter(
      (fragment) =>
        fragment.provenance.contentKind === "rss_summary" &&
        articleIds.has(fragment.provenance.articleId),
    ),
    candidates: ordered,
  };
};