import {
  AiCapabilityUnavailableError,
  AiConfigurationUnavailableError,
  ExternalPortError,
  InvalidAiProviderConfigurationError,
  PortCancelledError,
  createFakeArticleExtractorPort,
  createFakeAiGenerationPort,
  createRuntimeEvidenceFragment,
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

const extractedText = "Contenido extraído de la URL consultada.";

const createTestArticleExtractor = () =>
  createFakeArticleExtractorPort({
    resultForInput: (input) => {
      const evidence = createRuntimeEvidenceFragment({
        id: "33333333-3333-4333-8333-333333333333",
        text: extractedText,
        provenance: {
          articleId: input.article.id,
          sourceId: input.article.sourceId,
          url: input.article.url,
          contentKind: "extracted_body",
        },
        quality: { contentLevel: "complete" },
      });

      if (!evidence.ok) {
        throw evidence.error;
      }

      return ok({
        article: input.article,
        evidence: [evidence.value],
        extractionStatus: "full_text" as const,
      });
    },
  });

describe("AI web search adapter", () => {
  it("extracts source content for OpenAI citations without snippets", async () => {
    const aiProvider = createFakeAiGenerationPort({
      citations: [{ url: "https://example.com/presupuesto", title: "Presupuesto" }],
    });
    const articleExtractor = createFakeArticleExtractorPort({
      resultForInput: (input) => {
        const evidence = createRuntimeEvidenceFragment({
          id: "33333333-3333-4333-8333-333333333333",
          text: "El cuerpo extraído pertenece a la fuente consultada.",
          provenance: {
            articleId: input.article.id,
            sourceId: input.article.sourceId,
            url: input.article.url,
            contentKind: "extracted_body",
          },
          quality: { contentLevel: "complete" },
        });

        if (!evidence.ok) {
          throw evidence.error;
        }

        return ok({
          article: input.article,
          evidence: [evidence.value],
          extractionStatus: "full_text" as const,
        });
      },
    } as never);
    const search = createAiWebSearchAdapter({
      aiProvider,
      articleExtractor,
      configurationRepository: {
        getEffectiveConfiguration: async () => ok(configuration),
      },
    } as never);

    const result = await search.search({ sourceScopes, query: "presupuesto nacional" });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.consultedUrls).toEqual(["https://example.com/presupuesto"]);
      expect(result.value.results).toEqual([
        expect.objectContaining({
          article: expect.objectContaining({ title: "Presupuesto" }),
          evidence: expect.objectContaining({
            text: "El cuerpo extraído pertenece a la fuente consultada.",
            provenance: expect.objectContaining({
              contentKind: "extracted_body",
              discoveryKind: "web_search",
            }),
            quality: { contentLevel: "complete" },
          }),
        }),
      ]);
    }
  });

  it("uses extracted source content as web evidence", async () => {
    const aiProvider = createFakeAiGenerationPort({
      webSearchText: "El Congreso debatió el presupuesto nacional.",
      citations: [
        {
          url: "https://example.com/presupuesto",
          title: "Presupuesto",
        },
        {
          url: "https://sub.example.com/debate",
          title: "Debate",
        },
      ],
    });
    const search = createAiWebSearchAdapter({
      aiProvider,
      articleExtractor: createTestArticleExtractor(),
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
      expect(result.value.results.map((item) => item.evidence.text)).toEqual([
        extractedText,
        extractedText,
      ]);
      expect(result.value.results.map((item) => item.evidence)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: extractedText,
            provenance: expect.objectContaining({
              sourceId: source.id,
              contentKind: "extracted_body",
            }),
            quality: { contentLevel: "complete" },
          }),
        ]),
      );
    }
  });

  it("limits local extraction while retaining every consulted URL", async () => {
    const aiProvider = createFakeAiGenerationPort({
      citations: [
        { url: "https://example.com/uno", title: "Uno" },
        { url: "https://example.com/dos", title: "Dos" },
        { url: "https://example.com/tres", title: "Tres" },
      ],
    });
    const articleExtractor = createTestArticleExtractor();
    const search = createAiWebSearchAdapter({
      aiProvider,
      articleExtractor,
      configurationRepository: {
        getEffectiveConfiguration: async () => ok(configuration),
      },
    });

    const result = await search.search({
      sourceScopes,
      query: "presupuesto nacional",
      options: { maxItems: 1 },
    });

    expect(isOk(result)).toBe(true);
    expect(articleExtractor.calls.extractArticle).toHaveLength(1);
    if (isOk(result)) {
      expect(result.value.results).toHaveLength(1);
      expect(result.value.consultedUrls).toEqual([
        "https://example.com/uno",
        "https://example.com/dos",
        "https://example.com/tres",
      ]);
    }
  });

  it("rejects unavailable AI configuration before calling the provider", async () => {
    const aiProvider = createFakeAiGenerationPort();
    const search = createAiWebSearchAdapter({
      aiProvider,
      articleExtractor: createTestArticleExtractor(),
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
      articleExtractor: createTestArticleExtractor(),
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
      articleExtractor: createTestArticleExtractor(),
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
      articleExtractor: createTestArticleExtractor(),
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

  it("does not call the provider when cancellation occurs after configuration", async () => {
    const controller = new AbortController();
    const aiProvider = createFakeAiGenerationPort();
    const search = createAiWebSearchAdapter({
      aiProvider,
      articleExtractor: createTestArticleExtractor(),
      configurationRepository: {
        getEffectiveConfiguration: async () => {
          controller.abort();
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
    expect(aiProvider.calls.searchWeb).toEqual([]);
  });

  it("keeps citations with partial extraction as consulted URLs without evidence", async () => {
    const aiProvider = createFakeAiGenerationPort({
      citations: [{ url: "https://example.com/presupuesto" }],
    });
    const search = createAiWebSearchAdapter({
      aiProvider,
      articleExtractor: createFakeArticleExtractorPort(),
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

  it("does not return evidence from a partial extraction", async () => {
    const aiProvider = createFakeAiGenerationPort({
      citations: [{ url: "https://example.com/presupuesto", title: "Presupuesto" }],
    });
    const articleExtractor = createFakeArticleExtractorPort({
      resultForInput: (input) => {
        const evidence = createRuntimeEvidenceFragment({
          id: "33333333-3333-4333-8333-333333333333",
          text: "Texto que no debe usarse sin extracción completa.",
          provenance: {
            articleId: input.article.id,
            sourceId: input.article.sourceId,
            url: input.article.url,
            contentKind: "extracted_body",
          },
          quality: { contentLevel: "complete" },
        });

        if (!evidence.ok) {
          throw evidence.error;
        }

        return ok({
          article: input.article,
          evidence: [evidence.value],
          extractionStatus: "partial" as const,
        });
      },
    });
    const search = createAiWebSearchAdapter({
      aiProvider,
      articleExtractor,
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

  it("does not turn citations outside requested domain limits into evidence", async () => {
    const aiProvider = createFakeAiGenerationPort({
      citations: [
        {
          url: "https://example.com/allowed",
          title: "Permitida",
        },
        {
          url: "https://sub.example.com/blocked",
          title: "Bloqueada",
        },
        {
          url: "https://other.example/outside",
          title: "Fuera de lista",
        },
      ],
    });
    const search = createAiWebSearchAdapter({
      aiProvider,
      articleExtractor: createTestArticleExtractor(),
      configurationRepository: {
        getEffectiveConfiguration: async () => ok(configuration),
      },
    });

    const result = await search.search({
      sourceScopes: [{ source, domains: ["example.com", "other.example"] }],
      query: "presupuesto nacional",
      allowedDomains: ["EXAMPLE.COM."],
      blockedDomains: ["sub.example.com"],
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.consultedUrls).toEqual([
        "https://example.com/allowed",
        "https://sub.example.com/blocked",
        "https://other.example/outside",
      ]);
      expect(result.value.results.map((item) => item.article.title)).toEqual(["Permitida"]);
    }
  });

  it("keeps a citation from an unmapped domain without attributing it", async () => {
    const aiProvider = createFakeAiGenerationPort({
      webSearchText: "Resumen de búsqueda.",
      citations: [{ url: "https://external.example/noticia", title: "Cobertura externa" }],
    });
    const search = createAiWebSearchAdapter({
      aiProvider,
      articleExtractor: createTestArticleExtractor(),
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
        {
          url: "https://example.com/presupuesto",
          title: "Presupuesto",
        },
        {
          url: "https://international.example/debate",
          title: "Debate",
        },
      ],
    });
    const search = createAiWebSearchAdapter({
      aiProvider,
      articleExtractor: createTestArticleExtractor(),
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

  it("does not use the generated search summary when extraction is partial", async () => {
    const aiProvider = createFakeAiGenerationPort({
      webSearchText: "Resumen generado que no pertenece a una fuente individual.",
      citations: [{ url: "https://example.com/presupuesto", title: "Presupuesto" }],
    });
    const search = createAiWebSearchAdapter({
      aiProvider,
      articleExtractor: createFakeArticleExtractorPort(),
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
      expect(result.value.results).toEqual([]);
      expect(result.value.consultedUrls).toEqual(["https://example.com/presupuesto"]);
    }
  });

  it("normalizes malformed provider URLs as a Result error", async () => {
    const aiProvider = createFakeAiGenerationPort({
      webSearchText: "Resumen de búsqueda.",
      citations: [{ url: "not a valid URL" as never, title: "Inválida" }],
    });
    const search = createAiWebSearchAdapter({
      aiProvider,
      articleExtractor: createTestArticleExtractor(),
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
