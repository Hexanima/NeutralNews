import { describe, expect, it } from "vitest";

import * as domain from "../index.js";

const validOutput = {
  neutralText: "El proyecto fue presentado por el bloque oficialista.",
  changes: [
    {
      id: "77777777-7777-4777-8777-777777777777",
      type: "evaluative_language",
      originalText: "El polémico proyecto fue lanzado por el oficialismo.",
      neutralText: "El proyecto fue presentado por el bloque oficialista.",
      justification: "El fragmento contenía una valoración no atribuida.",
    },
  ],
  positions: [{
    sourceSegmentIds: ["segment-1"],
    neutralText: "El proyecto fue presentado por el bloque oficialista.",
  }],
};

type RewriteParser = (value: unknown) => { ok: boolean };
type RewriteSchema = {
  type: string;
  additionalProperties: boolean;
  required: readonly string[];
  properties: {
    changes: {
      items: {
        required: readonly string[];
        properties: { type: { enum: readonly string[] } };
      };
    };
  };
};

const publicApi = domain as Record<string, unknown>;
const parser = () => publicApi.parseRewriteStructuredOutput as RewriteParser | undefined;
const schema = () => publicApi.rewriteOutputSchema as RewriteSchema | undefined;

describe("rewrite structured output", () => {
  it("parses a neutral text with typed and justified changes", () => {
    expect(parser()).toEqual(expect.any(Function));
    if (parser() === undefined) {
      return;
    }

    expect(parser()?.(validOutput).ok).toBe(true);
  });

  it.each([
    ["an unknown root property", { ...validOutput, invented: true }],
    ["a missing change type", { ...validOutput, changes: [{ ...validOutput.changes[0], type: undefined }] }],
    ["an unknown change type", { ...validOutput, changes: [{ ...validOutput.changes[0], type: "invented_change" }] }],
    ["an empty original fragment", { ...validOutput, changes: [{ ...validOutput.changes[0], originalText: " " }] }],
    ["an empty justification", { ...validOutput, changes: [{ ...validOutput.changes[0], justification: "" }] }],
    ["an invalid change id", { ...validOutput, changes: [{ ...validOutput.changes[0], id: "not-a-uuid" }] }],
    ["a position without source segments", { ...validOutput, positions: [{ ...validOutput.positions[0], sourceSegmentIds: [] }] }],
    ["a position with an invalid source segment id", { ...validOutput, positions: [{ ...validOutput.positions[0], sourceSegmentIds: ["source-1"] }] }],
    ["an empty neutral representation of a position", { ...validOutput, positions: [{ ...validOutput.positions[0], neutralText: " " }] }],
  ])("rejects %s", (_description, output) => {
    expect(parser()).toEqual(expect.any(Function));
    if (parser() === undefined) {
      return;
    }

    expect(parser()?.(output).ok).toBe(false);
  });

  it("publishes a strict, versioned JSON Schema compatible with structured outputs", () => {
    expect(publicApi.rewriteOutputSchemaVersion).toBe("2");
    expect(schema()).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["neutralText", "changes", "positions"],
    });
    expect(schema()?.properties.changes.items.required).toEqual([
      "id",
      "type",
      "originalText",
      "neutralText",
      "justification",
    ]);
    expect(schema()?.properties.changes.items.properties.type.enum).toEqual([
      "evaluative_language",
      "attribution_of_intent",
    ]);
  });
});
