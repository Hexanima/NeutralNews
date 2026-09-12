import {
  AiCapabilityUnavailableError,
  AiInvalidStructuredOutputError,
  AiProviderRejectedError,
  PortLimitExceededError,
  createFakeAiGenerationPort,
  createRuntimeEvidenceFragment,
  err,
  initialAiProviderCatalogSnapshot,
  isOk,
  ok,
  type EffectiveAiProviderConfiguration,
  type UUID,
} from "app-domain";
import { describe, expect, it } from "vitest";

import { createTriangulationAnalyzer } from "./triangulation-analyzer.js";

const sourceId = "11111111-1111-4111-8111-111111111111" as UUID;
const secondSourceId = "22222222-2222-4222-8222-222222222222" as UUID;
const evidenceId = "33333333-3333-4333-8333-333333333333" as UUID;
const secondEvidenceId = "44444444-4444-4444-8444-444444444444" as UUID;

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

const evidence = [
  createRuntimeEvidenceFragment({
    id: evidenceId,
    text: "El proyecto fue presentado ante el Congreso.",
    provenance: {
      articleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sourceId,
      url: "https://example.com/politica/proyecto",
      contentKind: "extracted_body",
    },
    quality: { contentLevel: "complete" },
  }),
  createRuntimeEvidenceFragment({
    id: secondEvidenceId,
    text: "La iniciativa ingreso para su tratamiento legislativo.",
    provenance: {
      articleId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sourceId: secondSourceId,
      url: "https://second.example.com/politica/proyecto",
      contentKind: "rss_summary",
    },
    quality: { contentLevel: "partial" },
  }),
].map((result) => {
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
});

const structuredOutput = {
  summary: {
    overview: "Ambas fuentes informan el ingreso legislativo del proyecto.",
    corroboratedClaims: [{
      text: "El proyecto ingreso al Congreso.",
      sourceIds: [sourceId, secondSourceId],
      evidenceFragmentIds: [evidenceId, secondEvidenceId],
    }],
    attributedStatements: [],
  },
  matches: [{
    id: "55555555-5555-4555-8555-555555555555",
    text: "El proyecto ingreso al Congreso.",
    sourceIds: [sourceId, secondSourceId],
    evidenceFragmentIds: [evidenceId, secondEvidenceId],
  }],
  divergences: [],
  sources: [
    { sourceId, evidenceFragmentIds: [evidenceId] },
    { sourceId: secondSourceId, evidenceFragmentIds: [secondEvidenceId] },
  ],
  coverage: {
    regions: [{ region: "argentina", sourceIds: [sourceId, secondSourceId] }],
    orientations: [{ orientation: "sin_clasificar", sourceIds: [sourceId, secondSourceId] }],
  },
  warnings: [],
};

describe("triangulation analyzer", () => {
  it("resolves the active selection and sends bounded, attributable evidence through the generic AI port", async () => {
    const aiProvider = createFakeAiGenerationPort({ output: structuredOutput });
    const analyzer = createTriangulationAnalyzer({
      aiProvider,
      configurationRepository: { getEffectiveConfiguration: async () => ok(configuration) },
    });

    const result = await analyzer.analyze({
      evidence,
      options: { timeoutMs: 1_000, maxBytes: 8_192, maxItems: 4 },
    });

    expect(isOk(result)).toBe(true);
    expect(aiProvider.calls.generateStructuredResponse).toHaveLength(1);
    expect(aiProvider.calls.generateStructuredResponse[0]).toMatchObject({
      selection: configuration.activeSelection,
      requiredCapabilities: ["structured_outputs", "reasoning_medium"],
      options: { timeoutMs: 1_000, maxBytes: 8_192, maxItems: 4 },
    });
    expect(aiProvider.calls.generateStructuredResponse[0]?.prompt).toContain(evidenceId);
    expect(aiProvider.calls.generateStructuredResponse[0]?.prompt).toContain(sourceId);
    expect(aiProvider.calls.generateStructuredResponse[0]?.prompt).toContain(
      "https://example.com/politica/proyecto",
    );
    expect(aiProvider.calls.generateStructuredResponse[0]?.outputSchema).toMatchObject({
      properties: { matches: { maxItems: 4 } },
    });
    if (isOk(result)) {
      expect(result.value.triangulation.summary).toBe(structuredOutput.summary.overview);
      expect(result.value.structuredOutput.coverage).toEqual(structuredOutput.coverage);
    }
  });

  it("rejects an active model without structured outputs before contacting the provider", async () => {
    const aiProvider = createFakeAiGenerationPort({ output: structuredOutput });
    const analyzer = createTriangulationAnalyzer({
      aiProvider,
      configurationRepository: {
        getEffectiveConfiguration: async () => ok({
          ...configuration,
          models: [{ ...configuration.models[0]!, capabilities: ["reasoning_high"] }],
        }),
      },
    });

    const result = await analyzer.analyze({ evidence });

    expect(result).toEqual({
      ok: false,
      error: expect.any(AiCapabilityUnavailableError),
    });
    expect(aiProvider.calls.generateStructuredResponse).toHaveLength(0);
  });

  it("rejects a syntactically valid response that cites a source or evidence absent from the input", async () => {
    const unknownSourceId = "99999999-9999-4999-8999-999999999999";
    const unknownEvidenceId = "88888888-8888-4888-8888-888888888888";
    const aiProvider = createFakeAiGenerationPort({
      output: {
        ...structuredOutput,
        sources: [{ sourceId: unknownSourceId, evidenceFragmentIds: [unknownEvidenceId] }],
        summary: {
          ...structuredOutput.summary,
          corroboratedClaims: [],
          attributedStatements: [{
            text: "Una fuente no incluida lo afirma.",
            attribution: "Fuente desconocida",
            sourceId: unknownSourceId,
            evidenceFragmentIds: [unknownEvidenceId],
          }],
        },
        matches: [],
        divergences: [],
        coverage: {
          regions: [{ region: "argentina", sourceIds: [unknownSourceId] }],
          orientations: [{ orientation: "sin_clasificar", sourceIds: [unknownSourceId] }],
        },
        warnings: [{
          kind: "partial_coverage",
          message: "Cobertura parcial.",
          sourceIds: [unknownSourceId],
          evidenceFragmentIds: [unknownEvidenceId],
        }],
      },
    });
    const analyzer = createTriangulationAnalyzer({
      aiProvider,
      configurationRepository: { getEffectiveConfiguration: async () => ok(configuration) },
    });

    const result = await analyzer.analyze({ evidence });

    expect(result).toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("degrades an unverifiable claim without exposing its invented source", async () => {
    const unknownSourceId = "99999999-9999-4999-8999-999999999999";
    const unknownEvidenceId = "88888888-8888-4888-8888-888888888888";
    const analyzer = createTriangulationAnalyzer({
      aiProvider: createFakeAiGenerationPort({
        output: {
          ...structuredOutput,
          summary: {
            overview: "La segunda fuente informa el ingreso legislativo.",
            corroboratedClaims: [],
            attributedStatements: [{
              text: "La segunda fuente informó el ingreso legislativo.",
              attribution: "Según la segunda fuente.",
              sourceId: secondSourceId,
              evidenceFragmentIds: [secondEvidenceId],
            }],
          },
          matches: [{
            ...structuredOutput.matches[0],
            sourceIds: [sourceId, unknownSourceId],
            evidenceFragmentIds: [evidenceId, unknownEvidenceId],
          }],
          sources: [
            ...structuredOutput.sources,
            { sourceId: unknownSourceId, evidenceFragmentIds: [unknownEvidenceId] },
          ],
          coverage: {
            regions: [{ region: "argentina", sourceIds: [sourceId, secondSourceId] }],
            orientations: [{ orientation: "sin_clasificar", sourceIds: [sourceId, secondSourceId] }],
          },
          warnings: [
            {
              kind: "partial_coverage",
              message: "La cobertura disponible es parcial.",
              sourceIds: [],
              evidenceFragmentIds: [],
            },
            {
              kind: "partial_coverage",
              message: "Las fuentes disponibles son limitadas.",
              sourceIds: [],
              evidenceFragmentIds: [],
            },
            {
              kind: "asymmetric_coverage",
              message: "La cobertura se concentra en pocos medios.",
              sourceIds: [],
              evidenceFragmentIds: [],
            },
          ],
        },
      }),
      configurationRepository: { getEffectiveConfiguration: async () => ok(configuration) },
    });

    const result = await analyzer.analyze({ evidence, options: { maxItems: 3 } });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.triangulation.matches).toEqual([]);
      expect(result.value.triangulation.sources).toEqual(structuredOutput.sources);
      expect(result.value.triangulation.warnings).toHaveLength(3);
      expect(result.value.triangulation.warnings).toContainEqual(expect.objectContaining({
        kind: "partial_coverage",
        message: "Se omitieron afirmaciones cuya atribución no pudo verificarse.",
      }));
    }
  });

  it("rejects a provider response outside the triangulation schema", async () => {
    const analyzer = createTriangulationAnalyzer({
      aiProvider: createFakeAiGenerationPort({ output: { summary: "incompleto" } }),
      configurationRepository: { getEffectiveConfiguration: async () => ok(configuration) },
    });

    const result = await analyzer.analyze({ evidence });

    expect(result).toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it.each([
    ["timeout", new PortLimitExceededError("openai.responses.create", "timeoutMs")],
    ["rejection", new AiProviderRejectedError("openai", "openai.responses.create")],
    ["incomplete response", new PortLimitExceededError("openai.responses.create", "maxItems")],
  ])("propagates provider %s failures", async (_name, failure) => {
    const analyzer = createTriangulationAnalyzer({
      aiProvider: createFakeAiGenerationPort({ result: err(failure) }),
      configurationRepository: { getEffectiveConfiguration: async () => ok(configuration) },
    });

    await expect(analyzer.analyze({ evidence })).resolves.toEqual({ ok: false, error: failure });
  });

  it("enforces the input byte limit locally without persisting or sending a partial body", async () => {
    const aiProvider = createFakeAiGenerationPort({ output: structuredOutput });
    const analyzer = createTriangulationAnalyzer({
      aiProvider,
      configurationRepository: { getEffectiveConfiguration: async () => ok(configuration) },
    });

    const result = await analyzer.analyze({ evidence, options: { maxBytes: 32 } });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ type: "PortLimitExceeded", limitName: "maxBytes" }),
    });
    expect(aiProvider.calls.generateStructuredResponse).toHaveLength(0);
  });

  it("rejects a zero output-item limit before contacting the provider", async () => {
    const aiProvider = createFakeAiGenerationPort({ output: structuredOutput });
    const analyzer = createTriangulationAnalyzer({
      aiProvider,
      configurationRepository: { getEffectiveConfiguration: async () => ok(configuration) },
    });

    const result = await analyzer.analyze({ evidence, options: { maxItems: 0 } });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ type: "PortLimitExceeded", limitName: "maxItems" }),
    });
    expect(aiProvider.calls.generateStructuredResponse).toHaveLength(0);
  });

  it("enforces the requested maximum for matches after the provider responds", async () => {
    const analyzer = createTriangulationAnalyzer({
      aiProvider: createFakeAiGenerationPort({
        output: {
          ...structuredOutput,
          matches: [
            ...structuredOutput.matches,
            structuredOutput.matches[0]!,
            structuredOutput.matches[0]!,
          ],
        },
      }),
      configurationRepository: { getEffectiveConfiguration: async () => ok(configuration) },
    });

    const result = await analyzer.analyze({ evidence, options: { maxItems: 2 } });

    expect(result).toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("enforces the requested maximum for divergence positions after the provider responds", async () => {
    const analyzer = createTriangulationAnalyzer({
      aiProvider: createFakeAiGenerationPort({
        output: {
          ...structuredOutput,
          matches: [],
          divergences: [{
            id: "66666666-6666-4666-8666-666666666666",
            contrast: "Las fuentes describen prioridades distintas.",
            positions: [
              { sourceId, claim: "Primera posición.", evidenceFragmentIds: [evidenceId] },
              { sourceId: secondSourceId, claim: "Segunda posición.", evidenceFragmentIds: [secondEvidenceId] },
              { sourceId, claim: "Tercera posición.", evidenceFragmentIds: [evidenceId] },
            ],
          }],
        },
      }),
      configurationRepository: { getEffectiveConfiguration: async () => ok(configuration) },
    });

    const result = await analyzer.analyze({ evidence, options: { maxItems: 2 } });

    expect(result).toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("enforces the requested maximum for coverage lists after the provider responds", async () => {
    const analyzer = createTriangulationAnalyzer({
      aiProvider: createFakeAiGenerationPort({
        output: {
          ...structuredOutput,
          coverage: {
            regions: [
              { region: "argentina", sourceIds: [sourceId] },
              { region: "latin_america", sourceIds: [secondSourceId] },
              { region: "international", sourceIds: [sourceId, secondSourceId] },
            ],
            orientations: structuredOutput.coverage.orientations,
          },
        },
      }),
      configurationRepository: { getEffectiveConfiguration: async () => ok(configuration) },
    });

    const result = await analyzer.analyze({ evidence, options: { maxItems: 2 } });

    expect(result).toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("rejects provider citations whose URLs are absent from the input evidence", async () => {
    const analyzer = createTriangulationAnalyzer({
      aiProvider: createFakeAiGenerationPort({
        output: structuredOutput,
        citations: [{ url: "https://fuente-inexistente.example/noticia" as never }],
      }),
      configurationRepository: { getEffectiveConfiguration: async () => ok(configuration) },
    });

    const result = await analyzer.analyze({ evidence });

    expect(result).toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });
});
