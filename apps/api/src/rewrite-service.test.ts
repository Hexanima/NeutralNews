import {
  createFakeAiGenerationPort,
  initialAiProviderCatalogSnapshot,
  ok,
  type EffectiveAiProviderConfiguration,
} from "app-domain";
import { describe, expect, it } from "vitest";

import type { ApiConfig } from "./config.js";
import { rewriteConfiguredText } from "./rewrite-service.js";

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

describe("configured rewrite service", () => {
  it("uses the configured structured-output provider with the request signal", async () => {
    const signal = new AbortController().signal;
    const text = "El desastroso proyecto avanzó.";
    const aiProvider = createFakeAiGenerationPort({
      output: {
        neutralText: "El proyecto avanzó.",
        changes: [{
          id: "7cc5149b-a95f-470c-a880-8d93d10e3443",
          type: "evaluative_language",
          originalText: "desastroso",
          neutralText: "cuestionado",
          justification: "Se eliminó un calificativo valorativo.",
        }],
        positions: [{
          sourceSegmentIds: ["segment-1"],
          neutralText: "El proyecto avanzó.",
        }],
      },
    });

    const result = await rewriteConfiguredText({
      config,
      text,
      signal,
      aiConfigurationRepository: {
        getEffectiveConfiguration: async () => ok(aiConfiguration),
      },
      aiProvider,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { neutralText: "El proyecto avanzó." },
    });
    expect(aiProvider.calls.generateStructuredResponse).toEqual([
      expect.objectContaining({
        selection: aiConfiguration.activeSelection,
        requiredCapabilities: ["structured_outputs"],
        options: { signal },
      }),
    ]);
  });
});
