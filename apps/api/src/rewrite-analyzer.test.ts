import {
  AiCapabilityUnavailableError,
  AiInvalidStructuredOutputError,
  AiProviderRejectedError,
  PortCancelledError,
  PortLimitExceededError,
  createFakeAiGenerationPort,
  err,
  initialAiProviderCatalogSnapshot,
  isOk,
  ok,
  type EffectiveAiProviderConfiguration,
} from "app-domain";
import { describe, expect, it } from "vitest";

import { createRewriteAnalyzer } from "./rewrite-analyzer.js";

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

const biasedText = "El desastroso proyecto del Gobierno busca imponer una medida absurda.";
const neutralText = "El proyecto del Gobierno propone una medida.";

const change = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "evaluative_language",
  originalText: "desastroso",
  neutralText: "cuestionado",
  justification: "El término expresa una valoración no atribuida.",
};

const structuredOutput = {
  neutralText,
  changes: [change],
  positions: [{
    sourceSegmentIds: ["segment-1"],
    neutralText,
  }],
};

const analyzerFor = (output: unknown = structuredOutput) => {
  const aiProvider = createFakeAiGenerationPort({ output: output as never });
  const analyzer = createRewriteAnalyzer({
    aiProvider,
    configurationRepository: { getEffectiveConfiguration: async () => ok(configuration) },
  });

  return { aiProvider, analyzer };
};

describe("rewrite analyzer", () => {
  it("rewrites biased text through the active structured-output model", async () => {
    const { aiProvider, analyzer } = analyzerFor();

    const result = await analyzer.rewrite({
      text: biasedText,
      options: { timeoutMs: 1_000, maxBytes: 8_192, maxItems: 4 },
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({
        neutralText,
        changes: [change],
        warnings: [],
      });
    }
    expect(aiProvider.calls.generateStructuredResponse).toEqual([
      expect.objectContaining({
        selection: configuration.activeSelection,
        requiredCapabilities: ["structured_outputs"],
        options: { timeoutMs: 1_000, maxBytes: 8_192, maxItems: 4 },
      }),
    ]);
    expect(aiProvider.calls.generateStructuredResponse[0]?.prompt).toContain(biasedText);
    expect(aiProvider.calls.generateStructuredResponse[0]?.prompt).toContain("segment-1");
    expect(aiProvider.calls.searchWeb).toEqual([]);
  });

  it("accepts an already neutral text without changes", async () => {
    const text = "El bloque presentó el proyecto ante el Congreso.";
    const { aiProvider, analyzer } = analyzerFor({
      neutralText: text,
      changes: [],
      positions: [{ sourceSegmentIds: ["segment-1"], neutralText: text }],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: true,
      value: { neutralText: text, changes: [], warnings: [] },
    });
  });

  it("rejects a response that omits one of several source positions", async () => {
    const text = "El Gobierno afirmó que la reforma reduce impuestos. La oposición sostuvo que recorta derechos.";
    const { aiProvider, analyzer } = analyzerFor({
      neutralText: text,
      changes: [],
      positions: [{
        sourceSegmentIds: ["segment-1"],
        neutralText: "El Gobierno afirmó que la reforma reduce impuestos.",
      }],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("rejects one neutral representation assigned to several source positions", async () => {
    const text = "El Gobierno afirmó que la reforma reduce impuestos. La oposición sostuvo que recorta derechos.";
    const neutralPosition = "El Gobierno afirmó que la reforma reduce impuestos.";
    const { analyzer } = analyzerFor({
      neutralText: neutralPosition,
      changes: [],
      positions: [{
        sourceSegmentIds: ["segment-1", "segment-2"],
        neutralText: neutralPosition,
      }],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("rejects repeated neutral representations for separate source positions", async () => {
    const text = "El Gobierno afirmó que la reforma reduce impuestos. La oposición sostuvo que recorta derechos.";
    const neutralPosition = "El Gobierno afirmó que la reforma reduce impuestos.";
    const { analyzer } = analyzerFor({
      neutralText: neutralPosition,
      changes: [],
      positions: [
        { sourceSegmentIds: ["segment-1"], neutralText: neutralPosition },
        { sourceSegmentIds: ["segment-2"], neutralText: neutralPosition },
      ],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("rejects a generic representation that omits a source position's content", async () => {
    const text = "El Gobierno afirmó que la reforma reduce impuestos. La oposición sostuvo que recorta derechos.";
    const { analyzer } = analyzerFor({
      neutralText: "El Gobierno afirmó que la reforma reduce impuestos. El tema generó debate.",
      changes: [],
      positions: [
        {
          sourceSegmentIds: ["segment-1"],
          neutralText: "El Gobierno afirmó que la reforma reduce impuestos.",
        },
        {
          sourceSegmentIds: ["segment-2"],
          neutralText: "El tema generó debate.",
        },
      ],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("rejects a representation that removes a material attribution", async () => {
    const text = "La oposición sostuvo que la reforma recorta derechos laborales.";
    const { analyzer } = analyzerFor({
      neutralText: "La reforma recorta derechos laborales.",
      changes: [],
      positions: [{
        sourceSegmentIds: ["segment-1"],
        neutralText: "La reforma recorta derechos laborales.",
      }],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("accepts an attributed representation with a different reporting verb", async () => {
    const text = "La oposición sostuvo que la reforma recorta derechos laborales.";
    const neutralText = "La oposición afirmó que la reforma recorta derechos laborales.";
    const { analyzer } = analyzerFor({
      neutralText,
      changes: [],
      positions: [{ sourceSegmentIds: ["segment-1"], neutralText }],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: true,
      value: { neutralText, changes: [], warnings: [] },
    });
  });

  it("enforces the requested maximum for changes after the provider responds", async () => {
    const text = "El polémico y costoso proyecto fue presentado.";
    const neutralPosition = "El proyecto fue presentado.";
    const { aiProvider, analyzer } = analyzerFor({
      neutralText: neutralPosition,
      changes: [
        {
          ...change,
          originalText: "polémico",
          neutralText: "cuestionado",
        },
        {
          ...change,
          id: "22222222-2222-4222-8222-222222222222",
          originalText: "costoso",
          neutralText: "de alto costo",
        },
      ],
      positions: [{ sourceSegmentIds: ["segment-1"], neutralText: neutralPosition }],
    });

    await expect(analyzer.rewrite({ text, options: { maxItems: 1 } })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
    expect(aiProvider.calls.generateStructuredResponse[0]?.outputSchema).toMatchObject({
      properties: {
        changes: { maxItems: 1 },
        positions: { maxItems: 1 },
      },
    });
  });

  it("rejects a response outside the rewrite schema", async () => {
    const { analyzer } = analyzerFor({ neutralText, changes: [] });

    await expect(analyzer.rewrite({ text: biasedText })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("rejects an active model without structured outputs before contacting the provider", async () => {
    const aiProvider = createFakeAiGenerationPort({ output: structuredOutput });
    const analyzer = createRewriteAnalyzer({
      aiProvider,
      configurationRepository: {
        getEffectiveConfiguration: async () => ok({
          ...configuration,
          models: [{ ...configuration.models[0]!, capabilities: ["reasoning_high"] }],
        }),
      },
    });

    await expect(analyzer.rewrite({ text: biasedText })).resolves.toEqual({
      ok: false,
      error: expect.any(AiCapabilityUnavailableError),
    });
    expect(aiProvider.calls.generateStructuredResponse).toEqual([]);
  });

  it("enforces the input byte limit locally without sending the text", async () => {
    const { aiProvider, analyzer } = analyzerFor();

    await expect(analyzer.rewrite({ text: biasedText, options: { maxBytes: 16 } })).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ type: "PortLimitExceeded", limitName: "maxBytes" }),
    });
    expect(aiProvider.calls.generateStructuredResponse).toEqual([]);
  });

  it.each([
    ["timeout", new PortLimitExceededError("openai.responses.create", "timeoutMs")],
    ["rejection", new AiProviderRejectedError("openai", "openai.responses.create")],
    ["cancellation", new PortCancelledError("openai.responses.create")],
  ])("propagates provider %s", async (_name, failure) => {
    const aiProvider = createFakeAiGenerationPort({ result: err(failure) });
    const analyzer = createRewriteAnalyzer({
      aiProvider,
      configurationRepository: { getEffectiveConfiguration: async () => ok(configuration) },
    });

    await expect(analyzer.rewrite({ text: biasedText })).resolves.toEqual({
      ok: false,
      error: failure,
    });
  });

  it("stops before reading configuration when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { aiProvider, analyzer } = analyzerFor();

    await expect(analyzer.rewrite({ text: biasedText, options: { signal: controller.signal } })).resolves.toEqual({
      ok: false,
      error: expect.any(PortCancelledError),
    });
    expect(aiProvider.calls.generateStructuredResponse).toEqual([]);
  });
});
