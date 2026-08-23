import {
  ExternalPortError,
  PortCancelledError,
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
  type PortError,
  type Result,
  type RssFeedReaderPort,
  type RssFeedReadResult,
  type UUID,
} from "../index.js";
import { describe, expect, it } from "vitest";

import { aggregateRssFeedsUseCase } from "./rss-feed-aggregation-usecase.js";

const reviewedAt = "2026-08-20T00:00:00.000Z" as IsoDateTimeString;

const createSource = (
  suffix: string,
  input: Partial<NewsSource> = {},
): NewsSource => ({
  id: `11111111-1111-4111-8111-11111111111${suffix}` as UUID,
  name: `Medio ${suffix}`,
  orientation: "sin_clasificar",
  type: "media",
  region: "argentina",
  country: "AR" as CountryCode,
  language: "es-ar" as LanguageCode,
  active: true,
  approvalStatus: "approved",
  reviewedAt,
  ...input,
});

const createRssEntry = (suffix: string): NewsSourceCatalogEntry => ({
  source: createSource(suffix),
  discovery: {
    mode: "rss",
    feedUrl: `https://example.com/feed-${suffix}.xml` as ArticleUrl,
  },
});

const createArticle = (suffix: string, sourceId: UUID): Article => ({
  id: `22222222-2222-4222-8222-22222222222${suffix}` as UUID,
  sourceId,
  url: `https://example.com/article-${suffix}` as ArticleUrl,
  title: `Articulo ${suffix}`,
  language: "es-ar" as LanguageCode,
  publishedAt: reviewedAt,
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

const okFeed = (
  entry: NewsSourceCatalogEntry,
  suffix: string,
): Result<RssFeedReadResult, PortError> => {
  const article = createArticle(suffix, entry.source.id);

  return ok({
    sourceId: entry.source.id,
    feedUrl:
      entry.discovery.mode === "rss"
        ? entry.discovery.feedUrl
        : ("https://example.com/unused.xml" as ArticleUrl),
    articles: [article],
    evidence: [createEvidence(suffix, article)],
  });
};

const createReader = (
  results: ReadonlyMap<UUID, Result<RssFeedReadResult, PortError>>,
): RssFeedReaderPort & {
  calls: Parameters<RssFeedReaderPort["readFeed"]>[0][];
} => {
  const calls: Parameters<RssFeedReaderPort["readFeed"]>[0][] = [];

  return {
    calls,
    readFeed: async (input) => {
      calls.push(input);

      return (
        results.get(input.source.id) ??
        ok({
          sourceId: input.source.id,
          feedUrl: input.feedUrl,
          articles: [],
          evidence: [],
        })
      );
    },
  };
};

describe("aggregate RSS feeds use case", () => {
  it("consolidates articles and evidence when every active RSS feed succeeds", async () => {
    const first = createRssEntry("1");
    const second = createRssEntry("2");
    const rssFeedReader = createReader(
      new Map([
        [first.source.id, okFeed(first, "1")],
        [second.source.id, okFeed(second, "2")],
      ]),
    );

    const result = await aggregateRssFeedsUseCase.execute(
      { rssFeedReader },
      { sources: [first, second] },
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.articles.map((article) => article.sourceId)).toEqual([
        first.source.id,
        second.source.id,
      ]);
      expect(result.value.evidence).toHaveLength(2);
      expect(result.value.successfulFeeds).toEqual([
        {
          sourceId: first.source.id,
          feedUrl: first.discovery.feedUrl,
          articleCount: 1,
          evidenceCount: 1,
        },
        {
          sourceId: second.source.id,
          feedUrl: second.discovery.feedUrl,
          articleCount: 1,
          evidenceCount: 1,
        },
      ]);
      expect(result.value.failedFeeds).toEqual([]);
    }
  });

  it("returns successful articles and identifies failed feeds when some RSS feeds fail", async () => {
    const first = createRssEntry("1");
    const second = createRssEntry("2");
    const failure = new ExternalPortError("rss.feed.read", "TransientFailure", 503);
    const rssFeedReader = createReader(
      new Map([
        [first.source.id, okFeed(first, "1")],
        [second.source.id, { ok: false, error: failure }],
      ]),
    );

    const result = await aggregateRssFeedsUseCase.execute(
      { rssFeedReader },
      { sources: [first, second] },
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.articles).toHaveLength(1);
      expect(result.value.articles[0]?.sourceId).toBe(first.source.id);
      expect(result.value.failedFeeds).toEqual([
        {
          sourceId: second.source.id,
          feedUrl: second.discovery.feedUrl,
          errorType: "ExternalPortError",
          operationName: "rss.feed.read",
          category: "TransientFailure",
          statusCode: 503,
        },
      ]);
    }
  });

  it("returns an empty successful aggregation with failed feed details when every feed fails", async () => {
    const first = createRssEntry("1");
    const second = createRssEntry("2");
    const rssFeedReader = createReader(
      new Map([
        [
          first.source.id,
          {
            ok: false,
            error: new ExternalPortError("rss.feed.read", "PermanentFailure"),
          },
        ],
        [
          second.source.id,
          {
            ok: false,
            error: new ExternalPortError("rss.feed.parse", "PermanentFailure"),
          },
        ],
      ]),
    );

    const result = await aggregateRssFeedsUseCase.execute(
      { rssFeedReader },
      { sources: [first, second] },
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.articles).toEqual([]);
      expect(result.value.evidence).toEqual([]);
      expect(result.value.successfulFeeds).toEqual([]);
      expect(result.value.failedFeeds).toHaveLength(2);
    }
  });

  it("does not exceed the configured maximum concurrency", async () => {
    const entries = [
      createRssEntry("1"),
      createRssEntry("2"),
      createRssEntry("3"),
    ];
    let activeReads = 0;
    let maxObservedReads = 0;
    let releaseReads: () => void = () => undefined;
    const release = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const rssFeedReader: RssFeedReaderPort = {
      readFeed: async (input) => {
        activeReads += 1;
        maxObservedReads = Math.max(maxObservedReads, activeReads);
        await release;
        activeReads -= 1;

        return ok({
          sourceId: input.source.id,
          feedUrl: input.feedUrl,
          articles: [],
          evidence: [],
        });
      },
    };

    const resultPromise = aggregateRssFeedsUseCase.execute(
      { rssFeedReader },
      { sources: entries, options: { maxConcurrency: 2 } },
    );
    await Promise.resolve();

    expect(maxObservedReads).toBe(2);
    releaseReads();
    await resultPromise;
  });

  it("does not dispatch pending feeds after cancellation and returns a cancellation error without useful results", async () => {
    const entries = [createRssEntry("1"), createRssEntry("2")];
    const controller = new AbortController();
    let firstReadStarted: () => void = () => undefined;
    const readStarted = new Promise<void>((resolve) => {
      firstReadStarted = resolve;
    });
    const calls: Parameters<RssFeedReaderPort["readFeed"]>[0][] = [];
    const rssFeedReader: RssFeedReaderPort = {
      readFeed: async (input) => {
        calls.push(input);
        firstReadStarted();

        return new Promise((resolve) => {
          input.options?.signal?.addEventListener(
            "abort",
            () =>
              resolve({
                ok: false,
                error: new PortCancelledError("rss.feed.read"),
              }),
            { once: true },
          );
        });
      },
    };

    const resultPromise = aggregateRssFeedsUseCase.execute(
      { rssFeedReader },
      {
        sources: entries,
        options: { signal: controller.signal, maxConcurrency: 1 },
      },
    );
    await readStarted;
    controller.abort();
    const result = await resultPromise;

    expect(calls).toHaveLength(1);
    expect(calls[0]?.options?.signal).toBe(controller.signal);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(PortCancelledError);
      expect(result.error.operationName).toBe("rss.feed.aggregate");
    }
  });


  it("returns a cancellation error even after collecting useful results", async () => {
    const first = createRssEntry("1");
    const second = createRssEntry("2");
    const controller = new AbortController();
    const calls: Parameters<RssFeedReaderPort["readFeed"]>[0][] = [];
    const rssFeedReader: RssFeedReaderPort = {
      readFeed: async (input) => {
        calls.push(input);

        if (input.source.id === first.source.id) {
          controller.abort();
          return okFeed(first, "1");
        }

        return okFeed(second, "2");
      },
    };

    const result = await aggregateRssFeedsUseCase.execute(
      { rssFeedReader },
      {
        sources: [first, second],
        options: { signal: controller.signal, maxConcurrency: 1 },
      },
    );

    expect(calls).toHaveLength(1);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(PortCancelledError);
      expect(result.error.operationName).toBe("rss.feed.aggregate");
    }
  });

  it("ignores inactive and search-only sources", async () => {
    const activeRss = createRssEntry("1");
    const inactiveRss: NewsSourceCatalogEntry = {
      ...createRssEntry("2"),
      source: createSource("2", { active: false }),
    };
    const searchOnly: NewsSourceCatalogEntry = {
      source: createSource("3"),
      discovery: { mode: "search_only" },
    };
    const rssFeedReader = createReader(
      new Map([[activeRss.source.id, okFeed(activeRss, "1")]]),
    );

    const result = await aggregateRssFeedsUseCase.execute(
      { rssFeedReader },
      { sources: [activeRss, inactiveRss, searchOnly] },
    );

    expect(isOk(result)).toBe(true);
    expect(rssFeedReader.calls).toHaveLength(1);
    expect(rssFeedReader.calls[0]?.source.id).toBe(activeRss.source.id);
  });

  it("deduplicates articles by canonical URL while preserving merged references", async () => {
    const first = createRssEntry("1");
    const second = createRssEntry("2");
    const original = createArticle("1", first.source.id);
    const duplicate = {
      ...createArticle("2", second.source.id),
      url: "https://example.com/article-1?utm_source=feed" as ArticleUrl,
      title: original.title,
    };
    const rssFeedReader = createReader(
      new Map([
        [
          first.source.id,
          ok({
            sourceId: first.source.id,
            feedUrl: first.discovery.feedUrl,
            articles: [original],
            evidence: [createEvidence("1", original)],
          }),
        ],
        [
          second.source.id,
          ok({
            sourceId: second.source.id,
            feedUrl: second.discovery.feedUrl,
            articles: [duplicate],
            evidence: [createEvidence("2", duplicate)],
          }),
        ],
      ]),
    );

    const result = await aggregateRssFeedsUseCase.execute(
      { rssFeedReader },
      {
        sources: [first, second],
        deduplication: { trackingParameters: ["utm_source"] },
      },
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const articleIds = new Set(result.value.articles.map((article) => article.id));

      expect(result.value.articles).toHaveLength(1);
      expect(result.value.evidence).toHaveLength(2);
      expect(
        result.value.evidence.every((evidence) =>
          articleIds.has(evidence.provenance.articleId),
        ),
      ).toBe(true);
      expect(result.value.evidence.map((evidence) => evidence.provenance.articleId))
        .toEqual([original.id, original.id]);
      expect(result.value.successfulFeeds).toEqual([
        {
          sourceId: first.source.id,
          feedUrl: first.discovery.feedUrl,
          articleCount: 1,
          evidenceCount: 1,
        },
        {
          sourceId: second.source.id,
          feedUrl: second.discovery.feedUrl,
          articleCount: 1,
          evidenceCount: 1,
        },
      ]);
      expect(result.value.articleMergeGroups).toEqual([
        {
          canonicalArticleId: original.id,
          canonicalUrl: "https://example.com/article-1",
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
    }
  });
});
