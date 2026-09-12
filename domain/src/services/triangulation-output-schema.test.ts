import { describe, expect, it } from "vitest";

import {
  isErr,
  isOk,
  parseTriangulationStructuredOutput,
  triangulationOutputSchema,
  triangulationOutputSchemaVersion,
} from "../index.js";

const sourceId = "11111111-1111-4111-8111-111111111111";
const secondSourceId = "22222222-2222-4222-8222-222222222222";
const evidenceId = "33333333-3333-4333-8333-333333333333";
const secondEvidenceId = "44444444-4444-4444-8444-444444444444";

const validOutput = {
  summary: {
    overview: "Las coberturas coinciden en el anuncio y describen alcances distintos.",
    corroboratedClaims: [
      {
        text: "La medida fue anunciada oficialmente.",
        sourceIds: [sourceId, secondSourceId],
        evidenceFragmentIds: [evidenceId, secondEvidenceId],
      },
    ],
    attributedStatements: [
      {
        text: "La medida tendrá un costo fiscal elevado.",
        attribution: "Según el medio, tendrá un costo fiscal elevado.",
        sourceId,
        evidenceFragmentIds: [evidenceId],
      },
    ],
  },
  matches: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      text: "Ambas coberturas mencionan el anuncio oficial.",
      sourceIds: [sourceId, secondSourceId],
      evidenceFragmentIds: [evidenceId, secondEvidenceId],
    },
  ],
  divergences: [
    {
      id: "66666666-6666-4666-8666-666666666666",
      contrast: "Las coberturas difieren sobre el alcance de la medida.",
      positions: [
        {
          sourceId,
          claim: "El medio enfatiza el costo fiscal.",
          evidenceFragmentIds: [evidenceId],
        },
        {
          sourceId: secondSourceId,
          claim: "El medio enfatiza el alcance territorial.",
          evidenceFragmentIds: [secondEvidenceId],
        },
      ],
    },
  ],
  sources: [
    { sourceId, evidenceFragmentIds: [evidenceId] },
    { sourceId: secondSourceId, evidenceFragmentIds: [secondEvidenceId] },
  ],
  coverage: {
    regions: [
      { region: "argentina", sourceIds: [sourceId] },
      { region: "international", sourceIds: [secondSourceId] },
    ],
    orientations: [
      { orientation: "centroizquierda", sourceIds: [sourceId] },
      { orientation: "centroderecha", sourceIds: [secondSourceId] },
    ],
  },
  warnings: [],
};

describe("triangulation structured output", () => {
  it("parses a complete, attributable triangulation output", () => {
    const result = parseTriangulationStructuredOutput(validOutput);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.summary.overview).toContain("coberturas");
      expect(result.value.summary.corroboratedClaims[0]?.sourceIds).toEqual([
        sourceId,
        secondSourceId,
      ]);
      expect(result.value.summary.attributedStatements[0]?.attribution).toContain(
        "Según",
      );
      expect(result.value.divergences[0]?.positions[0]?.sourceId).toBe(sourceId);
      expect(result.value.coverage.regions).toHaveLength(2);
      expect(result.value.coverage.orientations).toHaveLength(2);
    }
  });

  it.each([
    ["references to sources and evidence absent from sources", { ...validOutput, sources: [] }],
    ["a coincidence with one source", { ...validOutput, matches: [{ ...validOutput.matches[0], sourceIds: [sourceId], evidenceFragmentIds: [evidenceId] }] }],
    ["a divergence without its medium", { ...validOutput, divergences: [{ ...validOutput.divergences[0], positions: [{ ...validOutput.divergences[0].positions[0], sourceId: undefined }] }] }],
    ["an attributed statement without attribution", { ...validOutput, summary: { ...validOutput.summary, attributedStatements: [{ ...validOutput.summary.attributedStatements[0], attribution: "" }] } }],
    ["coverage without orientation", { ...validOutput, coverage: { ...validOutput.coverage, orientations: [{ sourceIds: [sourceId] }] } }],
    ["an unknown root property", { ...validOutput, invented: true }],
  ])("rejects %s", (_description, output) => {
    expect(isErr(parseTriangulationStructuredOutput(output))).toBe(true);
  });

  it("publishes a strict, versioned JSON Schema", () => {
    expect(triangulationOutputSchemaVersion).toBe("1");
    expect(triangulationOutputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: [
        "summary",
        "matches",
        "divergences",
        "sources",
        "coverage",
        "warnings",
      ],
    });
  });

  it("rejects whitespace-only text with the parser and schema pattern", () => {
    const output = {
      ...validOutput,
      summary: { ...validOutput.summary, overview: "   " },
    };

    expect(isErr(parseTriangulationStructuredOutput(output))).toBe(true);
    expect(
      (triangulationOutputSchema.properties.summary.properties.overview as {
        pattern: string;
      }).pattern,
    ).toBe("\\S");
  });

  it("rejects padded UUIDs with the parser and schema pattern", () => {
    const output = {
      ...validOutput,
      sources: [{ ...validOutput.sources[0], sourceId: ` ${sourceId} ` }, validOutput.sources[1]],
    };

    expect(isErr(parseTriangulationStructuredOutput(output))).toBe(true);
    expect(new RegExp(String(
      (triangulationOutputSchema.properties.sources.items.properties.sourceId as { pattern: string }).pattern,
    )).test(` ${sourceId} `)).toBe(false);
  });

});
