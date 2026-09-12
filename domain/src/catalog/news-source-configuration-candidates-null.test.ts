import { describe, expect, it } from "vitest";

import {
  createNewsSourceConfigurationSnapshot,
  defaultRegionalPreferences,
  isErr,
} from "../index.js";

describe("news source candidate configuration validation", () => {
  it("returns a structured error for a null candidate", () => {
    const result = createNewsSourceConfigurationSnapshot({
      schemaVersion: 4,
      configurationVersion: 1,
      sourceOverrides: [],
      candidates: [null],
      regionalPreferences: defaultRegionalPreferences,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.type).toBe("InvalidNewsSourceConfiguration");
    }
  });
});
