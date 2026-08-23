import { describe, expect, it } from "vitest";

import {
  createEffectiveNewsSourceConfiguration,
  createLocalDateKey,
  createNewsSourceConfigurationSnapshot,
  defaultRegionalPreferences,
  initialNewsSourceCatalogSnapshot,
  isOk,
  toNewsSourceConfigurationSnapshot,
  type NewsSourceCatalogEntrySnapshot,
  type NewsSourceConfigurationSnapshot,
  type RegionalPreferencesSnapshot,
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
    expect(configuration.regionalPreferences).toEqual(defaultRegionalPreferences);
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
      schemaVersion: 3,
      configurationVersion: 7,
      sourceOverrides: [
        { id: firstSource.source.id, entry: changedDefault },
        { id: secondSource.source.id, deleted: true },
        { id: manualSource.source.id, entry: manualSource },
      ],
      regionalPreferences: defaultRegionalPreferences,
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
      schemaVersion: 3,
      configurationVersion: 1,
      sourceOverrides: [
        {
          id: firstSource.source.id,
          entry: { ...manualSource, source: { ...manualSource.source } },
        },
      ],
      regionalPreferences: defaultRegionalPreferences,
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

    expect(snapshot.value.schemaVersion).toBe(3);
    expect(snapshot.value.configurationVersion).toBe(3);
    expect(snapshot.value.sourceOverrides).toEqual([
      { id: firstSource.source.id, entry: changedDefault },
      { id: secondSource.source.id, deleted: true },
      { id: manualSource.source.id, entry: manualSource },
    ]);
    expect(snapshot.value.regionalPreferences).toEqual(defaultRegionalPreferences);
  });

  it("migrates a v2 local override snapshot into regional defaults", () => {
    const snapshot = createNewsSourceConfigurationSnapshot({
      schemaVersion: 2,
      configurationVersion: 6,
      sourceOverrides: [{ id: manualSource.source.id, entry: manualSource }],
    });

    expect(snapshot.ok).toBe(true);
    if (!isOk(snapshot)) {
      throw snapshot.error;
    }

    expect(snapshot.value).toEqual({
      schemaVersion: 3,
      configurationVersion: 6,
      sourceOverrides: [{ id: manualSource.source.id, entry: manualSource }],
      regionalPreferences: defaultRegionalPreferences,
    });
  });

  it("accepts manual and automatic IANA time zones", () => {
    const manualPreferences = createNewsSourceConfigurationSnapshot({
      schemaVersion: 3,
      configurationVersion: 2,
      sourceOverrides: [],
      regionalPreferences: {
        timeZone: {
          mode: "manual",
          manualTimeZone: "Europe/Madrid",
        },
        feedDistribution: { argentina: 2, latin_america: 2, international: 2 },
      },
    });
    const automaticPreferences = createNewsSourceConfigurationSnapshot({
      schemaVersion: 3,
      configurationVersion: 3,
      sourceOverrides: [],
      regionalPreferences: {
        timeZone: {
          mode: "automatic",
          detectedTimeZone: "America/Santiago",
        },
        feedDistribution: { argentina: 3, latin_america: 2, international: 1 },
      },
    });

    expect(manualPreferences.ok).toBe(true);
    expect(automaticPreferences.ok).toBe(true);
    if (!isOk(manualPreferences) || !isOk(automaticPreferences)) {
      throw new Error("expected valid regional preferences");
    }

    expect(manualPreferences.value.regionalPreferences.effectiveTimeZone).toBe(
      "Europe/Madrid",
    );
    expect(automaticPreferences.value.regionalPreferences.effectiveTimeZone).toBe(
      "America/Santiago",
    );
  });

  it("rejects invalid regional preference values", () => {
    const invalidTimeZone = createNewsSourceConfigurationSnapshot({
      schemaVersion: 3,
      configurationVersion: 2,
      sourceOverrides: [],
      regionalPreferences: {
        timeZone: { mode: "manual", manualTimeZone: "Buenos Aires" },
        feedDistribution: { argentina: 3, latin_america: 2, international: 1 },
      },
    });
    const invalidDistribution = createNewsSourceConfigurationSnapshot({
      schemaVersion: 3,
      configurationVersion: 2,
      sourceOverrides: [],
      regionalPreferences: {
        timeZone: { mode: "automatic" },
        feedDistribution: { argentina: 7, latin_america: 0, international: 0 },
      },
    });

    expect(invalidTimeZone.ok).toBe(false);
    expect(invalidDistribution.ok).toBe(false);
  });

  it("changes the effective cache version when the base catalog changes", () => {
    const localSnapshot: NewsSourceConfigurationSnapshot = {
      schemaVersion: 3,
      configurationVersion: 4,
      sourceOverrides: [],
      regionalPreferences: defaultRegionalPreferences,
    };
    const changedCatalog = {
      ...initialNewsSourceCatalogSnapshot,
      sources: [
        {
          ...firstSource,
          source: { ...firstSource.source, name: "Pagina/12 catalogo nuevo" },
        },
        ...initialNewsSourceCatalogSnapshot.sources.slice(1),
      ],
    };
    const original = createEffectiveNewsSourceConfiguration(
      initialNewsSourceCatalogSnapshot,
      localSnapshot,
    );
    const changed = createEffectiveNewsSourceConfiguration(
      changedCatalog,
      localSnapshot,
    );

    expect(original.ok).toBe(true);
    expect(changed.ok).toBe(true);
    if (!isOk(original) || !isOk(changed)) {
      throw new Error("expected valid effective configurations");
    }

    expect(changed.value.configurationVersion).toBe(
      original.value.configurationVersion,
    );
    expect(changed.value.cacheVersion).not.toBe(original.value.cacheVersion);
  });

  it("changes the effective cache version when regional preferences change", () => {
    const original = effectiveFrom({
      schemaVersion: 3,
      configurationVersion: 4,
      sourceOverrides: [],
      regionalPreferences: defaultRegionalPreferences,
    });
    const changed = effectiveFrom({
      schemaVersion: 3,
      configurationVersion: 5,
      sourceOverrides: [],
      regionalPreferences: {
        ...defaultRegionalPreferences,
        timeZone: { mode: "manual", manualTimeZone: "Europe/Madrid" },
        effectiveTimeZone: "Europe/Madrid",
      },
    });

    expect(changed.cacheVersion).not.toBe(original.cacheVersion);
  });

  it("serializes an effective configuration back to a normalized local snapshot", () => {
    const regionalPreferences: RegionalPreferencesSnapshot = {
      ...defaultRegionalPreferences,
      timeZone: { mode: "manual", manualTimeZone: "Europe/Madrid" },
      effectiveTimeZone: "Europe/Madrid",
    };
    const configuration = effectiveFrom({
      schemaVersion: 3,
      configurationVersion: 8,
      sourceOverrides: [{ id: manualSource.source.id, entry: manualSource }],
      regionalPreferences,
    });

    const snapshot = toNewsSourceConfigurationSnapshot(configuration);

    expect(snapshot).toEqual({
      schemaVersion: 3,
      configurationVersion: 8,
      sourceOverrides: [{ id: manualSource.source.id, entry: manualSource }],
      regionalPreferences,
    });
  });

  it("calculates the local day for the effective time zone", () => {
    const buenosAiresDay = createLocalDateKey({
      instant: "2026-08-13T02:30:00.000Z",
      timeZone: "America/Argentina/Buenos_Aires",
    });
    const utcDay = createLocalDateKey({
      instant: "2026-08-13T02:30:00.000Z",
      timeZone: "UTC",
    });

    expect(buenosAiresDay).toEqual({ ok: true, value: "2026-08-12" });
    expect(utcDay).toEqual({ ok: true, value: "2026-08-13" });
  });

  it("returns a typed error for an invalid local day time zone", () => {
    const result = createLocalDateKey({
      instant: "2026-08-13T02:30:00.000Z",
      timeZone: "Buenos Aires",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected invalid timezone");
    }

    expect(result.error.type).toBe("InvalidNewsSourceConfigurationValue");
    expect(result.error.field).toBe("timeZone");
  });
});
