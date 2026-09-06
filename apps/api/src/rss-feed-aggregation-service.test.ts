import {
  defaultRegionalPreferences,
  ok,
  type Article,
  type ArticleUrl,
  type EvidenceFragment,
  type CountryCode,
  type IsoDateTimeString,
  type LanguageCode,
  type NewsSource,
  type NewsSourceCatalogEntry,
  type RssFeedReaderPort,
  type UUID,
} from "app-domain";
import { describe, expect, it } from "vitest";

import type { ApiConfig } from "./config.js";
import { aggregateConfiguredRssFeeds } from "./rss-feed-aggregation-service.js";

const reviewedAt = "2026-08-20T00:00:00.000Z" as IsoDateTimeString;

const createSource = (suffix: string): NewsSource => ({
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
});

const createRssEntry = (suffix: string): NewsSourceCatalogEntry => ({
  source: createSource(suffix),
  discovery: {
    mode: "rss",
    feedUrl: `https://example.com/feed-${suffix}.xml` as ArticleUrl,
  },
});

const config: ApiConfig = {
  host: "127.0.0.1",
  port: 3000,
  timeZone: "America/Argentina/Buenos_Aires",
  dataDirectory: ".neutralnews-data",
  accessPasswordHash: "unused-in-this-test",
  sessionSecret: "unused-in-this-test",
  aiProviderStatus: "not_configured",
  externalServices: {
    timeoutMs: 15_000,
    maxAttempts: 3,
    retryDelayMs: 250,
  },
  rssFeeds: {
    maxConcurrency: 1,
    trackingParameters: ["utm_source"],
  },
  trustedProxyAddresses: [],
  allowedOrigins: [],
};

describe("RSS feed aggregation service", () => {
  it("passes configured RSS concurrency and request cancellation to aggregation", async () => {
    const first = createRssEntry("1");
    const second = createRssEntry("2");
    const signal = new AbortController().signal;
    let activeReads = 0;
    let maxObservedReads = 0;
    let firstReadStarted: () => void = () => undefined;
    let releaseReads: () => void = () => undefined;
    const readStarted = new Promise<void>((resolve) => {
      firstReadStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const calls: Parameters<RssFeedReaderPort["readFeed"]>[0][] = [];
    const rssFeedReader: RssFeedReaderPort = {
      readFeed: async (input) => {
        calls.push(input);
        activeReads += 1;
        maxObservedReads = Math.max(maxObservedReads, activeReads);
        firstReadStarted();
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

    const resultPromise = aggregateConfiguredRssFeeds({
      config,
      signal,
      repository: {
        getEffectiveConfiguration: async () =>
          ok({
            schemaVersion: 1,
            configurationVersion: 1,
            cacheVersion: "test-cache-version",
            sources: [first, second],
            sourceOverrides: [],
            regionalPreferences: defaultRegionalPreferences,
          }),
      },
      rssFeedReader,
    });

    await readStarted;
    await Promise.resolve();

    expect(calls).toHaveLength(1);
    expect(maxObservedReads).toBe(1);
    expect(calls[0]?.options?.maxConcurrency).toBe(1);
    expect(calls[0]?.options?.signal).toBe(signal);

    releaseReads();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(maxObservedReads).toBe(1);
  });

  it("passes configured tracking parameters into RSS deduplication", async () => {
    const first = createRssEntry("1");
    const second = createRssEntry("2");
    const firstArticle: Article = {
      id: "22222222-2222-4222-8222-222222222221" as UUID,
      sourceId: first.source.id,
      url: "https://example.com/politica/reforma" as ArticleUrl,
      title: "Congreso debate una reforma presupuestaria",
      language: "es-ar" as LanguageCode,
      publishedAt: reviewedAt,
    };
    const secondArticle: Article = {
      ...firstArticle,
      id: "22222222-2222-4222-8222-222222222222" as UUID,
      sourceId: second.source.id,
      url: "https://example.com/politica/reforma?utm_source=rss" as ArticleUrl,
    };
    const createEvidence = (article: Article): EvidenceFragment => ({
      id: `33333333-3333-4333-8333-33333333333${article.id.endsWith("1") ? "1" : "2"}` as UUID,
      text: "Resumen",
      provenance: {
        articleId: article.id,
        sourceId: article.sourceId,
        url: article.url,
        contentKind: "rss_summary",
      },
      quality: { contentLevel: "partial" },
    });
    const rssFeedReader: RssFeedReaderPort = {
      readFeed: async (input) =>
        ok({
          sourceId: input.source.id,
          feedUrl: input.feedUrl,
          articles: input.source.id === first.source.id ? [firstArticle] : [secondArticle],
          evidence: [
            createEvidence(
              input.source.id === first.source.id ? firstArticle : secondArticle,
            ),
          ],
        }),
    };

    const result = await aggregateConfiguredRssFeeds({
      config,
      repository: {
        getEffectiveConfiguration: async () =>
          ok({
            schemaVersion: 1,
            configurationVersion: 1,
            cacheVersion: "test-cache-version",
            sources: [first, second],
            sourceOverrides: [],
            regionalPreferences: defaultRegionalPreferences,
          }),
      },
      rssFeedReader,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.articles).toHaveLength(1);
      expect(result.value.articleMergeGroups[0]?.references).toHaveLength(2);
    }
  });
});

describe("RSS feed aggregation topic matching", () => {
  it("forwards topic matching to the configured aggregation", async () => {
    const source = createRssEntry("1");
    const article: Article = {
      id: "22222222-2222-4222-8222-222222222221" as UUID,
      sourceId: source.source.id,
      url: "https://example.com/deportes" as ArticleUrl,
      title: "Resultados deportivos del fin de semana",
      language: "es-ar" as LanguageCode,
      publishedAt: reviewedAt,
    };
    const result = await aggregateConfiguredRssFeeds({
      config,
      topicMatching: { query: "Ley de Medios" },
      repository: { getEffectiveConfiguration: async () => ok({ schemaVersion: 1, configurationVersion: 1, cacheVersion: "test", sources: [source], sourceOverrides: [], regionalPreferences: defaultRegionalPreferences }) },
      rssFeedReader: { readFeed: async (input) => ok({ sourceId: input.source.id, feedUrl: input.feedUrl, articles: [article], evidence: [] }) },
    });

    expect(result).toMatchObject({ ok: true, value: { articles: [] } });
  });
});