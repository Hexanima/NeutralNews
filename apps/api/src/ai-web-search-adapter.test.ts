import {
  AiCapabilityUnavailableError,
  AiConfigurationUnavailableError,
  ExternalPortError,
  InvalidAiProviderConfigurationError,
  PortCancelledError,
  createFakeAiGenerationPort,
  err,
  initialAiProviderCatalogSnapshot,
  isOk,
  ok,
  type CountryCode,
  type EffectiveAiProviderConfiguration,
  type LanguageCode,
  type NewsSource,
  type UUID,
} from "app-domain";
import { describe, expect, it } from "vitest";

import { createAiWebSearchAdapter } from "./ai-web-search-adapter.js";

const source: NewsSource = {
  id: "11111111-1111-4111-8111-111111111111" as UUID,
  name: "Agencia Publica",
  orientation: "sin_clasificar",
  type: "agency",
  region: "argentina",
  country: "AR" as CountryCode,
  language: "es-ar" as LanguageCode,
  active: true,
  approvalStatus: "approved",
  reviewedAt: "2026-09-05T00:00:00.000Z",
};

const configuration: EffectiveAiProviderConfiguration = {
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

describe("AI web search adapter", () => {
  it("uses the active selection and turns every citation into web evidence", async () => {
    const aiProvider = createFakeAiGenerationPort({
      webSearchText: "El Congreso debatió el presupuesto nacional.",
      citations: [
        { url: "https://example.com/presupuesto", title: "Presupuesto" },
        { url: "https://sub.example.com/debate" },
      ],
    });
    const search = createAiWebSearchAdapter({
      aiProvider,
      configurationRepository: {
        getEffectiveConfiguration: async () => ok(configuration),
      },
    });
    const signal = new AbortController().signal;

    const result = await search.search({
      source,
      query: "presupuesto nacional",
      allowedDomains: ["example.com", "sub.example.com"],
      blockedDomains: ["blocked.example"],
      options: { signal, timeoutMs: 1000, maxItems: 2 },
    });

    expect(isOk(result)).toBe(true);
    expect(aiProvider.calls.searchWeb).toEqual([
      {
        selection: configuration.activeSelection,
        requiredCapabilities: ["web_search"],
        query: "presupuesto nacional",
        allowedDomains: ["example.com", "sub.example.com"],
        blockedDomains: ["blocked.example"],
        options: { signal, timeoutMs: 1000, maxItems: 2 },
      },
    ]);
    if (isOk(result)) {
      expect(result.value.consultedUrls).toEqual([
        "https://example.com/presupuesto",
        "https://sub.example.com/debate",
      ]);
      expect(result.value.results).toHaveLength(2);
      expect(result.value.results.map((item) => item.source)).toEqual([source, source]);
      expect(result.value.results.map((item) => item.article.title)).toEqual([
        "Presupuesto",
        "sub.example.com",
      ]);
      expect(result.value.results.map((item) => item.evidence)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: "El Congreso debatió el presupuesto nacional.",
            provenance: expect.objectContaining({
              sourceId: source.id,
              contentKind: "web_snippet",
            }),
            quality: { contentLevel: "partial" },
          }),
        ]),
      );
    }
  });

  it("rejects unavailable AI configuration before calling the provider", async () => {
    const aiProvider = createFakeAiGenerationPort();
    const search = createAiWebSearchAdapter({
      aiProvider,
      configurationRepository: {
        getEffectiveConfiguration: async () =>
          err(new InvalidAiProviderConfigurationError([])),
      },
    });

    const result = await search.search({ source, query: "presupuesto nacional" });

    expect(result).toEqual({
      ok: false,
      error: expect.any(AiConfigurationUnavailableError),
    });
    expect(aiProvider.calls.searchWeb).toEqual([]);
  });

  it("rejects an active model without web search before calling the provider", async () => {
    const aiProvider = createFakeAiGenerationPort();
    const search = createAiWebSearchAdapter({
      aiProvider,
      configurationRepository: {
        getEffectiveConfiguration: async () =>
          ok({
            ...configuration,
            models: configuration.models.map((model) =>
              model.modelId === configuration.activeSelection.modelId
                ? { ...model, capabilities: ["structured_outputs"] }
                : model,
            ),
          }),
      },
    });

    const result = await search.search({ source, query: "presupuesto nacional" });

    expect(result).toEqual({
      ok: false,
      error: expect.any(AiCapabilityUnavailableError),
    });
    expect(aiProvider.calls.searchWeb).toEqual([]);
  });

  it("preserves provider failures", async () => {
    const failure = new ExternalPortError("openai.responses.web_search", "TransientFailure");
    const aiProvider = createFakeAiGenerationPort({ webSearchResult: err(failure) });
    const search = createAiWebSearchAdapter({
      aiProvider,
      configurationRepository: {
        getEffectiveConfiguration: async () => ok(configuration),
      },
    });

    const result = await search.search({ source, query: "presupuesto nacional" });

    expect(result).toEqual({ ok: false, error: failure });
  });

  it("does not query configuration after cancellation", async () => {
    let configurationReads = 0;
    const controller = new AbortController();
    controller.abort();
    const search = createAiWebSearchAdapter({
      aiProvider: createFakeAiGenerationPort(),
      configurationRepository: {
        getEffectiveConfiguration: async () => {
          configurationReads += 1;
          return ok(configuration);
        },
      },
    });

    const result = await search.search({
      source,
      query: "presupuesto nacional",
      options: { signal: controller.signal },
    });

    expect(result).toEqual({
      ok: false,
      error: expect.any(PortCancelledError),
    });
    expect(configurationReads).toBe(0);
  });

  it("rejects cited results without text instead of inventing evidence", async () => {
    const aiProvider = createFakeAiGenerationPort({
      citations: [{ url: "https://example.com/presupuesto" }],
    });
    const search = createAiWebSearchAdapter({
      aiProvider,
      configurationRepository: {
        getEffectiveConfiguration: async () => ok(configuration),
      },
    });

    const result = await search.search({ source, query: "presupuesto nacional" });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        type: "ExternalPortError",
        operationName: "ai.web_search",
        category: "PermanentFailure",
      }),
    });
  });
});
