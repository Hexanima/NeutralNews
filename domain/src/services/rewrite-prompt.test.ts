import { describe, expect, it } from "vitest";

import * as domain from "../index.js";

type VersionedPrompt = {
  id: string;
  version: string;
  instructions: string;
};

const rewritePrompt = () =>
  (domain as Record<string, unknown>).rewritePrompt as VersionedPrompt | undefined;

describe("rewrite prompt", () => {
  it("exposes a versioned template from the public domain API", () => {
    expect(rewritePrompt()).toMatchObject({
      id: "rewrite",
      version: "10",
    });
  });

  it("forbids adding external information", () => {
    expect(rewritePrompt()).toBeDefined();
    expect(rewritePrompt()?.instructions).toContain("No agregues información externa");
  });

  it("preserves names, dates, figures, and attributed quotations", () => {
    expect(rewritePrompt()).toBeDefined();
    expect(rewritePrompt()?.instructions).toContain("nombres");
    expect(rewritePrompt()?.instructions).toContain("fechas");
    expect(rewritePrompt()?.instructions).toContain("cifras");
    expect(rewritePrompt()?.instructions).toContain("citas atribuidas");
  });

  it("removes evaluative language and unsupported attributions of intent", () => {
    expect(rewritePrompt()).toBeDefined();
    expect(rewritePrompt()?.instructions).toContain("lenguaje valorativo");
    expect(rewritePrompt()?.instructions).toContain("atribuciones de intención");
  });

  it("retains every material position and requires an auditable change record", () => {
    expect(rewritePrompt()).toBeDefined();
    expect(rewritePrompt()?.instructions).toContain("posiciones materiales");
    expect(rewritePrompt()?.instructions).toContain("tipo");
    expect(rewritePrompt()?.instructions).toContain("fragmento original");
    expect(rewritePrompt()?.instructions).toContain("justificación");
  });

  it("requires an internal coverage record for every input segment", () => {
    expect(rewritePrompt()).toBeDefined();
    expect(rewritePrompt()?.instructions).toContain("segmentos de entrada");
    expect(rewritePrompt()?.instructions).toContain("cobertura");
    expect(rewritePrompt()?.instructions).toContain("distinta");
    expect(rewritePrompt()?.instructions).toContain("contenido material");
    expect(rewritePrompt()?.instructions).toContain("sujeto");
    expect(rewritePrompt()?.instructions).toContain("toda atribución");
    expect(rewritePrompt()?.instructions).toContain("exclusivamente de las representaciones");
    expect(rewritePrompt()?.instructions).toContain("una sola posición");
    expect(rewritePrompt()?.instructions).toContain("términos materiales");
    expect(rewritePrompt()?.instructions).toContain("hechos nuevos");
  });
});
