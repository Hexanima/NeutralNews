import {
  type Article,
  type ArticleUrl,
  type EvidenceFragment,
  type IsoDateTimeString,
  type LanguageCode,
  type UUID,
} from "../index.js";
import { describe, expect, it } from "vitest";

import {
  canonicalizeArticleUrl,
  deduplicateArticles,
  normalizeArticleTitle,
} from "./article-deduplication.js";

const sourceId = "11111111-1111-4111-8111-111111111111" as UUID;
const otherSourceId = "11111111-1111-4111-8111-111111111112" as UUID;
const language = "es-ar" as LanguageCode;
const publishedAt = "2026-08-20T13:30:00.000Z" as IsoDateTimeString;

const createArticle = (
  suffix: string,
  input: Partial<Article> = {},
): Article => ({
  id: `22222222-2222-4222-8222-22222222222${suffix}` as UUID,
  sourceId,
  url: `https://example.com/politica/articulo-${suffix}` as ArticleUrl,
  title: `Articulo ${suffix}`,
  language,
  publishedAt,
  ...input,
});

const createEvidence = (
  suffix: string,
  article: Article,
): EvidenceFragment => ({
  id: `33333333-3333-4333-8333-33333333333${suffix}` as UUID,
  text: `Resumen ${suffix}`,
  provenance: {
    articleId: article.id,
    sourceId: article.sourceId,
    url: article.url,
    contentKind: "rss_summary",
  },
  quality: { contentLevel: "partial" },
});

describe("article deduplication", () => {
  it("removes configurable tracking parameters case-insensitively", () => {
    expect(
      canonicalizeArticleUrl(
        "HTTPS://Example.com:443/politica/nota?utm_source=rss&id=42&FBCLID=abc&utm_campaign=fall#comments" as ArticleUrl,
        { trackingParameters: ["utm_source", "fbclid", "utm_campaign"] },
      ),
    ).toBe("https://example.com/politica/nota?id=42");
  });

  it("keeps non-tracking query parameters sorted while normalizing the URL", () => {
    expect(
      canonicalizeArticleUrl(
        "http://Example.com:80/politica/nota?z=2&a=1#fragment" as ArticleUrl,
        { trackingParameters: [] },
      ),
    ).toBe("http://example.com/politica/nota?a=1&z=2");
  });

  it("normalizes titles for strong deterministic comparison", () => {
    expect(normalizeArticleTitle("  La Nacion: REFORMA politica, hoy  ")).toBe(
      "la nacion reforma politica hoy",
    );
  });

  it("deduplicates articles by canonical URL and preserves merged references", () => {
    const original = createArticle("1", {
      url: "https://example.com/politica/reforma?utm_source=rss" as ArticleUrl,
      title: "Congreso debate una reforma presupuestaria",
    });
    const duplicate = createArticle("2", {
      sourceId: otherSourceId,
      url: "https://example.com/politica/reforma" as ArticleUrl,
      title: "Congreso debate una reforma presupuestaria",
    });

    const result = deduplicateArticles({
      articles: [original, duplicate],
      evidence: [createEvidence("1", original), createEvidence("2", duplicate)],
      trackingParameters: ["utm_source"],
    });

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]).toMatchObject({
      id: original.id,
      url: "https://example.com/politica/reforma",
    });
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence.map((evidence) => evidence.provenance)).toEqual([
      {
        articleId: original.id,
        sourceId: original.sourceId,
        url: "https://example.com/politica/reforma",
        contentKind: "rss_summary",
      },
      {
        articleId: original.id,
        sourceId: duplicate.sourceId,
        url: "https://example.com/politica/reforma",
        contentKind: "rss_summary",
      },
    ]);
    expect(result.articleMergeGroups).toEqual([
      {
        canonicalArticleId: original.id,
        canonicalUrl: "https://example.com/politica/reforma",
        references: [
          {
            articleId: original.id,
            sourceId: original.sourceId,
            url: original.url,
            title: original.title,
            publishedAt: original.publishedAt,
          },
          {
            articleId: duplicate.id,
            sourceId: duplicate.sourceId,
            url: duplicate.url,
            title: duplicate.title,
            publishedAt: duplicate.publishedAt,
          },
        ],
      },
    ]);
  });

  it("deduplicates articles with strongly similar titles and compatible dates", () => {
    const first = createArticle("1", {
      url: "https://medio-a.example/politica/reforma" as ArticleUrl,
      title: "Gobierno anuncia reforma electoral en el Congreso",
      publishedAt: "2026-08-20T10:00:00.000Z" as IsoDateTimeString,
    });
    const second = createArticle("2", {
      sourceId: otherSourceId,
      url: "https://medio-b.example/notas/reforma-electoral" as ArticleUrl,
      title: "Gobierno anuncia reforma electoral en Congreso",
      publishedAt: "2026-08-21T09:00:00.000Z" as IsoDateTimeString,
    });

    const result = deduplicateArticles({
      articles: [first, second],
      evidence: [],
    });

    expect(result.articles).toHaveLength(1);
    expect(result.articleMergeGroups[0]?.references).toHaveLength(2);
  });

  it("does not merge different articles that only share political actors", () => {
    const first = createArticle("1", {
      url: "https://medio-a.example/politica/presupuesto" as ArticleUrl,
      title: "Milei se reune con gobernadores por el presupuesto",
      publishedAt: "2026-08-20T10:00:00.000Z" as IsoDateTimeString,
    });
    const second = createArticle("2", {
      sourceId: otherSourceId,
      url: "https://medio-b.example/politica/decreto" as ArticleUrl,
      title: "Milei firma un decreto sobre seguridad fronteriza",
      publishedAt: "2026-08-20T11:00:00.000Z" as IsoDateTimeString,
    });

    const result = deduplicateArticles({
      articles: [first, second],
      evidence: [],
    });

    expect(result.articles).toHaveLength(2);
    expect(result.articleMergeGroups).toEqual([]);
  });

  it("does not merge strongly similar titles when only one contains a negation", () => {
    const first = createArticle("1", {
      url: "https://medio-a.example/politica/veto-jubilaciones" as ArticleUrl,
      title: "Milei veta la ley de jubilaciones",
      publishedAt: "2026-08-20T10:00:00.000Z" as IsoDateTimeString,
    });
    const second = createArticle("2", {
      sourceId: otherSourceId,
      url: "https://medio-b.example/politica/veto-jubilaciones" as ArticleUrl,
      title: "Milei no veta la ley de jubilaciones",
      publishedAt: "2026-08-20T11:00:00.000Z" as IsoDateTimeString,
    });

    const result = deduplicateArticles({
      articles: [first, second],
      evidence: [],
    });

    expect(result.articles).toHaveLength(2);
    expect(result.articleMergeGroups).toEqual([]);
  });

  it("does not merge strongly similar titles when only one contains a contradictor token", () => {
    const first = createArticle("1", {
      url: "https://medio-a.example/politica/acuerdo" as ArticleUrl,
      title: "Gobernadores llegan a un acuerdo con el Gobierno",
      publishedAt: "2026-08-20T10:00:00.000Z" as IsoDateTimeString,
    });
    const second = createArticle("2", {
      sourceId: otherSourceId,
      url: "https://medio-b.example/politica/acuerdo" as ArticleUrl,
      title: "Gobernadores nunca llegan a un acuerdo con el Gobierno",
      publishedAt: "2026-08-20T11:00:00.000Z" as IsoDateTimeString,
    });

    const result = deduplicateArticles({
      articles: [first, second],
      evidence: [],
    });

    expect(result.articles).toHaveLength(2);
    expect(result.articleMergeGroups).toEqual([]);
  });

  it("requires exact normalized title similarity when one date is missing", () => {
    const first = createArticle("1", {
      url: "https://medio-a.example/politica/reforma" as ArticleUrl,
      title: "Gobierno anuncia reforma electoral en Congreso",
      publishedAt: undefined,
    });
    const similar = createArticle("2", {
      sourceId: otherSourceId,
      url: "https://medio-b.example/notas/reforma-electoral" as ArticleUrl,
      title: "Gobierno anuncia reforma electoral en el Congreso",
      publishedAt,
    });
    const exact = createArticle("3", {
      sourceId: otherSourceId,
      url: "https://medio-c.example/notas/reforma-electoral" as ArticleUrl,
      title: "Gobierno anuncia reforma electoral en Congreso",
      publishedAt,
    });

    const result = deduplicateArticles({
      articles: [first, similar, exact],
      evidence: [],
    });

    expect(result.articles.map((article) => article.id)).toEqual([
      first.id,
      similar.id,
    ]);
    expect(result.articleMergeGroups).toHaveLength(1);
    expect(result.articleMergeGroups[0]?.references.map((reference) => reference.articleId))
      .toEqual([first.id, exact.id]);
  });

  it("does not merge exact title matches outside the compatible date window", () => {
    const first = createArticle("1", {
      url: "https://medio-a.example/politica/reforma" as ArticleUrl,
      title: "Gobierno anuncia reforma electoral en Congreso",
      publishedAt: "2026-08-20T10:00:00.000Z" as IsoDateTimeString,
    });
    const second = createArticle("2", {
      sourceId: otherSourceId,
      url: "https://medio-b.example/notas/reforma-electoral" as ArticleUrl,
      title: "Gobierno anuncia reforma electoral en Congreso",
      publishedAt: "2026-08-25T10:00:00.000Z" as IsoDateTimeString,
    });

    const result = deduplicateArticles({
      articles: [first, second],
      evidence: [],
    });

    expect(result.articles).toHaveLength(2);
    expect(result.articleMergeGroups).toEqual([]);
  });
});
