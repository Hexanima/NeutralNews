import { describe, expect, it } from "vitest";

import { err, isErr, isOk, ok } from "./result.js";
import { UnauthorizedError } from "../errors/unauthorized-error.js";

describe("Result", () => {
  it("wraps successful values with an ok discriminator", () => {
    const result = ok({ id: "123" });

    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);

    if (isOk(result)) {
      expect(result.value.id).toBe("123");
    }
  });

  it("wraps failures with an error discriminator", () => {
    const error = new UnauthorizedError();
    const result = err(error);

    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);

    if (isErr(result)) {
      expect(result.error).toBe(error);
    }
  });
});
