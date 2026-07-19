import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("vite build script", () => {
  it("uses the runner config loader for Windows production builds", async () => {
    const packageJsonPath = fileURLToPath(
      new URL("./package.json", import.meta.url),
    );
    const packageJson = JSON.parse(
      await readFile(packageJsonPath, "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.build).toBe(
      "tsc && vite build --configLoader runner",
    );
  });
});
