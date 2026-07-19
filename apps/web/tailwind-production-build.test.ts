import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build, type RollupOutput } from "vite";
import { describe, expect, it } from "vitest";

const getCssFromOutput = (output: RollupOutput | RollupOutput[]): string => {
  const outputs = Array.isArray(output) ? output : [output];

  return outputs
    .flatMap((rollupOutput) => rollupOutput.output)
    .filter((asset) => asset.type === "asset" && asset.fileName.endsWith(".css"))
    .map((asset) => String(asset.source))
    .join("\n");
};

describe("Tailwind production build", () => {
  it("generates used utilities and omits unused ones", async () => {
    const configFile = fileURLToPath(new URL("./vite.config.ts", import.meta.url));
    const root = fileURLToPath(new URL(".", import.meta.url));
    const result = await build({
      configFile,
      root,
      build: {
        write: false,
      },
      logLevel: "silent",
    });
    const css = getCssFromOutput(result as RollupOutput | RollupOutput[]);

    expect(css).toContain(".bg-surface");
    expect(css).toContain(".text-ink");
    expect(css).toContain(".border-border");
    expect(css).not.toContain(".bg-contrast-failure");
  });

  it("has Tailwind dependencies declared in the web workspace", async () => {
    const packageJsonPath = fileURLToPath(
      new URL("./package.json", import.meta.url),
    );
    const packageJson = JSON.parse(
      await readFile(packageJsonPath, "utf8"),
    ) as { devDependencies?: Record<string, string> };

    expect(packageJson.devDependencies?.tailwindcss).toBeDefined();
    expect(packageJson.devDependencies?.["@tailwindcss/vite"]).toBeDefined();
  });
});
