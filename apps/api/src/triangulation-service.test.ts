import {
  createFakeArticleExtractorPort,
  createFakeEditorialGenerationPort,
  createFakeRssFeedReaderPort,
  createFakeWebSearchPort,
  defaultRegionalPreferences,
  initialAiProviderCatalogSnapshot,
  ok,
  type EffectiveAiProviderConfiguration,
} from "app-domain";
import { describe, expect, it } from "vitest";

import type { ApiConfig } from "./config.js";
import { triangulateConfiguredTopic } from "./triangulation-service.js";

const config: ApiConfig = {
  host: "127.0.0.1",
  port: 3000,
  timeZone: "America/Argentina/Buenos_Aires",
  dataDirectory: ".neutralnews-data",
  accessPasswordHash: "unused-in-test",
  sessionSecret: "unused-in-test",
  aiProviderStatus: "not_configured",
  externalServices: { timeoutMs: 15_000, maxAttempts: 3, retryDelayMs: 250 },
  rssFeeds: { maxConcurrency: 1, trackingParameters: ["utm_source"] },
  trustedProxyAddresses: [],
  allowedOrigins: [],
};

const aiConfiguration: EffectiveAiProviderConfiguration = {
  schemaVersion: 1,
  configurationVersion: 1,
  providers: initialAiProviderCatalogSnapshot.providers,
  models: initialAiProviderCatalogSnapshot.models,
  activeSelection: { providerId: "openai", modelId: "gpt-5.6-terra" },
  credentialReferences: [],
  providerOverrides: [],
  modelOverrides: [],
  modelSynchronizations: [],
};

describe("configured triangulation service", () => {
  it("runs the domain use case with effective configuration and the request signal", async () => {
    const signal = new AbortController().signal;
    const rssFeedReader = createFakeRssFeedReaderPort();
    const result = await triangulateConfiguredTopic({
      config,
      query: "reforma laboral",
      signal,
      newsSourceRepository: {
        getEffectiveConfiguration: async () => ok({
          schemaVersion: 4,
          configurationVersion: 1,
          cacheVersion: "test",
          sources: [],
          sourceOverrides: [],
          candidates: [],
          regionalPreferences: defaultRegionalPreferences,
        }),
      },
      aiConfigurationRepository: {
        getEffectiveConfiguration: async () => ok(aiConfiguration),
      },
      rssFeedReader,
      articleExtractor: createFakeArticleExtractorPort(),
      webSearch: createFakeWebSearchPort(),
      editorialGeneration: createFakeEditorialGenerationPort({
        triangulation: {
          summary: "No usada.",
          matches: [],
          divergences: [],
          sources: [],
          warnings: [{ kind: "insufficient_evidence", message: "No usada." }],
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        warnings: [{ kind: "insufficient_evidence" }],
      },
    });
    expect(rssFeedReader.calls.readFeed).toEqual([]);
  });
});
