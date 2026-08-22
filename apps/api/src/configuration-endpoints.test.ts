import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import {
  defaultRegionalPreferences,
  initialNewsSourceCatalogSnapshot,
  type NewsSourceCatalogEntrySnapshot,
} from "app-domain";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, loadApiConfig } from "./app.js";

const temporaryDirectories: string[] = [];
const validPasswordHash =
  "$argon2id$v=19$m=32,t=2,p=2$MDEyMzQ1Njc4OWFiY2RlZg==$DFYj7N4xFFUiI8oxwK/k/skRZiCNIGR5xOGTpdhlPKs=";
const validSessionSecret = "0123456789abcdef0123456789abcdef";
const configPath = join("configuration", "news-sources.json");
const firstDefaultSource = initialNewsSourceCatalogSnapshot.sources[0]!;
const secondDefaultSource = initialNewsSourceCatalogSnapshot.sources[1]!;
const missingSourceId = "99999999-0000-4000-8000-000000000099";
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

const createTemporaryDirectory = async (prefix: string) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);

  return directory;
};

const createStaticRoot = async () => {
  const staticRoot = await createTemporaryDirectory("neutralnews-static-");
  await mkdir(staticRoot, { recursive: true });

  return staticRoot;
};

const createValidEnvironment = async (): Promise<NodeJS.ProcessEnv> => ({
  NEUTRALNEWS_ACCESS_PASSWORD_HASH: validPasswordHash,
  NEUTRALNEWS_SESSION_SECRET: validSessionSecret,
  NEUTRALNEWS_DATA_DIR: await createTemporaryDirectory("neutralnews-data-"),
});

const fetchFromApp = async (
  path: string,
  environment: NodeJS.ProcessEnv,
  init?: RequestInit & { json?: unknown },
): Promise<Response> => {
  const server = createApp({
    staticRoot: await createStaticRoot(),
    config: loadApiConfig(environment),
    configurationRequestOptions: {
      externalUrlValidation: {
        resolveHostname: async () => ["93.184.216.34"],
      },
    },
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;

  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      ...init,
      headers:
        init?.json === undefined
          ? init?.headers
          : { "content-type": "application/json", ...init.headers },
      body: init?.json === undefined ? init?.body : JSON.stringify(init.json),
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
};

const readStoredConfiguration = async (directory: string) =>
  JSON.parse(await readFile(join(directory, configPath), "utf8")) as {
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

describe("news source configuration HTTP endpoints", () => {
  it("lists the effective news source configuration from defaults", async () => {
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(
      "/api/configuration/news-sources",
      environment,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      schemaVersion: 1,
      configurationVersion: 1,
      cacheVersion: expect.any(String),
      sources: initialNewsSourceCatalogSnapshot.sources,
      regionalPreferences: defaultRegionalPreferences,
    });
  });

  it("stores automatic regional preferences with the browser time zone", async () => {
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(
      "/api/configuration/regional-preferences",
      environment,
      {
        method: "PUT",
        json: {
          timeZone: {
            mode: "automatic",
            detectedTimeZone: "America/Santiago",
          },
          feedDistribution: { argentina: 2, latin_america: 3, international: 1 },
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      configurationVersion: 2,
      regionalPreferences: {
        timeZone: {
          mode: "automatic",
          detectedTimeZone: "America/Santiago",
        },
        effectiveTimeZone: "America/Santiago",
        feedDistribution: { argentina: 2, latin_america: 3, international: 1 },
      },
    });
    expect(await readStoredConfiguration(environment.NEUTRALNEWS_DATA_DIR!)).toMatchObject({
      configurationVersion: 2,
      regionalPreferences: {
        effectiveTimeZone: "America/Santiago",
      },
    });
  });

  it("stores manual regional preferences", async () => {
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(
      "/api/configuration/regional-preferences",
      environment,
      {
        method: "PUT",
        json: {
          timeZone: {
            mode: "manual",
            manualTimeZone: "Europe/Madrid",
          },
          feedDistribution: { argentina: 2, latin_america: 2, international: 2 },
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      configurationVersion: 2,
      regionalPreferences: {
        timeZone: {
          mode: "manual",
          manualTimeZone: "Europe/Madrid",
        },
        effectiveTimeZone: "Europe/Madrid",
        feedDistribution: { argentina: 2, latin_america: 2, international: 2 },
      },
    });
  });

  it("rejects invalid regional preferences without incrementing the version", async () => {
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(
      "/api/configuration/regional-preferences",
      environment,
      {
        method: "PUT",
        json: {
          timeZone: { mode: "manual", manualTimeZone: "Buenos Aires" },
          feedDistribution: { argentina: 3, latin_america: 2, international: 1 },
        },
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "InvalidNewsSourceConfiguration",
        message: expect.any(String),
        details: expect.arrayContaining([
          expect.objectContaining({ field: "timeZone" }),
        ]),
      },
    });
    expect(
      (await readStoredConfiguration(environment.NEUTRALNEWS_DATA_DIR!))
        .configurationVersion,
    ).toBe(1);
  });

  it("creates a manual news source and persists the incremented configuration version", async () => {
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(
      "/api/configuration/news-sources",
      environment,
      { method: "POST", json: manualSource },
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.configurationVersion).toBe(2);
    expect(body.sources).toContainEqual(manualSource);
    expect(
      await readStoredConfiguration(environment.NEUTRALNEWS_DATA_DIR!),
    ).toMatchObject({ configurationVersion: 2 });
  });

  it("rejects RSS news sources whose feed URL targets a blocked address", async () => {
    const environment = await createValidEnvironment();
    const rssSource = {
      ...manualSource,
      discovery: { mode: "rss", feedUrl: "http://127.0.0.1/feed.xml" },
    } satisfies NewsSourceCatalogEntrySnapshot;

    const response = await fetchFromApp(
      "/api/configuration/news-sources",
      environment,
      { method: "POST", json: rssSource },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "BlockedExternalUrl",
        message: expect.any(String),
        details: [{ field: "feedUrl", reason: "BlockedAddress" }],
      },
    });
    const configuration = await fetchFromApp(
      "/api/configuration/news-sources",
      environment,
    );

    expect(configuration.status).toBe(200);
    expect(await configuration.json()).toMatchObject({
      configurationVersion: 1,
      sources: initialNewsSourceCatalogSnapshot.sources,
    });
  });
  it("returns a structured error for an invalid manual news source", async () => {
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(
      "/api/configuration/news-sources",
      environment,
      {
        method: "POST",
        json: { ...manualSource, source: { ...manualSource.source, name: "" } },
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "InvalidNewsSource",
        message: expect.any(String),
        details: expect.any(Array),
      },
    });
  });

  it("rejects manual news sources that collide with a default source id", async () => {
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(
      "/api/configuration/news-sources",
      environment,
      {
        method: "POST",
        json: {
          ...manualSource,
          source: { ...manualSource.source, id: firstDefaultSource.source.id },
        },
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "SourceIdAlreadyExists",
        id: firstDefaultSource.source.id,
      },
    });
    expect(
      (await readStoredConfiguration(environment.NEUTRALNEWS_DATA_DIR!))
        .configurationVersion,
    ).toBe(1);
  });

  it("rejects default source id collisions after backend normalization", async () => {
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(
      "/api/configuration/news-sources",
      environment,
      {
        method: "POST",
        json: {
          ...manualSource,
          source: {
            ...manualSource.source,
            id: ` ${firstDefaultSource.source.id} `,
          },
        },
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "SourceIdAlreadyExists",
        id: firstDefaultSource.source.id,
      },
    });
    expect(
      (await readStoredConfiguration(environment.NEUTRALNEWS_DATA_DIR!))
        .configurationVersion,
    ).toBe(1);
  });

  it("edits an existing news source and rejects path and body id mismatches", async () => {
    const environment = await createValidEnvironment();
    const editedSource = {
      ...firstDefaultSource,
      source: { ...firstDefaultSource.source, name: "Fuente editada" },
    } satisfies NewsSourceCatalogEntrySnapshot;

    const mismatch = await fetchFromApp(
      `/api/configuration/news-sources/${firstDefaultSource.source.id}`,
      environment,
      { method: "PUT", json: manualSource },
    );
    const edited = await fetchFromApp(
      `/api/configuration/news-sources/${firstDefaultSource.source.id}`,
      environment,
      { method: "PUT", json: editedSource },
    );

    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toEqual({
      error: {
        code: "InvalidNewsSource",
        message: "Path id must match body source id",
        details: [{ field: "id", value: manualSource.source.id }],
      },
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({
      configurationVersion: 2,
      sources: expect.arrayContaining([editedSource]),
    });
  });

  it("activates and deactivates a news source while incrementing the configuration version", async () => {
    const environment = await createValidEnvironment();
    await fetchFromApp("/api/configuration/news-sources", environment, {
      method: "POST",
      json: manualSource,
    });

    const activated = await fetchFromApp(
      `/api/configuration/news-sources/${manualSource.source.id}/activate`,
      environment,
      { method: "POST" },
    );
    const deactivated = await fetchFromApp(
      `/api/configuration/news-sources/${manualSource.source.id}/deactivate`,
      environment,
      { method: "POST" },
    );

    expect(activated.status).toBe(200);
    expect(await activated.json()).toMatchObject({
      configurationVersion: 3,
      sources: expect.arrayContaining([
        { ...manualSource, source: { ...manualSource.source, active: true } },
      ]),
    });
    expect(deactivated.status).toBe(200);
    expect(await deactivated.json()).toMatchObject({
      configurationVersion: 4,
      sources: expect.arrayContaining([manualSource]),
    });
  });

  it("deletes an existing source and returns not found for missing sources without incrementing", async () => {
    const environment = await createValidEnvironment();
    const deleted = await fetchFromApp(
      `/api/configuration/news-sources/${secondDefaultSource.source.id}`,
      environment,
      { method: "DELETE" },
    );
    const missing = await fetchFromApp(
      `/api/configuration/news-sources/${missingSourceId}`,
      environment,
      { method: "DELETE" },
    );

    expect(deleted.status).toBe(200);
    expect((await deleted.json()).sources).not.toContainEqual(
      secondDefaultSource,
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: { code: "NewsSourceNotFound", id: missingSourceId },
    });
    expect(
      (await readStoredConfiguration(environment.NEUTRALNEWS_DATA_DIR!))
        .configurationVersion,
    ).toBe(2);
  });

  it("restores default news sources and increments the configuration version", async () => {
    const environment = await createValidEnvironment();
    await fetchFromApp("/api/configuration/news-sources", environment, {
      method: "POST",
      json: manualSource,
    });

    const restored = await fetchFromApp(
      "/api/configuration/news-sources/restore-defaults",
      environment,
      { method: "POST" },
    );

    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      configurationVersion: 3,
      sources: initialNewsSourceCatalogSnapshot.sources,
    });
  });
});
