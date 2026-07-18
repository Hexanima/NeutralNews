import { describe, expect, it } from "vitest";

import { isOk, neutralNewsReadinessUseCase } from "../index.js";

describe("neutralNewsReadinessUseCase", () => {
  it("is exported from the public domain API and reports the NeutralNews foundation", async () => {
    const result = await neutralNewsReadinessUseCase.execute(
      undefined,
      undefined,
    );

    expect(isOk(result)).toBe(true);

    if (isOk(result)) {
      expect(result.value).toEqual({
        product: "neutral-news",
        domain: "ready",
        dependencyRule: "inward",
      });
    }
  });
});
