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
const neutralText = "El proyecto del Gobierno busca imponer una medida.";

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

  it("rejects neutral text with content not covered by a source position", async () => {
    const text = "El Congreso debatió el proyecto.";
    const positionText = "El Congreso debatió el proyecto.";
    const { analyzer } = analyzerFor({
      neutralText: `${positionText} La economía creció.`,
      changes: [],
      positions: [{ sourceSegmentIds: ["segment-1"], neutralText: positionText }],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("rejects a position representation that adds an external statement", async () => {
    const text = "El Congreso debatió el proyecto.";
    const neutralText = "El Congreso debatió el proyecto. La economía creció.";
    const { analyzer } = analyzerFor({
      neutralText,
      changes: [],
      positions: [{ sourceSegmentIds: ["segment-1"], neutralText }],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("rejects external context added within a single position sentence", async () => {
    const text = "El Congreso debatió el proyecto.";
    const neutralText = "El Congreso debatió el proyecto durante una reunión que confirmó el crecimiento económico.";
    const { analyzer } = analyzerFor({
      neutralText,
      changes: [],
      positions: [{ sourceSegmentIds: ["segment-1"], neutralText }],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("rejects a replacement that introduces a different fact", async () => {
    const text = "El Congreso debatió el proyecto.";
    const neutralText = "El Congreso aprobó el proyecto.";
    const { analyzer } = analyzerFor({
      neutralText,
      changes: [],
      positions: [{ sourceSegmentIds: ["segment-1"], neutralText }],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("rejects an omitted position after a contrastive clause", async () => {
    const text = "El Gobierno propuso reducir impuestos, pero la oposición afirmó que afectaría la recaudación.";
    const neutralText = "El Gobierno propuso reducir impuestos.";
    const { analyzer } = analyzerFor({
      neutralText,
      changes: [],
      positions: [{ sourceSegmentIds: ["segment-1"], neutralText }],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("rejects an omitted position after a coordinated attributed clause", async () => {
    const text = "El Gobierno propuso reducir impuestos y la oposición afirmó que afectaría la recaudación.";
    const neutralText = "El Gobierno propuso reducir impuestos.";
    const { analyzer } = analyzerFor({
      neutralText,
      changes: [],
      positions: [{ sourceSegmentIds: ["segment-1"], neutralText }],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("rejects an omitted position after a coordinated material clause", async () => {
    const text = "El diputado votó a favor y la senadora votó en contra.";
    const neutralText = "El diputado votó a favor.";
    const { analyzer } = analyzerFor({
      neutralText,
      changes: [],
      positions: [{ sourceSegmentIds: ["segment-1"], neutralText }],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("rejects an omitted position after a coordinated present-tense clause", async () => {
    const text = "El diputado vota a favor y la senadora vota en contra.";
    const neutralText = "El diputado vota a favor.";
    const { analyzer } = analyzerFor({
      neutralText,
      changes: [],
      positions: [{ sourceSegmentIds: ["segment-1"], neutralText }],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
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

  it("accepts an attributed representation with a present-tense reporting verb", async () => {
    const text = "El bloque plantea reducir impuestos.";
    const neutralText = "El bloque propone reducir impuestos.";
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

  it("accepts a neutral rewrite of a declarative clause that is not attributed", async () => {
    const text = "El proyecto establece que la inscripción es obligatoria.";
    const neutralText = "El proyecto vuelve obligatoria la inscripción.";
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

  it.each([
    "La oposición denunció que la reforma recorta derechos laborales.",
    "La oposición acusó al Gobierno de recortar derechos laborales.",
  ])("rejects an attributed statement when its subject is removed: %s", async (text) => {
    const neutralText = "La reforma recorta derechos laborales.";
    const { analyzer } = analyzerFor({
      neutralText,
      changes: [],
      positions: [{ sourceSegmentIds: ["segment-1"], neutralText }],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("rejects an attribution after a noun that shares a reporting-verb root", async () => {
    const text = "Los negociadores afirmaron que no aceptarán el acuerdo.";
    const neutralText = "No aceptarán el acuerdo.";
    const { analyzer } = analyzerFor({
      neutralText,
      changes: [],
      positions: [{ sourceSegmentIds: ["segment-1"], neutralText }],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
    });
  });

  it("rejects a según attribution when its subject is removed", async () => {
    const text = "Según la oposición, la reforma recorta derechos laborales.";
    const neutralText = "La reforma recorta derechos laborales.";
    const { analyzer } = analyzerFor({
      neutralText,
      changes: [],
      positions: [{ sourceSegmentIds: ["segment-1"], neutralText }],
    });

    await expect(analyzer.rewrite({ text })).resolves.toEqual({
      ok: false,
      error: expect.any(AiInvalidStructuredOutputError),
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
