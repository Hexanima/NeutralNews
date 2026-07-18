import { describe, expect, it } from "vitest";

import { isOk, testUseCase } from "../index.js";

describe("testUseCase", () => {
  it("is exported from the public domain API and returns an ok result", async () => {
    const result = await testUseCase.execute(undefined, undefined);

    expect(isOk(result)).toBe(true);

    if (isOk(result)) {
      expect(result.value.testVar).toBe(false);
    }
  });
});
