import { describe, expect, it } from "vitest";

import {
  createEffectiveNewsSourceConfiguration,
  createNewsSourceConfigurationSnapshot,
  defaultRegionalPreferences,
  initialNewsSourceCatalogSnapshot,
  isOk,
} from "../index.js";

describe("news source candidate configuration", () => {
  it("keeps candidates separate from the effective active source list", () => {
    const snapshot = createNewsSourceConfigurationSnapshot({
      schemaVersion: 4,
      configurationVersion: 2,
      sourceOverrides: [],
      candidates: [
        {
          domain: "nuevo.example",
          orientation: "sin_clasificar",
          active: false,
          approvalStatus: "pending_review",
          firstSeenAt: "2026-09-06T12:00:00.000Z",
          lastSeenAt: "2026-09-06T12:00:00.000Z",
        },
      ],
      regionalPreferences: defaultRegionalPreferences,
    });

    expect(isOk(snapshot)).toBe(true);
    if (!isOk(snapshot)) {
      return;
    }

    const effective = createEffectiveNewsSourceConfiguration(
      initialNewsSourceCatalogSnapshot,
      snapshot.value,
    );

    expect(isOk(effective)).toBe(true);
    if (isOk(effective)) {
      expect(effective.value.sources).toHaveLength(
        initialNewsSourceCatalogSnapshot.sources.length,
      );
      expect(effective.value.candidates).toEqual([
        expect.objectContaining({
          domain: "nuevo.example",
          orientation: "sin_clasificar",
          active: false,
          approvalStatus: "pending_review",
        }),
      ]);
    }
  });
});
