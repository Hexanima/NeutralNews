import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import App from "./App.js";

const readIndexCss = (): Promise<string> =>
  readFile(fileURLToPath(new URL("./index.css", import.meta.url)), "utf8");

describe("Tailwind foundation", () => {
  it("imports Tailwind and defines accessible design tokens", async () => {
    const css = await readIndexCss();

    expect(css).toContain('@import "tailwindcss";');
    expect(css).toContain("@theme");
    expect(css).toContain("--color-surface");
    expect(css).toContain("--color-panel");
    expect(css).toContain("--color-ink");
    expect(css).toContain("--color-focus");
    expect(css).toContain("--spacing-shell");
    expect(css).toContain("--spacing-card");
    expect(css).toContain("--font-sans");
  });

  it("keeps visible focus styles in the base layer", async () => {
    const css = await readIndexCss();

    expect(css).toContain(":focus-visible");
    expect(css).toContain("outline");
    expect(css).toContain("--color-focus");
  });

  it("uses static Tailwind classes from the local token set", () => {
    const markup = renderToStaticMarkup(createElement(App));

    expect(markup).toContain("min-h-screen");
    expect(markup).toContain("bg-surface");
    expect(markup).toContain("text-ink");
    expect(markup).toContain("p-shell");
    expect(markup).toContain("border-border");
  });
});
