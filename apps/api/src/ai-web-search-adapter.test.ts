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

const sourceScopes = [{ source, domains: ["example.com"] }];

const secondSource: NewsSource = {
  ...source,
  id: "22222222-2222-4222-8222-222222222222" as UUID,
  name: "Agencia Internacional",
  region: "international",
  country: "UY" as CountryCode,
};

describe("AI web search adapter", () => {
  it("uses the active selection and turns every citation into web evidence", async () => {
    const aiProvider = createFakeAiGenerationPort({
      webSearchText: "El Congreso debatió el presupuesto nacional.",
      citations: [
        { url: "https://example.com/presupuesto", title: "Presupuesto" },
        { url: "https://sub.example.com/debate", title: "Debate" },
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
      sourceScopes,
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
      expect(result.value.results.map((item) => item.article.title)).toEqual(["Presupuesto", "Debate"]);
      expect(result.value.results.map((item) => item.evidence.text)).toEqual(["Presupuesto", "Debate"]);
      expect(result.value.results.map((item) => item.evidence)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: "Presupuesto",
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

    const result = await search.search({ sourceScopes, query: "presupuesto nacional" });

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

    const result = await search.search({ sourceScopes, query: "presupuesto nacional" });

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

    const result = await search.search({ sourceScopes, query: "presupuesto nacional" });

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
      sourceScopes,
      query: "presupuesto nacional",
      options: { signal: controller.signal },
    });

    expect(result).toEqual({
      ok: false,
      error: expect.any(PortCancelledError),
    });
    expect(configurationReads).toBe(0);
  });

  it("keeps cited URLs without results when citations have no source-specific content", async () => {
    const aiProvider = createFakeAiGenerationPort({
      citations: [{ url: "https://example.com/presupuesto" }],
    });
    const search = createAiWebSearchAdapter({
      aiProvider,
      configurationRepository: {
        getEffectiveConfiguration: async () => ok(configuration),
      },
    });

    const result = await search.search({ sourceScopes, query: "presupuesto nacional" });

    expect(result).toEqual({
      ok: true,
      value: {
        results: [],
        consultedUrls: ["https://example.com/presupuesto"],
      },
    });
  });

  it("keeps a citation from an unmapped domain without attributing it", async () => {
    const aiProvider = createFakeAiGenerationPort({
      webSearchText: "Resumen de búsqueda.",
      citations: [{ url: "https://external.example/noticia", title: "Cobertura externa" }],
    });
    const search = createAiWebSearchAdapter({
      aiProvider,
      configurationRepository: {
        getEffectiveConfiguration: async () => ok(configuration),
      },
    });

    const result = await search.search({
      sourceScopes,
      query: "presupuesto nacional",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.consultedUrls).toEqual(["https://external.example/noticia"]);
      expect(result.value.results).toEqual([]);
    }
  });

  it("attributes each mapped domain to its matching source", async () => {
    const aiProvider = createFakeAiGenerationPort({
      citations: [
        { url: "https://example.com/presupuesto", title: "Presupuesto" },
        { url: "https://international.example/debate", title: "Debate" },
      ],
    });
    const search = createAiWebSearchAdapter({
      aiProvider,
      configurationRepository: {
        getEffectiveConfiguration: async () => ok(configuration),
      },
    });

    const result = await search.search({
      sourceScopes: [
        { source, domains: ["example.com"] },
        { source: secondSource, domains: ["international.example"] },
      ],
      query: "presupuesto nacional",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.results.map((item) => item.source.id)).toEqual([
        source.id,
        secondSource.id,
      ]);
      expect(result.value.results.map((item) => item.evidence.provenance.sourceId)).toEqual([
        source.id,
        secondSource.id,
      ]);
    }
  });

  it("uses citation-specific content instead of the generated search summary", async () => {
    const aiProvider = createFakeAiGenerationPort({
      webSearchText: "Resumen generado que no pertenece a una fuente individual.",
      citations: [{ url: "https://example.com/presupuesto", title: "Presupuesto" }],
    });
    const search = createAiWebSearchAdapter({
      aiProvider,
      configurationRepository: {
        getEffectiveConfiguration: async () => ok(configuration),
      },
    });

    const result = await search.search({
      sourceScopes,
      query: "presupuesto nacional",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.results[0]?.evidence.text).toBe("Presupuesto");
    }
  });

  it("normalizes malformed provider URLs as a Result error", async () => {
    const aiProvider = createFakeAiGenerationPort({
      webSearchText: "Resumen de búsqueda.",
      citations: [{ url: "not a valid URL" as never, title: "Inválida" }],
    });
    const search = createAiWebSearchAdapter({
      aiProvider,
      configurationRepository: {
        getEffectiveConfiguration: async () => ok(configuration),
      },
    });

    await expect(
      search.search({ sourceScopes, query: "presupuesto nacional" }),
    ).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({
        type: "ExternalPortError",
        operationName: "ai.web_search",
        category: "PermanentFailure",
      }),
    });
  });
});
