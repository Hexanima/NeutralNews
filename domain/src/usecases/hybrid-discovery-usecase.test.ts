import {
  createFakeArticleExtractorPort,
  createFakeRssFeedReaderPort,
  createFakeWebSearchPort,
  err,
  ExternalPortError,
  isErr,
  isOk,
  ok,
  type Article,
  type ArticleUrl,
  type CountryCode,
  type EvidenceFragment,
  type IsoDateTimeString,
  type LanguageCode,
  type NewsSource,
  type NewsSourceCatalogEntry,
  type UUID,
} from "../index.js";
import { describe, expect, it } from "vitest";

import { discoverHybridEvidenceUseCase } from "./hybrid-discovery-usecase.js";

const reviewedAt = "2026-09-06T00:00:00.000Z" as IsoDateTimeString;

const createSource = (suffix: string, orientation: NewsSource["orientation"]): NewsSource => ({
  id: `11111111-1111-4111-8111-11111111111${suffix}` as UUID,
  name: `Medio ${suffix}`,
  orientation,
  type: "media",
  region: "argentina",
  country: "AR" as CountryCode,
  language: "es-ar" as LanguageCode,
  active: true,
  approvalStatus: "approved",
  reviewedAt,
});

const createEntry = (
  suffix: string,
  orientation: NewsSource["orientation"],
): NewsSourceCatalogEntry => ({
  source: createSource(suffix, orientation),
  discovery: {
    mode: "rss",
    feedUrl: `https://medio-${suffix}.example/feed.xml` as ArticleUrl,
    domains: [`medio-${suffix}.example`],
  },
});

const createArticle = (suffix: string, sourceId: UUID): Article => ({
  id: `22222222-2222-4222-8222-22222222222${suffix}` as UUID,
  sourceId,
  url: `https://medio-${suffix}.example/reforma-laboral-${suffix}` as ArticleUrl,
  title: `Reforma laboral ${suffix}`,
  language: "es-ar" as LanguageCode,
  publishedAt: reviewedAt,
});

const createEvidence = (suffix: string, article: Article): EvidenceFragment => ({
  id: `33333333-3333-4333-8333-33333333333${suffix}` as UUID,
  text: `Resumen de reforma laboral ${suffix}`,
  provenance: {
    articleId: article.id,
    sourceId: article.sourceId,
    url: article.url,
    contentKind: "rss_summary",
  },
  quality: { contentLevel: "partial" },
});

describe("hybrid discovery use case", () => {
  it("uses sufficient RSS coverage without calling web search", async () => {
    const entries = [
      createEntry("1", "izquierda"),
      createEntry("2", "centro"),
      createEntry("3", "derecha"),
    ];
    const articles = entries.map((entry, index) =>
      createArticle(String(index + 1), entry.source.id),
    );
    const evidence = articles.map((article, index) =>
      createEvidence(String(index + 1), article),
    );
    const rssFeedReader = createFakeRssFeedReaderPort();
    rssFeedReader.readFeed = async (input) => {
      const index = entries.findIndex((entry) => entry.source.id === input.source.id);
      return ok({
        sourceId: input.source.id,
        feedUrl: input.feedUrl,
        articles: [articles[index]!],
        evidence: [evidence[index]!],
      });
    };
    const articleExtractor = createFakeArticleExtractorPort();
    const webSearch = createFakeWebSearchPort();

    const result = await discoverHybridEvidenceUseCase.execute(
      { rssFeedReader, articleExtractor, webSearch },
      { sources: entries, query: "reforma laboral" },
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.coverage).toBe("complete");
      expect(result.value.articles).toHaveLength(3);
    }
    expect(articleExtractor.calls.extractArticle).toHaveLength(3);
    expect(webSearch.calls.search).toEqual([]);
  });

  it("preserves merge groups created during RSS aggregation", async () => {
    const entries = [
      createEntry("1", "izquierda"),
      createEntry("2", "centro"),
      createEntry("3", "derecha"),
    ];
    const original = {
      ...createArticle("1", entries[0]!.source.id),
      url: "https://shared.example/reforma-laboral" as ArticleUrl,
    };
    const duplicate = {
      ...createArticle("2", entries[1]!.source.id),
      url: original.url,
      title: original.title,
    };
    const thirdArticle = createArticle("3", entries[2]!.source.id);
    const articlesBySourceId = new Map([
      [original.sourceId, original],
      [duplicate.sourceId, duplicate],
      [thirdArticle.sourceId, thirdArticle],
    ]);
    const rssFeedReader = createFakeRssFeedReaderPort();
    rssFeedReader.readFeed = async (input) => {
      const article = articlesBySourceId.get(input.source.id)!;

      return ok({
        sourceId: input.source.id,
        feedUrl: input.feedUrl,
        articles: [article],
        evidence: [createEvidence(input.source.id, article)],
      });
    };

    const result = await discoverHybridEvidenceUseCase.execute(
      {
        rssFeedReader,
        articleExtractor: createFakeArticleExtractorPort(),
        webSearch: createFakeWebSearchPort(),
      },
      { sources: entries, query: "reforma laboral" },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        articleMergeGroups: [
          {
            canonicalArticleId: original.id,
            references: expect.arrayContaining([
              expect.objectContaining({ articleId: original.id }),
              expect.objectContaining({ articleId: duplicate.id }),
            ]),
          },
        ],
      },
    });
  });

  it("uses configured web sources to complete insufficient RSS coverage", async () => {
    const entries = [
      createEntry("1", "izquierda"),
      createEntry("2", "centro"),
      createEntry("3", "derecha"),
    ];
    const rssArticle = createArticle("1", entries[0]!.source.id);
    const rssEvidence = createEvidence("1", rssArticle);
    const webArticles = entries.slice(1).map((entry, index) =>
      createArticle(String(index + 2), entry.source.id),
    );
    const webResults = webArticles.map((article, index) => ({
      source: entries[index + 1]!.source,
      article,
      evidence: {
        ...createEvidence(String(index + 2), article),
        provenance: {
          articleId: article.id,
          sourceId: article.sourceId,
          url: article.url,
          contentKind: "extracted_body" as const,
          discoveryKind: "web_search" as const,
        },
        quality: { contentLevel: "complete" as const },
      },
    }));
    const rssFeedReader = createFakeRssFeedReaderPort();
    rssFeedReader.readFeed = async (input) => input.source.id === entries[0]!.source.id
      ? ok({
        sourceId: input.source.id,
        feedUrl: input.feedUrl,
        articles: [rssArticle],
        evidence: [rssEvidence],
      })
      : ok({ sourceId: input.source.id, feedUrl: input.feedUrl, articles: [], evidence: [] });
    const articleExtractor = createFakeArticleExtractorPort();
    const webSearch = createFakeWebSearchPort({
      results: webResults,
      consultedUrls: webArticles.map((article) => article.url),
    });

    const result = await discoverHybridEvidenceUseCase.execute(
      { rssFeedReader, articleExtractor, webSearch },
      { sources: entries, query: "reforma laboral" },
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.coverage).toBe("complete");
      expect(result.value.articles).toHaveLength(3);
      expect(new Set(result.value.articles.map((article) => article.sourceId)).size).toBe(3);
      expect(result.value.consultedUrls).toEqual(webArticles.map((article) => article.url));
    }
    expect(webSearch.calls.search).toHaveLength(1);
    expect(webSearch.calls.search[0]?.sourceScopes.map((scope) => scope.source.id)).toEqual(
      entries.map((entry) => entry.source.id),
    );
  });

  it("prioritizes media before non-media sources when RSS reaches the article limit", async () => {
    const createTypedEntry = (
      suffix: string,
      orientation: NewsSource["orientation"],
      type: NewsSource["type"],
    ): NewsSourceCatalogEntry => {
      const entry = createEntry(suffix, orientation);

      return { ...entry, source: { ...entry.source, type } };
    };
    const entries = [
      createTypedEntry("1", "izquierda", "agency"),
      createTypedEntry("2", "centroizquierda", "primary_source"),
      createTypedEntry("3", "centro", "agency"),
      createTypedEntry("4", "derecha", "primary_source"),
      createTypedEntry("5", "izquierda", "media"),
      createTypedEntry("6", "centro", "media"),
      createTypedEntry("7", "derecha", "media"),
    ];
    const articles = entries.map((entry, index) =>
      createArticle(String(index + 1), entry.source.id),
    );
    const evidence = articles.map((article, index) =>
      createEvidence(String(index + 1), article),
    );
    const rssFeedReader = createFakeRssFeedReaderPort();
    rssFeedReader.readFeed = async (input) => {
      const index = entries.findIndex((entry) => entry.source.id === input.source.id);

      return ok({
        sourceId: input.source.id,
        feedUrl: input.feedUrl,
        articles: [articles[index]!],
        evidence: [evidence[index]!],
      });
    };
    const webSearch = createFakeWebSearchPort();

    const result = await discoverHybridEvidenceUseCase.execute(
      {
        rssFeedReader,
        articleExtractor: createFakeArticleExtractorPort(),
        webSearch,
      },
      { sources: entries, query: "reforma laboral" },
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.coverage).toBe("complete");
      expect(result.value.articles).toHaveLength(6);
      expect(
        result.value.articles.filter((article) =>
          entries.find((entry) => entry.source.id === article.sourceId)?.source.type === "media",
        ),
      ).toHaveLength(3);
    }
    expect(webSearch.calls.search).toEqual([]);
  });

  it("prioritizes a new orientation after selecting three media", async () => {
    const mediaEntries = [
      createEntry("1", "izquierda"),
      createEntry("2", "izquierda"),
      createEntry("3", "izquierda"),
    ];
    const agencyEntry = createEntry("4", "derecha");
    const entries = [
      ...mediaEntries,
      { ...agencyEntry, source: { ...agencyEntry.source, type: "agency" as const } },
    ];
    const articles = [
      createArticle("1", mediaEntries[0]!.source.id),
      createArticle("2", mediaEntries[0]!.source.id),
      createArticle("3", mediaEntries[1]!.source.id),
      createArticle("4", mediaEntries[1]!.source.id),
      createArticle("5", mediaEntries[2]!.source.id),
      createArticle("6", mediaEntries[2]!.source.id),
      createArticle("7", agencyEntry.source.id),
    ];
    const rssFeedReader = createFakeRssFeedReaderPort();
    rssFeedReader.readFeed = async (input) => {
      const sourceArticles = articles.filter((article) => article.sourceId === input.source.id);

      return ok({
        sourceId: input.source.id,
        feedUrl: input.feedUrl,
        articles: sourceArticles,
        evidence: sourceArticles.map((article, index) =>
          createEvidence(String(index + 1), article),
        ),
      });
    };
    const webSearch = createFakeWebSearchPort();

    const result = await discoverHybridEvidenceUseCase.execute(
      {
        rssFeedReader,
        articleExtractor: createFakeArticleExtractorPort(),
        webSearch,
      },
      { sources: entries, query: "reforma laboral" },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        coverage: "complete",
        articles: expect.arrayContaining([
          expect.objectContaining({ sourceId: agencyEntry.source.id }),
        ]),
      },
    });
    expect(webSearch.calls.search).toEqual([]);
  });

  it("limits media coverage requirements to active configured media", async () => {
    const entries = [
      createEntry("1", "izquierda"),
      createEntry("2", "centro"),
    ];
    const firstArticles = [
      createArticle("1", entries[0]!.source.id),
      createArticle("2", entries[0]!.source.id),
    ];
    const secondArticles = [createArticle("3", entries[1]!.source.id)];
    const rssFeedReader = createFakeRssFeedReaderPort();
    rssFeedReader.readFeed = async (input) => {
      const articles = input.source.id === entries[0]!.source.id
        ? firstArticles
        : secondArticles;

      return ok({
        sourceId: input.source.id,
        feedUrl: input.feedUrl,
        articles,
        evidence: articles.map((article, index) =>
          createEvidence(String(index + 1), article),
        ),
      });
    };
    const webSearch = createFakeWebSearchPort();

    const result = await discoverHybridEvidenceUseCase.execute(
      {
        rssFeedReader,
        articleExtractor: createFakeArticleExtractorPort(),
        webSearch,
      },
      { sources: entries, query: "reforma laboral" },
    );

    expect(result).toMatchObject({ ok: true, value: { coverage: "complete" } });
    expect(webSearch.calls.search).toEqual([]);
  });

  it("counts classified agency orientations toward available coverage diversity", async () => {
    const agencyEntry = createEntry("4", "centro");
    const entries = [
      createEntry("1", "izquierda"),
      createEntry("2", "izquierda"),
      createEntry("3", "izquierda"),
      {
        ...agencyEntry,
        source: { ...agencyEntry.source, type: "agency" as const },
      },
    ];
    const articles = entries.map((entry, index) =>
      createArticle(String(index + 1), entry.source.id),
    );
    const rssFeedReader = createFakeRssFeedReaderPort();
    rssFeedReader.readFeed = async (input) => {
      const index = entries.findIndex((entry) => entry.source.id === input.source.id);
      const article = articles[index]!;

      return ok({
        sourceId: input.source.id,
        feedUrl: input.feedUrl,
        articles: [article],
        evidence: [createEvidence(String(index + 1), article)],
      });
    };
    const webSearch = createFakeWebSearchPort();

    const result = await discoverHybridEvidenceUseCase.execute(
      {
        rssFeedReader,
        articleExtractor: createFakeArticleExtractorPort(),
        webSearch,
      },
      { sources: entries, query: "reforma laboral" },
    );

    expect(result).toMatchObject({ ok: true, value: { coverage: "complete" } });
    expect(webSearch.calls.search).toEqual([]);
  });

  it("reports normalized partial extractions as failed sources", async () => {
    const entries = [
      createEntry("1", "izquierda"),
      createEntry("2", "centro"),
      createEntry("3", "derecha"),
    ];
    const articles = entries.map((entry, index) =>
      createArticle(String(index + 1), entry.source.id),
    );
    const rssFeedReader = createFakeRssFeedReaderPort();
    rssFeedReader.readFeed = async (input) => {
      const index = entries.findIndex((entry) => entry.source.id === input.source.id);
      const article = articles[index]!;

      return ok({
        sourceId: input.source.id,
        feedUrl: input.feedUrl,
        articles: [article],
        evidence: [createEvidence(String(index + 1), article)],
      });
    };

    const result = await discoverHybridEvidenceUseCase.execute(
      {
        rssFeedReader,
        articleExtractor: createFakeArticleExtractorPort({
          resultForInput: (input) => ok({
            article: input.article,
            evidence: input.fallbackEvidence,
            extractionStatus: "partial",
          }),
        }),
        webSearch: createFakeWebSearchPort(),
      },
      { sources: entries, query: "reforma laboral" },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        failedSources: entries.map((entry) => ({
          stage: "extraction",
          sourceId: entry.source.id,
          errorType: "PartialExtraction",
        })),
      },
    });
  });

  it("reports partial web extractions as failed sources", async () => {
    const entries = [createEntry("1", "izquierda")];
    const webSearch = createFakeWebSearchPort({
      failedExtractions: [
        { sourceId: entries[0]!.source.id, kind: "partial" },
      ],
    });

    const result = await discoverHybridEvidenceUseCase.execute(
      {
        rssFeedReader: createFakeRssFeedReaderPort(),
        articleExtractor: createFakeArticleExtractorPort(),
        webSearch,
      },
      { sources: entries, query: "reforma laboral" },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        failedSources: [
          { stage: "extraction", sourceId: entries[0]!.source.id, errorType: "PartialExtraction" },
        ],
      },
    });
  });

  it("does not require unavailable media coverage from agencies", async () => {
    const agencyEntry = createEntry("3", "derecha");
    const entries = [
      createEntry("1", "izquierda"),
      createEntry("2", "centro"),
      {
        ...agencyEntry,
        source: {
          ...agencyEntry.source,
          type: "agency" as const,
        },
      },
    ];
    const articles = entries.map((entry, index) =>
      createArticle(String(index + 1), entry.source.id),
    );
    const evidence = articles.map((article, index) =>
      createEvidence(String(index + 1), article),
    );
    const rssFeedReader = createFakeRssFeedReaderPort();
    rssFeedReader.readFeed = async (input) => {
      const index = entries.findIndex((entry) => entry.source.id === input.source.id);
      return ok({
        sourceId: input.source.id,
        feedUrl: input.feedUrl,
        articles: [articles[index]!],
        evidence: [evidence[index]!],
      });
    };
    const webSearch = createFakeWebSearchPort();

    const result = await discoverHybridEvidenceUseCase.execute(
      {
        rssFeedReader,
        articleExtractor: createFakeArticleExtractorPort(),
        webSearch,
      },
      { sources: entries, query: "reforma laboral" },
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.coverage).toBe("complete");
    }
    expect(webSearch.calls.search).toEqual([]);
  });

  it("keeps valid RSS evidence and reports partial coverage when extraction and web search fail", async () => {
    const entries = [
      createEntry("1", "izquierda"),
      createEntry("2", "sin_clasificar"),
    ];
    const article = createArticle("1", entries[0]!.source.id);
    const evidence = createEvidence("1", article);
    const rssFeedReader = createFakeRssFeedReaderPort();
    rssFeedReader.readFeed = async (input) => input.source.id === entries[0]!.source.id
      ? ok({
        sourceId: input.source.id,
        feedUrl: input.feedUrl,
        articles: [article],
        evidence: [evidence],
      })
      : err(new ExternalPortError("rss.feed.read", "TransientFailure"));
    const articleExtractor = createFakeArticleExtractorPort({
      result: err(new ExternalPortError("article.extract", "Timeout")),
    });
    const webSearch = createFakeWebSearchPort({
      result: err(new ExternalPortError("ai.web_search", "TransientFailure")),
    });

    const result = await discoverHybridEvidenceUseCase.execute(
      { rssFeedReader, articleExtractor, webSearch },
      { sources: entries, query: "reforma laboral" },
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.coverage).toBe("partial");
      expect(result.value.articles).toEqual([article]);
      expect(result.value.evidence).toEqual([evidence]);
      expect(result.value.failedSources.map((failure) => failure.stage)).toEqual([
        "rss",
        "extraction",
        "web_search",
      ]);
    }
  });

  it("propagates cancellation without starting discovery", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await discoverHybridEvidenceUseCase.execute(
      {
        rssFeedReader: createFakeRssFeedReaderPort(),
        articleExtractor: createFakeArticleExtractorPort(),
        webSearch: createFakeWebSearchPort(),
      },
      {
        sources: [createEntry("1", "izquierda")],
        query: "reforma laboral",
        options: { signal: controller.signal },
      },
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toMatchObject({ type: "PortCancelled", operationName: "discovery.hybrid" });
    }
  });

  it("does not read active RSS sources pending approval", async () => {
    const approvedEntry = createEntry("1", "izquierda");
    const pendingEntry = createEntry("2", "centro");
    const entries = [
      approvedEntry,
      {
        ...pendingEntry,
        source: {
          ...pendingEntry.source,
          approvalStatus: "pending_review" as const,
        },
      },
    ];
    const readSourceIds: UUID[] = [];
    const rssFeedReader = createFakeRssFeedReaderPort();
    rssFeedReader.readFeed = async (input) => {
      readSourceIds.push(input.source.id);

      return ok({
        sourceId: input.source.id,
        feedUrl: input.feedUrl,
        articles: [],
        evidence: [],
      });
    };

    await discoverHybridEvidenceUseCase.execute(
      {
        rssFeedReader,
        articleExtractor: createFakeArticleExtractorPort(),
        webSearch: createFakeWebSearchPort(),
      },
      { sources: entries, query: "reforma laboral" },
    );

    expect(readSourceIds).toEqual([approvedEntry.source.id]);
  });

});
