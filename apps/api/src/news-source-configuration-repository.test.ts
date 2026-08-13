import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defaultRegionalPreferences,
  initialNewsSourceCatalogSnapshot,
  isOk,
  type NewsSourceCatalogEntrySnapshot,
} from "app-domain";
import { afterEach, describe, expect, it } from "vitest";

import { createJsonNewsSourceConfigurationRepository } from "./news-source-configuration-repository.js";

const temporaryDirectories: string[] = [];
const configPath = join("configuration", "news-sources.json");
const firstSource = initialNewsSourceCatalogSnapshot.sources[0]!;
const secondSource = initialNewsSourceCatalogSnapshot.sources[1]!;

const manualSource = {
  source: {
    id: "99999999-0000-4000-8000-000000000010",
    name: "Manual Andina",
    orientation: "sin_clasificar",
    type: "media",
    region: "latin_america",
    country: "CL",
    language: "es-cl",
    active: false,
    approvalStatus: "pending_review",
    reviewedAt: "2026-08-04T00:00:00.000Z",
  },
  discovery: { mode: "search_only" },
} satisfies NewsSourceCatalogEntrySnapshot;

const createTemporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "neutralnews-sources-"));
  temporaryDirectories.push(directory);

  return directory;
};

const readStoredConfiguration = async (directory: string) =>
  JSON.parse(await readFile(join(directory, configPath), "utf8")) as {
    schemaVersion: number;
    configurationVersion: number;
    sourceOverrides: unknown[];
    regionalPreferences: unknown;
  };

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("JSON news source configuration repository", () => {
  it("creates the effective configuration from defaults on first startup", async () => {
    const directory = await createTemporaryDirectory();
    const repository = createJsonNewsSourceConfigurationRepository(directory);

    const result = await repository.getEffectiveConfiguration();

    expect(result.ok).toBe(true);
    if (!isOk(result)) {
      throw result.error;
    }

    expect(result.value.configurationVersion).toBe(1);
    expect(result.value.regionalPreferences).toEqual(defaultRegionalPreferences);
    expect(result.value.sources.map((entry) => entry.source.id)).toEqual(
      initialNewsSourceCatalogSnapshot.sources.map((entry) => entry.source.id),
    );
    expect(await readStoredConfiguration(directory)).toEqual({
      schemaVersion: 3,
      configurationVersion: 1,
      sourceOverrides: [],
      regionalPreferences: defaultRegionalPreferences,
    });
  });

  it("persists regional preferences and increments the configuration version", async () => {
    const directory = await createTemporaryDirectory();
    const repository = createJsonNewsSourceConfigurationRepository(directory);

    const saved = await repository.saveRegionalPreferences({
      regionalPreferences: {
        timeZone: { mode: "manual", manualTimeZone: "Europe/Madrid" },
        feedDistribution: { argentina: 2, latin_america: 2, international: 2 },
      },
    });

    expect(saved.ok).toBe(true);
    if (!isOk(saved)) {
      throw saved.error;
    }

    expect(saved.value.configurationVersion).toBe(2);
    expect(saved.value.regionalPreferences).toEqual({
      timeZone: { mode: "manual", manualTimeZone: "Europe/Madrid" },
      effectiveTimeZone: "Europe/Madrid",
      feedDistribution: { argentina: 2, latin_america: 2, international: 2 },
    });
    expect(await readStoredConfiguration(directory)).toMatchObject({
      schemaVersion: 3,
      configurationVersion: 2,
      regionalPreferences: {
        timeZone: { mode: "manual", manualTimeZone: "Europe/Madrid" },
        effectiveTimeZone: "Europe/Madrid",
        feedDistribution: { argentina: 2, latin_america: 2, international: 2 },
      },
    });
  });

  it("persists additions, deletions, changes and activations across restarts", async () => {
    const directory = await createTemporaryDirectory();
    const changedDefault = {
      ...firstSource,
      source: {
        ...firstSource.source,
        name: "Pagina/12 local",
        active: false,
      },
    } satisfies NewsSourceCatalogEntrySnapshot;
    const repository = createJsonNewsSourceConfigurationRepository(directory);

    expect((await repository.saveEntry({ entry: changedDefault })).ok).toBe(true);
    expect((await repository.saveEntry({ entry: manualSource })).ok).toBe(true);
    expect((await repository.deleteSource({ id: secondSource.source.id })).ok).toBe(
      true,
    );

    const restartedRepository =
      createJsonNewsSourceConfigurationRepository(directory);
    const result = await restartedRepository.getEffectiveConfiguration();

    expect(result.ok).toBe(true);
    if (!isOk(result)) {
      throw result.error;
    }

    expect(result.value.configurationVersion).toBe(4);
    expect(
      result.value.sources.find(
        (entry) => entry.source.id === firstSource.source.id,
      )?.source,
    ).toMatchObject({ name: "Pagina/12 local", active: false });
    expect(
      result.value.sources.some(
        (entry) => entry.source.id === secondSource.source.id,
      ),
    ).toBe(false);
    expect(
      result.value.sources.some(
        (entry) => entry.source.id === manualSource.source.id,
      ),
    ).toBe(true);
  });

  it("restores defaults and increments the configuration version", async () => {
    const directory = await createTemporaryDirectory();
    const repository = createJsonNewsSourceConfigurationRepository(directory);

    expect((await repository.saveEntry({ entry: manualSource })).ok).toBe(true);
    const restored = await repository.restoreDefaults();

    expect(restored.ok).toBe(true);
    if (!isOk(restored)) {
      throw restored.error;
    }

    expect(restored.value.configurationVersion).toBe(3);
    expect(restored.value.regionalPreferences).toEqual(defaultRegionalPreferences);
    expect(restored.value.sources.map((entry) => entry.source.id)).toEqual(
      initialNewsSourceCatalogSnapshot.sources.map((entry) => entry.source.id),
    );
    expect(await readStoredConfiguration(directory)).toEqual({
      schemaVersion: 3,
      configurationVersion: 3,
      sourceOverrides: [],
      regionalPreferences: defaultRegionalPreferences,
    });
  });

  it("migrates a legacy full configuration snapshot and persists the migrated shape", async () => {
    const directory = await createTemporaryDirectory();
    const changedDefault = {
      ...firstSource,
      source: { ...firstSource.source, active: false },
    } satisfies NewsSourceCatalogEntrySnapshot;
    await mkdir(join(directory, "configuration"));
    await writeFile(
      join(directory, configPath),
      `${JSON.stringify({
        schemaVersion: 1,
        configurationVersion: 5,
        sources: [
          changedDefault,
          ...initialNewsSourceCatalogSnapshot.sources.slice(2),
          manualSource,
        ],
      })}\n`,
    );
    const repository = createJsonNewsSourceConfigurationRepository(directory);

    const result = await repository.getEffectiveConfiguration();

    expect(result.ok).toBe(true);
    if (!isOk(result)) {
      throw result.error;
    }

    expect(result.value.configurationVersion).toBe(5);
    expect(await readStoredConfiguration(directory)).toMatchObject({
      schemaVersion: 3,
      configurationVersion: 5,
      regionalPreferences: defaultRegionalPreferences,
    });
  });

  it("recovers defaults when the local JSON violates the configuration schema", async () => {
    const directory = await createTemporaryDirectory();
    await mkdir(join(directory, "configuration"));
    await writeFile(
      join(directory, configPath),
      `${JSON.stringify({
        schemaVersion: 3,
        configurationVersion: 9,
        sourceOverrides: [
          {
            id: firstSource.source.id,
            entry: manualSource,
          },
        ],
        regionalPreferences: defaultRegionalPreferences,
      })}\n`,
    );
    const repository = createJsonNewsSourceConfigurationRepository(directory);

    const result = await repository.getEffectiveConfiguration();

    expect(result.ok).toBe(true);
    if (!isOk(result)) {
      throw result.error;
    }

    expect(result.value.configurationVersion).toBe(1);
    expect(result.value.regionalPreferences).toEqual(defaultRegionalPreferences);
    expect(result.value.sources.map((entry) => entry.source.id)).toEqual(
      initialNewsSourceCatalogSnapshot.sources.map((entry) => entry.source.id),
    );
    expect(await readStoredConfiguration(directory)).toEqual({
      schemaVersion: 3,
      configurationVersion: 1,
      sourceOverrides: [],
      regionalPreferences: defaultRegionalPreferences,
    });
  });

  it("recovers defaults when the local JSON is corrupt and keeps a recoverable copy", async () => {
    const directory = await createTemporaryDirectory();
    await mkdir(join(directory, "configuration"));
    await writeFile(join(directory, configPath), "{\"schemaVersion\":");
    const repository = createJsonNewsSourceConfigurationRepository(directory);

    const result = await repository.getEffectiveConfiguration();

    expect(result.ok).toBe(true);
    if (!isOk(result)) {
      throw result.error;
    }

    expect(result.value.configurationVersion).toBe(1);
    expect(await readStoredConfiguration(directory)).toEqual({
      schemaVersion: 3,
      configurationVersion: 1,
      sourceOverrides: [],
      regionalPreferences: defaultRegionalPreferences,
    });
    expect(
      (await readdir(join(directory, "configuration"))).some((fileName) =>
        fileName.startsWith("news-sources.json.corrupt-"),
      ),
    ).toBe(true);
  });
});
