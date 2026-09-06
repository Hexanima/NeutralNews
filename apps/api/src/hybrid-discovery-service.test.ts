import {
  createFakeArticleExtractorPort,
  createFakeRssFeedReaderPort,
  createFakeWebSearchPort,
  defaultRegionalPreferences,
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
} from "app-domain";
import { describe, expect, it } from "vitest";

import type { ApiConfig } from "./config.js";
import { discoverConfiguredHybridEvidence } from "./hybrid-discovery-service.js";

const reviewedAt = "2026-09-06T00:00:00.000Z" as IsoDateTimeString;

const config: ApiConfig = {
  host: "127.0.0.1",
  port: 3000,
  timeZone: "America/Argentina/Buenos_Aires",
  dataDirectory: ".neutralnews-data",
  accessPasswordHash: "unused-in-this-test",
  sessionSecret: "unused-in-this-test",
  aiProviderStatus: "not_configured",
  externalServices: { timeoutMs: 15_000, maxAttempts: 3, retryDelayMs: 250 },
  rssFeeds: { maxConcurrency: 1, trackingParameters: ["utm_source"] },
  trustedProxyAddresses: [],
  allowedOrigins: [],
};

const createEntry = (suffix: string, orientation: NewsSource["orientation"]): NewsSourceCatalogEntry => ({
  source: {
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
  },
  discovery: {
    mode: "rss",
    feedUrl: `https://medio-${suffix}.example/feed.xml` as ArticleUrl,
    domains: [`medio-${suffix}.example`],
  },
});

const articleFor = (suffix: string, sourceId: UUID): Article => ({
  id: `22222222-2222-4222-8222-22222222222${suffix}` as UUID,
  sourceId,
  url: `https://medio-${suffix}.example/reforma-laboral` as ArticleUrl,
  title: `Reforma laboral ${suffix}`,
  language: "es-ar" as LanguageCode,
  publishedAt: reviewedAt,
});

const evidenceFor = (suffix: string, article: Article): EvidenceFragment => ({
  id: `33333333-3333-4333-8333-33333333333${suffix}` as UUID,
  text: "Resumen reforma laboral",
  provenance: { articleId: article.id, sourceId: article.sourceId, url: article.url, contentKind: "rss_summary" },
  quality: { contentLevel: "partial" },
});

describe("hybrid discovery service", () => {
  it("loads configured sources and forwards the request signal to all discovery ports", async () => {
    const entries = [createEntry("1", "izquierda"), createEntry("2", "centro"), createEntry("3", "derecha")];
    const rssArticle = articleFor("1", entries[0]!.source.id);
    const webArticles = entries.slice(1).map((entry, index) => articleFor(String(index + 2), entry.source.id));
    const signal = new AbortController().signal;
    const rssFeedReader = createFakeRssFeedReaderPort({ articles: [rssArticle], evidence: [evidenceFor("1", rssArticle)] });
    const articleExtractor = createFakeArticleExtractorPort();
    const webSearch = createFakeWebSearchPort({
      results: webArticles.map((article, index) => ({
        source: entries[index + 1]!.source,
        article,
        evidence: {
          ...evidenceFor(String(index + 2), article),
          provenance: { articleId: article.id, sourceId: article.sourceId, url: article.url, contentKind: "extracted_body", discoveryKind: "web_search" },
          quality: { contentLevel: "complete" },
        },
      })),
    });

    const result = await discoverConfiguredHybridEvidence({
      config,
      query: "reforma laboral",
      signal,
      repository: {
        getEffectiveConfiguration: async () => ok({ schemaVersion: 1, configurationVersion: 1, cacheVersion: "test", sources: entries, sourceOverrides: [], regionalPreferences: defaultRegionalPreferences }),
      },
      rssFeedReader,
      articleExtractor,
      webSearch,
    });

    expect(result).toMatchObject({ ok: true, value: { coverage: "complete" } });
    expect(rssFeedReader.calls.readFeed[0]?.options?.signal).toBe(signal);
    expect(articleExtractor.calls.extractArticle[0]?.options?.signal).toBe(signal);
    expect(webSearch.calls.search[0]?.options?.signal).toBe(signal);
    expect(webSearch.calls.search[0]?.sourceScopes).toEqual(
      entries.map((entry) => ({ source: entry.source, domains: entry.discovery.domains })),
    );
  });
});
