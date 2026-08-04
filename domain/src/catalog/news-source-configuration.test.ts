import { describe, expect, it } from "vitest";

import {
  createEffectiveNewsSourceConfiguration,
  createNewsSourceConfigurationSnapshot,
  initialNewsSourceCatalogSnapshot,
  isOk,
  toNewsSourceConfigurationSnapshot,
  type NewsSourceCatalogEntrySnapshot,
  type NewsSourceConfigurationSnapshot,
} from "../index.js";

const firstSource = initialNewsSourceCatalogSnapshot.sources[0]!;
const secondSource = initialNewsSourceCatalogSnapshot.sources[1]!;

const manualSource = {
  source: {
    id: "99999999-0000-4000-8000-000000000001",
    name: "Manual Sur",
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
} satisfies NewsSourceCatalogEntrySnapshot;

const effectiveFrom = (snapshot: NewsSourceConfigurationSnapshot | null) => {
  const catalog = createEffectiveNewsSourceConfiguration(
    initialNewsSourceCatalogSnapshot,
    snapshot,
  );

  expect(catalog.ok).toBe(true);
  if (!isOk(catalog)) {
    throw catalog.error;
  }

  return catalog.value;
};

describe("news source effective configuration", () => {
  it("creates the effective configuration from the initial catalog when local overrides are missing", () => {
    const configuration = effectiveFrom(null);

    expect(configuration.schemaVersion).toBe(1);
    expect(configuration.configurationVersion).toBe(1);
    expect(configuration.sources.map((entry) => entry.source.id)).toEqual(
      initialNewsSourceCatalogSnapshot.sources.map((entry) => entry.source.id),
    );
  });

  it("combines default sources with local additions, changes and deletions", () => {
    const changedDefault = {
      ...firstSource,
      source: {
        ...firstSource.source,
        name: "Pagina/12 editada",
        active: false,
      },
      discovery: { mode: "search_only" },
    } satisfies NewsSourceCatalogEntrySnapshot;
    const snapshot = createNewsSourceConfigurationSnapshot({
      schemaVersion: 2,
      configurationVersion: 7,
      sourceOverrides: [
        { id: firstSource.source.id, entry: changedDefault },
        { id: secondSource.source.id, deleted: true },
        { id: manualSource.source.id, entry: manualSource },
      ],
    });

    expect(snapshot.ok).toBe(true);
    if (!isOk(snapshot)) {
      throw snapshot.error;
    }

    const configuration = effectiveFrom(snapshot.value);

    expect(configuration.configurationVersion).toBe(7);
    expect(
      configuration.sources.find(
        (entry) => entry.source.id === firstSource.source.id,
      )?.source,
    ).toMatchObject({ name: "Pagina/12 editada", active: false });
    expect(
      configuration.sources.some(
        (entry) => entry.source.id === secondSource.source.id,
      ),
    ).toBe(false);
    expect(configuration.sources.at(-1)?.source.id).toBe(manualSource.source.id);
  });

  it("rejects invalid local overrides and id mismatches", () => {
    const invalid = createNewsSourceConfigurationSnapshot({
      schemaVersion: 2,
      configurationVersion: 1,
      sourceOverrides: [
        {
          id: firstSource.source.id,
          entry: { ...manualSource, source: { ...manualSource.source } },
        },
      ],
    });

    expect(invalid.ok).toBe(false);
  });

  it("migrates a legacy full configuration snapshot into local overrides", () => {
    const changedDefault = {
      ...firstSource,
      source: { ...firstSource.source, active: false },
    } satisfies NewsSourceCatalogEntrySnapshot;
    const legacySources = [
      changedDefault,
      ...initialNewsSourceCatalogSnapshot.sources.slice(2),
      manualSource,
    ];
    const snapshot = createNewsSourceConfigurationSnapshot({
      schemaVersion: 1,
      configurationVersion: 3,
      sources: legacySources,
    });

    expect(snapshot.ok).toBe(true);
    if (!isOk(snapshot)) {
      throw snapshot.error;
    }

    expect(snapshot.value.schemaVersion).toBe(2);
    expect(snapshot.value.configurationVersion).toBe(3);
    expect(snapshot.value.sourceOverrides).toEqual([
      { id: firstSource.source.id, entry: changedDefault },
      { id: secondSource.source.id, deleted: true },
      { id: manualSource.source.id, entry: manualSource },
    ]);
  });

  it("serializes an effective configuration back to a normalized local snapshot", () => {
    const configuration = effectiveFrom({
      schemaVersion: 2,
      configurationVersion: 8,
      sourceOverrides: [{ id: manualSource.source.id, entry: manualSource }],
    });

    const snapshot = toNewsSourceConfigurationSnapshot(configuration);

    expect(snapshot).toEqual({
      schemaVersion: 2,
      configurationVersion: 8,
      sourceOverrides: [{ id: manualSource.source.id, entry: manualSource }],
    });
  });
});

