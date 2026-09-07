import { describe, expect, it } from "vitest";

import {
  createNewsSourceCatalog,
  initialNewsSourceCatalogSnapshot,
  isOk,
  type NewsSourceCatalogEntrySnapshot,
  type NewsSourceOrientation,
} from "../index.js";

const rssEntries = (
  entries: readonly NewsSourceCatalogEntrySnapshot[],
): readonly NewsSourceCatalogEntrySnapshot[] =>
  entries.filter((entry) => entry.discovery.mode === "rss");

const findSource = (
  sourceName: string,
): NewsSourceCatalogEntrySnapshot | undefined =>
  initialNewsSourceCatalogSnapshot.sources.find(
    (entry) => entry.source.name === sourceName,
  );

describe("initial news source catalog", () => {
  it("defines a versioned catalog whose sources satisfy the domain model", () => {
    const result = createNewsSourceCatalog(initialNewsSourceCatalogSnapshot);

    expect(result.ok).toBe(true);
    if (isOk(result)) {
      expect(result.value.schemaVersion).toBe(1);
      expect(result.value.sources.length).toBe(
        initialNewsSourceCatalogSnapshot.sources.length,
      );
    }
  });

  it("uses stable unique ids for every source", () => {
    const ids = initialNewsSourceCatalogSnapshot.sources.map(
      (entry) => entry.source.id,
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
  });

  it("includes Argentine sources with distinct manual orientations", () => {
    const argentineOrientations = new Set<NewsSourceOrientation>(
      initialNewsSourceCatalogSnapshot.sources
        .filter((entry) => entry.source.region === "argentina")
        .map((entry) => entry.source.orientation),
    );

    expect(argentineOrientations).toEqual(
      new Set([
        "izquierda",
        "centroizquierda",
        "centro",
        "centroderecha",
        "derecha",
      ]),
    );
  });

  it("models international agencies and BBC Mundo by type and region, not neutral orientation", () => {
    expect(findSource("Reuters")?.source).toMatchObject({
      orientation: "sin_clasificar",
      type: "agency",
      region: "international",
      country: "GB",
    });
    expect(findSource("Associated Press")?.source).toMatchObject({
      orientation: "sin_clasificar",
      type: "agency",
      region: "international",
      country: "US",
    });
    expect(findSource("Agence France-Presse")?.source).toMatchObject({
      orientation: "sin_clasificar",
      type: "agency",
      region: "international",
      country: "FR",
    });
    expect(findSource("BBC Mundo")?.source).toMatchObject({
      orientation: "sin_clasificar",
      type: "media",
      region: "international",
      country: "GB",
      language: "es",
    });
  });

  it("declares explicit search domains for every initial source", () => {
    expect(
      rssEntries(initialNewsSourceCatalogSnapshot.sources).length,
    ).toBeGreaterThan(0);

    for (const entry of initialNewsSourceCatalogSnapshot.sources) {
      if (entry.discovery.mode === "rss") {
        expect(entry.discovery.feedUrl).toMatch(/^https?:\/\//);
      }

      expect(entry.discovery.domains).toEqual(
        expect.arrayContaining([expect.any(String)]),
      );
    }
  });

  it("normalizes configured search domains while keeping them optional for existing entries", () => {
    const result = createNewsSourceCatalog({
      schemaVersion: 1,
      sources: [
        {
          ...initialNewsSourceCatalogSnapshot.sources[0]!,
          discovery: {
            mode: "search_only",
            domains: ["Example.COM."],
          },
        },
        {
          ...initialNewsSourceCatalogSnapshot.sources[1]!,
          discovery: { mode: "search_only" },
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (isOk(result)) {
      expect(result.value.sources[0]?.discovery).toEqual({
        mode: "search_only",
        domains: ["example.com"],
      });
      expect(result.value.sources[1]?.discovery).toEqual({ mode: "search_only" });
    }
  });

  it("allows later Latin American candidates without automatic orientation", () => {
    const result = createNewsSourceCatalog({
      schemaVersion: 1,
      sources: [
        {
          source: {
            id: "99999999-9999-4999-8999-999999999999",
            name: "Candidata latinoamericana",
            orientation: "sin_clasificar",
            type: "media",
            region: "latin_america",
            country: "UY",
            language: "es-uy",
            active: false,
            approvalStatus: "pending_review",
            reviewedAt: "2026-08-04T00:00:00.000Z",
          },
          discovery: { mode: "search_only" },
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (isOk(result)) {
      expect(result.value.sources[0]?.source.orientation).toBe(
        "sin_clasificar",
      );
      expect(result.value.sources[0]?.source.approvalStatus).toBe(
        "pending_review",
      );
    }
  });

  it("rejects invalid discovery modes and RSS entries without feed URL", () => {
    const invalidMode = createNewsSourceCatalog({
      ...initialNewsSourceCatalogSnapshot,
      sources: [
        {
          ...initialNewsSourceCatalogSnapshot.sources[0]!,
          discovery: { mode: "web" },
        },
      ],
    });
    const missingFeedUrl = createNewsSourceCatalog({
      ...initialNewsSourceCatalogSnapshot,
      sources: [
        {
          ...initialNewsSourceCatalogSnapshot.sources[0]!,
          discovery: { mode: "rss" },
        },
      ],
    });

    expect(invalidMode.ok).toBe(false);
    expect(missingFeedUrl.ok).toBe(false);
  });

  it("rejects external catalog snapshots that are not objects", () => {
    const result = createNewsSourceCatalog(null);

    expect(result.ok).toBe(false);
  });
});
