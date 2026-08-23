import { describe, expect, it } from "vitest";

import {
  createContextResult,
  createFeedResult,
  createRewriteResult,
  createTriangulationResult,
  isErr,
  isOk,
  toContextResultSnapshot,
  toFeedResultSnapshot,
  toRewriteResultSnapshot,
  toTriangulationResultSnapshot,
} from "../index.js";
import type {
  ContextResultSnapshot,
  FeedResultSnapshot,
  RewriteResultSnapshot,
  TriangulationResultSnapshot,
} from "../index.js";

const sourceId = "11111111-1111-4111-8111-111111111111";
const secondSourceId = "22222222-2222-4222-8222-222222222222";
const evidenceFragmentId = "33333333-3333-4333-8333-333333333333";
const secondEvidenceFragmentId = "44444444-4444-4444-8444-444444444444";
const factualSourceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const factualEvidenceFragmentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const validSources = [
  {
    sourceId,
    evidenceFragmentIds: [evidenceFragmentId],
  },
  {
    sourceId: secondSourceId,
    evidenceFragmentIds: [secondEvidenceFragmentId],
  },
];

const validTriangulationInput: TriangulationResultSnapshot = {
  summary: "Dos medios coinciden en el anuncio y difieren sobre su alcance.",
  matches: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      text: "Ambas coberturas mencionan que la medida fue anunciada oficialmente.",
      sourceIds: [sourceId, secondSourceId],
      evidenceFragmentIds: [evidenceFragmentId, secondEvidenceFragmentId],
    },
  ],
  divergences: [
    {
      id: "66666666-6666-4666-8666-666666666666",
      text: "Las coberturas atribuyen alcances distintos a la medida.",
      positions: [
        {
          text: "Una cobertura enfatiza el costo fiscal.",
          sourceIds: [sourceId],
          evidenceFragmentIds: [evidenceFragmentId],
        },
        {
          text: "Otra cobertura enfatiza el alcance territorial.",
          sourceIds: [secondSourceId],
          evidenceFragmentIds: [secondEvidenceFragmentId],
        },
      ],
    },
  ],
  sources: validSources,
  warnings: [
    {
      kind: "asymmetric_coverage",
      message:
        "La cobertura disponible se concentra en una orientacion editorial.",
      sourceIds: [sourceId],
    },
  ],
};

const validRewriteInput: RewriteResultSnapshot = {
  neutralText: "El proyecto fue presentado por el bloque oficialista.",
  changes: [
    {
      id: "77777777-7777-4777-8777-777777777777",
      originalText: "El polemico proyecto fue lanzado por el oficialismo.",
      neutralText: "El proyecto fue presentado por el bloque oficialista.",
      justification: "Se quito lenguaje valorativo no atribuido.",
    },
  ],
  warnings: [],
};

const validContextInput: ContextResultSnapshot = {
  factualContext: {
    summary: "La norma regula un esquema vigente desde 2024.",
    sources: [
      {
        sourceId: factualSourceId,
        evidenceFragmentIds: [factualEvidenceFragmentId],
      },
    ],
    points: [
      {
        id: "88888888-8888-4888-8888-888888888888",
        text: "El esquema fue aprobado por ley nacional.",
        evidenceFragmentIds: [factualEvidenceFragmentId],
      },
    ],
  },
  mediaCoverage: validTriangulationInput,
  warnings: [],
};

const validFeedInput: FeedResultSnapshot = {
  generatedAt: "2026-07-25T12:30:00.000Z",
  status: "fresh",
  topics: [
    {
      id: "99999999-9999-4999-8999-999999999999",
      title: "Reforma legislativa",
      summary: "El tema aparece en coberturas de distintas fuentes.",
      result: validTriangulationInput,
      warnings: [],
    },
  ],
  warnings: [],
};

describe("Editorial result contracts", () => {
  it("creates a triangulation result with summary, matches, divergences, sources, and warnings", () => {
    const result = createTriangulationResult(validTriangulationInput);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.summary).toBe(validTriangulationInput.summary);
      expect(result.value.matches).toHaveLength(1);
      expect(result.value.divergences).toHaveLength(1);
      expect(result.value.divergences[0]?.positions).toHaveLength(2);
      expect(result.value.divergences[0]?.positions[0]?.sourceIds).toEqual([
        sourceId,
      ]);
      expect(result.value.sources).toHaveLength(2);
      expect(result.value.warnings[0]?.kind).toBe("asymmetric_coverage");
    }
  });

  it.each(["insufficient_evidence", "partial_coverage"] as const)(
    "accepts empty triangulation only when it declares %s",
    (kind) => {
      const result = createTriangulationResult({
        summary: "No hay evidencia suficiente para comparar coberturas.",
        matches: [],
        divergences: [],
        sources: [],
        warnings: [
          {
            kind,
            message: "La cobertura disponible no alcanza para triangular.",
          },
        ],
      });

      expect(isOk(result)).toBe(true);
    },
  );

  it("rejects empty triangulation without insufficient or partial coverage warning", () => {
    const result = createTriangulationResult({
      summary: "No hay evidencia suficiente para comparar coberturas.",
      matches: [],
      divergences: [],
      sources: [],
      warnings: [
        {
          kind: "asymmetric_coverage",
          message: "La cobertura se concentra en una fuente.",
        },
      ],
    });

    expect(isErr(result)).toBe(true);
  });

  it("rejects warnings with invalid kind, empty message, or invalid references", () => {
    const invalidKind = createTriangulationResult({
      ...validTriangulationInput,
      warnings: [
        {
          kind: "verified_fact",
          message: "No se debe aceptar lenguaje de verificacion.",
        },
      ],
    } as unknown as TriangulationResultSnapshot);
    const emptyMessage = createTriangulationResult({
      ...validTriangulationInput,
      warnings: [{ kind: "partial_coverage", message: " " }],
    });
    const invalidReference = createTriangulationResult({
      ...validTriangulationInput,
      warnings: [
        {
          kind: "partial_coverage",
          message: "Referencia invalida.",
          evidenceFragmentIds: ["not-a-uuid"],
        },
      ],
    });

    expect(isErr(invalidKind)).toBe(true);
    expect(isErr(emptyMessage)).toBe(true);
    expect(isErr(invalidReference)).toBe(true);
  });

  it("returns an editorial error when nested arrays contain non-record items", () => {
    const result = createTriangulationResult({
      ...validTriangulationInput,
      warnings: [null],
    } as unknown as TriangulationResultSnapshot);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.type).toBe("InvalidEditorialResult");
    }
  });

  it("rejects references to sources or evidence not present in the result", () => {
    const result = createTriangulationResult({
      ...validTriangulationInput,
      matches: [
        {
          ...validTriangulationInput.matches[0],
          sourceIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
        },
      ],
    });

    expect(isErr(result)).toBe(true);
  });

  it("rejects a match supported by a single source", () => {
    const result = createTriangulationResult({
      ...validTriangulationInput,
      matches: [
        {
          ...validTriangulationInput.matches[0],
          sourceIds: [sourceId],
          evidenceFragmentIds: [evidenceFragmentId],
        },
      ],
    });

    expect(isErr(result)).toBe(true);
  });

  it("rejects a divergence without at least two attributed positions", () => {
    const result = createTriangulationResult({
      ...validTriangulationInput,
      divergences: [
        {
          ...validTriangulationInput.divergences[0],
          positions: [validTriangulationInput.divergences[0].positions[0]],
        },
      ],
    });

    expect(isErr(result)).toBe(true);
  });

  it("rejects a divergence whose positions do not contrast at least two sources", () => {
    const result = createTriangulationResult({
      ...validTriangulationInput,
      divergences: [
        {
          ...validTriangulationInput.divergences[0],
          positions: [
            {
              text: "Una cobertura enfatiza el costo fiscal.",
              sourceIds: [sourceId],
              evidenceFragmentIds: [evidenceFragmentId],
            },
            {
              text: "La misma fuente tambien menciona alcance territorial.",
              sourceIds: [sourceId],
              evidenceFragmentIds: [evidenceFragmentId],
            },
          ],
        },
      ],
    });

    expect(isErr(result)).toBe(true);
  });

  it("rejects sourced triangulation without findings or partial coverage warning", () => {
    const result = createTriangulationResult({
      ...validTriangulationInput,
      matches: [],
      divergences: [],
      warnings: [],
    });

    expect(isErr(result)).toBe(true);
  });

  it("creates rewrite results with neutral text and justified changes", () => {
    const result = createRewriteResult(validRewriteInput);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.neutralText).toBe(validRewriteInput.neutralText);
      expect(result.value.changes[0]?.justification).toContain("valorativo");
    }
  });

  it("rejects rewrite changes without justification", () => {
    const result = createRewriteResult({
      ...validRewriteInput,
      changes: [
        {
          ...validRewriteInput.changes[0],
          justification: "",
        },
      ],
    });

    expect(isErr(result)).toBe(true);
  });

  it("creates context results with factual context separated from media coverage", () => {
    const result = createContextResult(validContextInput);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.factualContext.summary).toBe(
        validContextInput.factualContext.summary,
      );
      expect(result.value.factualContext.sources[0]?.sourceId).toBe(
        factualSourceId,
      );
      expect(result.value.mediaCoverage.summary).toBe(
        validTriangulationInput.summary,
      );
      expect(
        result.value.mediaCoverage.sources.some((source) =>
          source.evidenceFragmentIds.includes(factualEvidenceFragmentId),
        ),
      ).toBe(false);
    }
  });

  it("rejects context results that mix media coverage into the factual layer", () => {
    const result = createContextResult({
      ...validContextInput,
      factualContext: {
        ...validContextInput.factualContext,
        mediaCoverage: validTriangulationInput,
      },
    } as unknown as ContextResultSnapshot);

    expect(isErr(result)).toBe(true);
  });

  it("rejects factual context points that reference evidence outside factual context sources", () => {
    const result = createContextResult({
      ...validContextInput,
      factualContext: {
        ...validContextInput.factualContext,
        points: [
          {
            ...validContextInput.factualContext.points[0],
            evidenceFragmentIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
          },
        ],
      },
    });

    expect(isErr(result)).toBe(true);
  });

  it("rejects factual context points without evidence references", () => {
    const result = createContextResult({
      ...validContextInput,
      factualContext: {
        ...validContextInput.factualContext,
        points: [
          {
            ...validContextInput.factualContext.points[0],
            evidenceFragmentIds: [],
          },
        ],
      },
    });

    expect(isErr(result)).toBe(true);
  });

  it.each(["fresh", "stale", "generating", "partial", "failed"] as const)(
    "creates feed results with %s status",
    (status) => {
      const result = createFeedResult({
        ...validFeedInput,
        status,
        topics: status === "failed" ? [] : validFeedInput.topics,
        warnings:
          status === "failed"
            ? [
                {
                  kind: "insufficient_evidence",
                  message: "No se pudo generar ningun tema.",
                },
              ]
            : [],
      });

      expect(isOk(result)).toBe(true);
    },
  );

  it("serializes and rehydrates all editorial result snapshots", () => {
    const triangulation = createTriangulationResult(validTriangulationInput);
    const rewrite = createRewriteResult(validRewriteInput);
    const context = createContextResult(validContextInput);
    const feed = createFeedResult(validFeedInput);

    expect(isOk(triangulation)).toBe(true);
    expect(isOk(rewrite)).toBe(true);
    expect(isOk(context)).toBe(true);
    expect(isOk(feed)).toBe(true);
    if (!isOk(triangulation) || !isOk(rewrite) || !isOk(context) || !isOk(feed)) {
      return;
    }

    const triangulationSnapshot = toTriangulationResultSnapshot(
      triangulation.value,
    );
    const rewriteSnapshot = toRewriteResultSnapshot(rewrite.value);
    const contextSnapshot = toContextResultSnapshot(context.value);
    const feedSnapshot = toFeedResultSnapshot(feed.value);

    expect(triangulationSnapshot).not.toHaveProperty("body");
    expect(JSON.parse(JSON.stringify(triangulationSnapshot))).toEqual(
      triangulationSnapshot,
    );
    expect(createTriangulationResult(triangulationSnapshot).ok).toBe(true);
    expect(createRewriteResult(rewriteSnapshot).ok).toBe(true);
    expect(createContextResult(contextSnapshot).ok).toBe(true);
    expect(createFeedResult(feedSnapshot).ok).toBe(true);
  });
});
