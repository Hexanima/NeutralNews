import {
  createRuntimeEvidenceFragment,
  createTriangulationResult,
  isErr,
  isOk,
  parseTriangulationStructuredOutput,
  type EvidenceFragment,
  type TriangulationStructuredOutput,
  type UUID,
} from "../index.js";
import { describe, expect, it } from "vitest";

import {
  InvalidTriangulationAttributionError,
  verifyTriangulationAttributions,
  verifyTriangulationResultAttributions,
} from "./triangulation-attribution-verifier.js";

const firstSourceId = "11111111-1111-4111-8111-111111111111" as UUID;
const secondSourceId = "22222222-2222-4222-8222-222222222222" as UUID;
const thirdSourceId = "55555555-5555-4555-8555-555555555555" as UUID;
const inventedSourceId = "99999999-9999-4999-8999-999999999999" as UUID;
const firstEvidenceId = "33333333-3333-4333-8333-333333333333" as UUID;
const secondEvidenceId = "44444444-4444-4444-8444-444444444444" as UUID;
const thirdEvidenceId = "66666666-6666-4666-8666-666666666666" as UUID;
const inventedEvidenceId = "88888888-8888-4888-8888-888888888888" as UUID;

const evidence = [
  createRuntimeEvidenceFragment({
    id: firstEvidenceId,
    text: "El Congreso recibió el proyecto.",
    provenance: {
      articleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sourceId: firstSourceId,
      url: "https://first.example/politica/proyecto",
      contentKind: "extracted_body",
    },
    quality: { contentLevel: "complete" },
  }),
  createRuntimeEvidenceFragment({
    id: secondEvidenceId,
    text: "La iniciativa ingresó para su tratamiento.",
    provenance: {
      articleId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sourceId: secondSourceId,
      url: "https://second.example/politica/proyecto",
      contentKind: "rss_summary",
    },
    quality: { contentLevel: "partial" },
  }),
  createRuntimeEvidenceFragment({
    id: thirdEvidenceId,
    text: "El debate continúa en comisión.",
    provenance: {
      articleId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      sourceId: thirdSourceId,
      url: "https://third.example/politica/proyecto",
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

const validOutput = {
  summary: {
    overview: "Las coberturas coinciden en el ingreso del proyecto.",
    corroboratedClaims: [{
      text: "El proyecto ingresó al Congreso.",
      sourceIds: [firstSourceId, secondSourceId],
      evidenceFragmentIds: [firstEvidenceId, secondEvidenceId],
    }],
    attributedStatements: [],
  },
  matches: [{
    id: "55555555-5555-4555-8555-555555555555" as UUID,
    text: "Ambas fuentes informan el ingreso legislativo.",
    sourceIds: [firstSourceId, secondSourceId],
    evidenceFragmentIds: [firstEvidenceId, secondEvidenceId],
  }],
  divergences: [],
  sources: [
    { sourceId: firstSourceId, evidenceFragmentIds: [firstEvidenceId] },
    { sourceId: secondSourceId, evidenceFragmentIds: [secondEvidenceId] },
  ],
  coverage: {
    regions: [{ region: "argentina" as const, sourceIds: [firstSourceId, secondSourceId] }],
    orientations: [{ orientation: "sin_clasificar" as const, sourceIds: [firstSourceId, secondSourceId] }],
  },
  warnings: [],
} satisfies TriangulationStructuredOutput;

const parsed = (output: TriangulationStructuredOutput): TriangulationStructuredOutput => {
  const result = parseTriangulationStructuredOutput(output);

  if (!result.ok) {
    throw result.error;
  }

  return result.value;
};

const resultValue = <TValue>(result: { readonly ok: true; readonly value: TValue } | { readonly ok: false }): TValue => {
  if (!result.ok) {
    throw new Error("Expected a valid triangulation fixture");
  }

  return result.value;
};

describe("triangulation attribution verifier", () => {
  it("preserves correctly attributed results", () => {
    const result = verifyTriangulationAttributions({
      output: parsed(validOutput),
      evidence,
      maximumItems: 6,
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual(validOutput);
    }
  });

  it("removes a claim backed by evidence absent from the input and adds a warning", () => {
    const output = parsed({
      ...validOutput,
      summary: {
        ...validOutput.summary,
        corroboratedClaims: [],
      },
      matches: [{
        ...validOutput.matches[0],
        sourceIds: [firstSourceId, inventedSourceId],
        evidenceFragmentIds: [firstEvidenceId, inventedEvidenceId],
      }],
      sources: [
        validOutput.sources[0],
        validOutput.sources[1],
        { sourceId: inventedSourceId, evidenceFragmentIds: [inventedEvidenceId] },
      ],
      coverage: {
        regions: [{ region: "argentina", sourceIds: [firstSourceId, secondSourceId] }],
        orientations: [{ orientation: "sin_clasificar", sourceIds: [firstSourceId, secondSourceId] }],
      },
    });

    const result = verifyTriangulationAttributions({ output, evidence, maximumItems: 6 });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.matches).toEqual([]);
      expect(result.value.sources).toEqual(validOutput.sources);
      expect(result.value.warnings).toContainEqual(expect.objectContaining({
        kind: "partial_coverage",
      }));
    }
  });

  it("removes a divergence position attributed to the wrong medium and adds a warning", () => {
    const output = parsed({
      ...validOutput,
      summary: {
        overview: validOutput.summary.overview,
        corroboratedClaims: [],
        attributedStatements: [{
          text: "El tercer medio informó que el debate continúa.",
          attribution: "Según el tercer medio.",
          sourceId: thirdSourceId,
          evidenceFragmentIds: [thirdEvidenceId],
        }],
      },
      matches: [],
      divergences: [{
        id: "66666666-6666-4666-8666-666666666666" as UUID,
        contrast: "Las coberturas priorizan aspectos distintos.",
        positions: [
          {
            sourceId: firstSourceId,
            claim: "El primer medio enfatiza una consecuencia.",
            evidenceFragmentIds: [secondEvidenceId],
          },
          {
            sourceId: thirdSourceId,
            claim: "El tercer medio enfatiza la continuidad del debate.",
            evidenceFragmentIds: [thirdEvidenceId],
          },
        ],
      }],
      sources: [
        { sourceId: firstSourceId, evidenceFragmentIds: [secondEvidenceId] },
        { sourceId: thirdSourceId, evidenceFragmentIds: [thirdEvidenceId] },
      ],
      coverage: {
        regions: [{ region: "argentina", sourceIds: [thirdSourceId] }],
        orientations: [{ orientation: "sin_clasificar", sourceIds: [thirdSourceId] }],
      },
    });

    const result = verifyTriangulationAttributions({ output, evidence, maximumItems: 6 });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.divergences).toEqual([]);
      expect(result.value.sources).toEqual([
        { sourceId: thirdSourceId, evidenceFragmentIds: [thirdEvidenceId] },
      ]);
      expect(result.value.warnings).toContainEqual(expect.objectContaining({
        kind: "partial_coverage",
      }));
    }
  });

  it("returns a controlled error when no attributable source remains", () => {
    const output = parsed({
      ...validOutput,
      summary: {
        overview: "La única cobertura disponible no puede atribuirse.",
        corroboratedClaims: [],
        attributedStatements: [{
          text: "Una fuente inexistente sostiene una afirmación.",
          attribution: "Según una fuente inexistente.",
          sourceId: inventedSourceId,
          evidenceFragmentIds: [inventedEvidenceId],
        }],
      },
      matches: [],
      divergences: [],
      sources: [{ sourceId: inventedSourceId, evidenceFragmentIds: [inventedEvidenceId] }],
      coverage: {
        regions: [{ region: "argentina", sourceIds: [inventedSourceId] }],
        orientations: [{ orientation: "sin_clasificar", sourceIds: [inventedSourceId] }],
      },
      warnings: [{
        kind: "partial_coverage",
        message: "Cobertura parcial.",
        sourceIds: [inventedSourceId],
        evidenceFragmentIds: [inventedEvidenceId],
      }],
    });

    const result = verifyTriangulationAttributions({ output, evidence, maximumItems: 6 });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(InvalidTriangulationAttributionError);
    }
  });

  it("rejects a divergence position that omits evidence for one of its cited sources", () => {
    const triangulation = resultValue(createTriangulationResult({
      summary: "Las fuentes describen prioridades distintas.",
      matches: [],
      divergences: [{
        id: "77777777-7777-4777-8777-777777777777" as UUID,
        text: "Las coberturas enfatizan aspectos diferentes.",
        positions: [
          {
            text: "Dos medios describen el ingreso legislativo.",
            sourceIds: [firstSourceId, secondSourceId],
            evidenceFragmentIds: [firstEvidenceId],
          },
          {
            text: "El tercer medio enfatiza la continuidad del debate.",
            sourceIds: [thirdSourceId],
            evidenceFragmentIds: [thirdEvidenceId],
          },
        ],
      }],
      sources: [
        { sourceId: firstSourceId, evidenceFragmentIds: [firstEvidenceId] },
        { sourceId: secondSourceId, evidenceFragmentIds: [secondEvidenceId] },
        { sourceId: thirdSourceId, evidenceFragmentIds: [thirdEvidenceId] },
      ],
      warnings: [],
    }));

    const result = verifyTriangulationResultAttributions({ triangulation, evidence });

    expect(isErr(result)).toBe(true);
  });
});
