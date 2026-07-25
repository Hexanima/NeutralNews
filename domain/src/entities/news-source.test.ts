import { describe, expect, it } from "vitest";

import {
  createCountryCode,
  createLanguageCode,
  createNewsSource,
  isErr,
  isOk,
  toNewsSourceSnapshot,
} from "../index.js";
import type {
  NewsSourceOrientation,
  NewsSourceRegion,
  NewsSourceSnapshot,
  NewsSourceType,
} from "../index.js";

const validSourceInput: NewsSourceSnapshot = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Agencia Publica",
  orientation: "unclassified",
  type: "agency",
  region: "argentina",
  country: "AR",
  language: "es-ar",
  active: true,
  approvalStatus: "pending_review",
  reviewedAt: "2026-07-25T12:30:00.000Z",
};

describe("NewsSource", () => {
  it("accepts every supported editorial orientation", () => {
    const orientations: NewsSourceOrientation[] = [
      "left",
      "center_left",
      "center",
      "center_right",
      "right",
      "unclassified",
    ];

    for (const orientation of orientations) {
      const result = createNewsSource({
        ...validSourceInput,
        orientation,
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.orientation).toBe(orientation);
      }
    }
  });

  it("keeps source type separate from editorial orientation", () => {
    const types: NewsSourceType[] = ["media", "agency", "primary_source"];

    for (const type of types) {
      const result = createNewsSource({
        ...validSourceInput,
        orientation: "unclassified",
        type,
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.type).toBe(type);
        expect(result.value.orientation).toBe("unclassified");
      }
    }
  });

  it("models region, country, and language as separate normalized values", () => {
    const regions: NewsSourceRegion[] = [
      "argentina",
      "latin_america",
      "international",
    ];

    for (const region of regions) {
      const result = createNewsSource({
        ...validSourceInput,
        region,
        country: "uy",
        language: "ES-UY",
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.region).toBe(region);
        expect(result.value.country).toBe("UY");
        expect(result.value.language).toBe("es-uy");
      }
    }
  });

  it("creates a source with stable id, active state, approval status, and review date", () => {
    const result = createNewsSource(validSourceInput);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual(validSourceInput);
    }
  });

  it.each([
    ["id", { id: "not-a-uuid" }],
    ["name", { name: "  " }],
    ["orientation", { orientation: "neutral" }],
    ["type", { type: "blog" }],
    ["region", { region: "europe" }],
    ["country", { country: "ARG" }],
    ["language", { language: "spanish" }],
    ["approvalStatus", { approvalStatus: "draft" }],
    ["reviewedAt", { reviewedAt: "25/07/2026" }],
  ])("rejects an invalid %s invariant", (_field, override) => {
    const result = createNewsSource({
      ...validSourceInput,
      ...override,
    });

    expect(isErr(result)).toBe(true);
  });

  it("serializes and rehydrates a stable JSON snapshot", () => {
    const created = createNewsSource({
      ...validSourceInput,
      country: "br",
      language: "PT-BR",
    });

    expect(isOk(created)).toBe(true);
    if (!isOk(created)) {
      return;
    }

    const snapshot = toNewsSourceSnapshot(created.value);
    const rehydrated = createNewsSource(snapshot);

    expect(snapshot).toEqual({
      ...validSourceInput,
      country: "BR",
      language: "pt-br",
    });
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(isOk(rehydrated)).toBe(true);
    if (isOk(rehydrated)) {
      expect(rehydrated.value).toEqual(snapshot);
      expect(typeof rehydrated.value.reviewedAt).toBe("string");
    }
  });

  it("creates country and language value objects through the public domain API", () => {
    const country = createCountryCode("ar");
    const language = createLanguageCode("ES-AR");

    expect(isOk(country)).toBe(true);
    expect(isOk(language)).toBe(true);
    if (isOk(country) && isOk(language)) {
      expect(country.value).toBe("AR");
      expect(language.value).toBe("es-ar");
    }
  });
});
