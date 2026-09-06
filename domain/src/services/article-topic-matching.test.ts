import { describe, expect, it } from "vitest";

import { filterArticlesByTopic, normalizeTopicMatchText } from "./article-topic-matching.js";

describe("article topic matching", () => {
  it("normalizes case, accents and punctuation", () => {
    expect(normalizeTopicMatchText("  MILEÍ: reforma—laboral!  ")).toBe(
      "milei reforma laboral",
    );
  });
});

describe("article topic matching phrases", () => {
  it("keeps stop words in an exact headline phrase", () => {
    const article = {
      id: "22222222-2222-4222-8222-222222222221",
      sourceId: "11111111-1111-4111-8111-111111111111",
      url: "https://example.com/ley-de-medios",
      title: "El Congreso debate la Ley de Medios",
      language: "es-ar",
    } as never;

    const result = filterArticlesByTopic({
      query: "Ley de Medios",
      articles: [article],
      evidence: [],
    });

    expect(result.articles).toEqual([article]);
    expect(result.candidates[0]?.score).toBeGreaterThanOrEqual(80);
  });
});
describe("article topic matching selection", () => {
  const article = (id: string, title: string) => ({
    id,
    sourceId: "11111111-1111-4111-8111-111111111111",
    url: `https://example.com/${id}`,
    title,
    language: "es-ar",
  }) as never;

  it("matches a named entity in the headline", () => {
    const match = article("22222222-2222-4222-8222-222222222221", "Javier Milei recibe a gobernadores");
    const other = article("22222222-2222-4222-8222-222222222222", "El Gobierno prepara anuncios");

    expect(filterArticlesByTopic({ query: "Javier Milei", articles: [other, match], evidence: [] }).articles)
      .toEqual([match]);
  });

  it("rejects a token substring and a single generic token", () => {
    const substring = article("22222222-2222-4222-8222-222222222221", "La milenaria tradición sigue vigente");
    const generic = article("22222222-2222-4222-8222-222222222222", "Reforma administrativa sin novedades");

    expect(filterArticlesByTopic({ query: "Milei anuncia", articles: [substring], evidence: [] }).articles).toEqual([]);
    expect(filterArticlesByTopic({ query: "reforma laboral", articles: [generic], evidence: [] }).articles).toEqual([]);
  });

  it("orders equal scores by id and enforces limit and threshold", () => {
    const first = article("22222222-2222-4222-8222-222222222221", "Reforma laboral: debate en el Congreso");
    const second = article("22222222-2222-4222-8222-222222222222", "Reforma laboral: debate en el Senado");

    expect(filterArticlesByTopic({
      query: "reforma laboral",
      articles: [second, first],
      evidence: [],
      preferences: { minimumScore: 80, maxCandidates: 1 },
    }).articles).toEqual([first]);
    expect(filterArticlesByTopic({
      query: "reforma laboral",
      articles: [first],
      evidence: [],
      preferences: { minimumScore: 81, maxCandidates: 1 },
    }).articles).toEqual([]);
  });
});
describe("article topic matching entity detection", () => {
  it("does not treat an initial capitalized common word as an entity", () => {
    const article = {
      id: "22222222-2222-4222-8222-222222222221",
      sourceId: "11111111-1111-4111-8111-111111111111",
      url: "https://example.com/reforma-educativa",
      title: "Reforma educativa",
      language: "es-ar",
    } as never;

    expect(
      filterArticlesByTopic({
        query: "Reforma laboral",
        articles: [article],
        evidence: [],
      }).articles,
    ).toEqual([]);
  });
});

describe("article topic matching false-positive regressions", () => {
  const article = (id: string, title: string) => ({
    id,
    sourceId: "11111111-1111-4111-8111-111111111111",
    url: `https://example.com/${id}`,
    title,
    language: "es-ar",
  }) as never;

  it("does not count the same query term in title and summary twice", () => {
    const candidate = article("22222222-2222-4222-8222-222222222221", "Reforma administrativa");
    const summary = {
      id: "33333333-3333-4333-8333-333333333331",
      text: "La reforma fue anunciada",
      provenance: { articleId: candidate.id, sourceId: candidate.sourceId, url: candidate.url, contentKind: "rss_summary" },
      quality: { contentLevel: "partial" },
    } as never;

    expect(filterArticlesByTopic({ query: "reforma laboral", articles: [candidate], evidence: [summary] }).articles)
      .toEqual([]);
  });

  it("does not turn title-cased query terms into standalone entities", () => {
    const candidate = article("22222222-2222-4222-8222-222222222221", "Laboral: nuevas medidas");

    expect(filterArticlesByTopic({ query: "Reforma Laboral", articles: [candidate], evidence: [] }).articles)
      .toEqual([]);
  });
});
