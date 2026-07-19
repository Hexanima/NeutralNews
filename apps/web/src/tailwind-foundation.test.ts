import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import App from "./App.js";

const readIndexCss = (): Promise<string> =>
  readFile(fileURLToPath(new URL("./index.css", import.meta.url)), "utf8");

const getThemeColor = (css: string, token: string): string => {
  const match = css.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`));

  if (!match) {
    throw new Error(`Missing theme color token: ${token}`);
  }

  return match[1];
};

const getRelativeLuminance = (hexColor: string): number => {
  const channels = hexColor
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => {
      const value = Number.parseInt(channel, 16) / 255;

      return value <= 0.03928
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });

  if (!channels || channels.length !== 3) {
    throw new Error(`Invalid hex color: ${hexColor}`);
  }

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};

const getContrastRatio = (foreground: string, background: string): number => {
  const foregroundLuminance = getRelativeLuminance(foreground);
  const backgroundLuminance = getRelativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
};

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

  it("keeps muted text accessible on the default surface", async () => {
    const css = await readIndexCss();
    const muted = getThemeColor(css, "--color-muted");
    const surface = getThemeColor(css, "--color-surface");

    expect(getContrastRatio(muted, surface)).toBeGreaterThanOrEqual(4.5);
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
