import { describe, expect, it } from "vitest";

import * as domain from "../index.js";

describe("neutrality prompt", () => {
  it("exposes a versioned neutrality template from the public domain API", () => {
    const prompt = (domain as Record<string, unknown>).neutralityPrompt;

    expect(prompt).toMatchObject({
      id: "neutrality",
      version: "1",
    });
  });

  it("requires identifying facts, attributed statements, and contradictions", () => {
    const prompt = (domain as Record<string, { instructions: string }>).neutralityPrompt;

    expect(prompt.instructions).toContain("hechos verificables");
    expect(prompt.instructions).toContain("declaraciones atribuidas");
    expect(prompt.instructions).toContain("contradicciones");
  });

  it("forbids inventing data or completing absent information", () => {
    const prompt = (domain as Record<string, { instructions: string }>).neutralityPrompt;

    expect(prompt.instructions).toContain("No inventes datos");
    expect(prompt.instructions).toContain("No completes información ausente");
  });

  it("preserves material positions without equalizing their factual status", () => {
    const prompt = (domain as Record<string, { instructions: string }>).neutralityPrompt;

    expect(prompt.instructions).toContain("posiciones materiales");
    expect(prompt.instructions).toContain("sin igualar su estatus factual");
  });

  it("describes asymmetric coverage without attributing intent", () => {
    const prompt = (domain as Record<string, { instructions: string }>).neutralityPrompt;

    expect(prompt.instructions).toContain("cobertura asimétrica");
    expect(prompt.instructions).toContain("sin atribuir intención editorial");
  });

  it("requires evidence traceability and preserves uncertainty", () => {
    const prompt = (domain as Record<string, { instructions: string }>).neutralityPrompt;

    expect(prompt.instructions).toContain("IDs de evidencia existentes");
    expect(prompt.instructions).toContain("No elijas una versión como verdadera");
    expect(prompt.instructions).toContain("No infieras causas o consecuencias ausentes");
    expect(prompt.instructions).toContain("incertidumbre");
  });
});
