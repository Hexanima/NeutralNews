import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import {
  createFakeAiGenerationPort,
  err,
  ExternalPortError,
  initialAiProviderCatalogSnapshot,
} from "app-domain";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, loadApiConfig } from "./app.js";
import { createSession } from "./authentication.js";
import { createInMemoryCredentialVault } from "./credential-vault.js";

const temporaryDirectories: string[] = [];
const validPasswordHash =
  "$argon2id$v=19$m=32,t=2,p=2$MDEyMzQ1Njc4OWFiY2RlZg==$DFYj7N4xFFUiI8oxwK/k/skRZiCNIGR5xOGTpdhlPKs=";
const validSessionSecret = "0123456789abcdef0123456789abcdef";
const configPath = join("configuration", "ai-providers.json");
const apiKey = "sk-secret-that-must-not-leak";

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

const createSessionHeader = () => ({
  cookie: `neutralnews_session=${createSession({ secret: validSessionSecret })}`,
});

const readStoredConfiguration = async (directory: string) =>
  JSON.parse(await readFile(join(directory, configPath), "utf8")) as {
    configurationVersion: number;
    activeSelection: unknown;
    credentialReferences: unknown[];
    modelSynchronizations: unknown[];
  };

const fetchFromApp = async (
  path: string,
  environment: NodeJS.ProcessEnv,
  init?: RequestInit & { json?: unknown },
  options: {
    aiProvider?: ReturnType<typeof createFakeAiGenerationPort>;
    credentialVault?: ReturnType<typeof createInMemoryCredentialVault>;
    clearFeedCache?: () => Promise<void>;
  } = {},
): Promise<Response> => {
  const server = createApp({
    staticRoot: await createStaticRoot(),
    config: loadApiConfig(environment),
    aiConfigurationRequestOptions: {
      aiProvider: options.aiProvider ?? createFakeAiGenerationPort(),
      credentialVault: options.credentialVault ?? createInMemoryCredentialVault(),
      clearFeedCache: options.clearFeedCache,
    },
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;

  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      ...init,
      headers: {
        ...createSessionHeader(),
        origin: "http://127.0.0.1:3000",
        ...(init?.json === undefined ? {} : { "content-type": "application/json" }),
        ...init?.headers,
      },
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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("AI provider configuration HTTP endpoints", () => {
  it("lists providers, credential schemas, models, capabilities and active selection without credentials", async () => {
    const environment = await createValidEnvironment();
    const response = await fetchFromApp("/api/configuration/ai", environment);

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      schemaVersion: 1,
      configurationVersion: 1,
      requiredCapabilities: ["structured_outputs", "web_search"],
      activeSelection: { providerId: "openai", modelId: "gpt-5.6-terra" },
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          credentialSchema:
            initialAiProviderCatalogSnapshot.providers[0]!.credentialSchema,
          credentialStatus: { status: "not_configured" },
        },
      ],
      models: initialAiProviderCatalogSnapshot.models,
      modelSynchronizations: [],
    });
    expect(JSON.stringify(body)).not.toContain("reference");
    expect(JSON.stringify(body)).not.toContain("sk-");
  });

  it("stores and replaces credentials without returning or persisting the secret value", async () => {
    const environment = await createValidEnvironment();
    const credentialVault = createInMemoryCredentialVault();

    const saved = await fetchFromApp(
      "/api/configuration/ai/providers/openai/credentials",
      environment,
      {
        method: "PUT",
        json: { credentialValues: [{ fieldId: "api_key", value: apiKey }] },
      },
      { credentialVault },
    );
    const replaced = await fetchFromApp(
      "/api/configuration/ai/providers/openai/credentials",
      environment,
      {
        method: "PUT",
        json: {
          credentialValues: [
            { fieldId: "api_key", value: "sk-replacement-secret" },
          ],
        },
      },
      { credentialVault },
    );

    expect(saved.status).toBe(200);
    expect(replaced.status).toBe(200);
    const body = await replaced.json();
    expect(body.providers[0].credentialStatus).toMatchObject({
      status: "configured",
      configuredAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain("sk-replacement-secret");
    expect(JSON.stringify(body)).not.toContain("reference");

    const storedBody = await readFile(
      join(environment.NEUTRALNEWS_DATA_DIR!, configPath),
      "utf8",
    );
    expect(storedBody).toContain("cred_v1_");
    expect(storedBody).not.toContain(apiKey);
    expect(storedBody).not.toContain("sk-replacement-secret");
  });

  it("deletes a credential and removes the persisted credential reference", async () => {
    const environment = await createValidEnvironment();
    const credentialVault = createInMemoryCredentialVault();
    await fetchFromApp(
      "/api/configuration/ai/providers/openai/credentials",
      environment,
      {
        method: "PUT",
        json: { credentialValues: [{ fieldId: "api_key", value: apiKey }] },
      },
      { credentialVault },
    );

    const response = await fetchFromApp(
      "/api/configuration/ai/providers/openai/credentials",
      environment,
      { method: "DELETE" },
      { credentialVault },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      providers: [{ credentialStatus: { status: "not_configured" } }],
    });
    expect(
      (await readStoredConfiguration(environment.NEUTRALNEWS_DATA_DIR!))
        .credentialReferences,
    ).toEqual([]);
  });

  it("tests a submitted credential without persisting it", async () => {
    const environment = await createValidEnvironment();
    const aiProvider = createFakeAiGenerationPort({
      remoteModels: [{ id: "gpt-5.6-terra" }, { id: "gpt-5.6-sol" }],
    });

    const response = await fetchFromApp(
      "/api/configuration/ai/providers/openai/credentials/test",
      environment,
      {
        method: "POST",
        json: { credentialValues: [{ fieldId: "api_key", value: apiKey }] },
      },
      { aiProvider },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      providerId: "openai",
      accessibleModelCount: 2,
    });
    expect(aiProvider.calls.testCredential).toEqual([
      {
        providerId: "openai",
        credentialValues: [{ fieldId: "api_key", value: apiKey }],
      },
    ]);
    expect(
      (await readStoredConfiguration(environment.NEUTRALNEWS_DATA_DIR!))
        .credentialReferences,
    ).toEqual([]);
  });

  it("syncs accessible models and keeps the response sanitized", async () => {
    const environment = await createValidEnvironment();
    const credentialVault = createInMemoryCredentialVault();
    const aiProvider = createFakeAiGenerationPort({
      remoteModels: [
        { id: "gpt-5.6-terra", ownedBy: "openai" },
        { id: "gpt-remote-new", ownedBy: "openai" },
      ],
    });
    await fetchFromApp(
      "/api/configuration/ai/providers/openai/credentials",
      environment,
      {
        method: "PUT",
        json: { credentialValues: [{ fieldId: "api_key", value: apiKey }] },
      },
      { credentialVault, aiProvider },
    );

    const response = await fetchFromApp(
      "/api/configuration/ai/providers/openai/models/sync",
      environment,
      { method: "POST" },
      { credentialVault, aiProvider },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.warnings).toEqual([]);
    expect(body.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: "gpt-5.6-terra",
          availabilityStatus: "available",
        }),
        expect.objectContaining({
          modelId: "gpt-5.6-sol",
          availabilityStatus: "unavailable",
        }),
        expect.objectContaining({
          modelId: "gpt-remote-new",
          compatibilityStatus: "unknown",
          availabilityStatus: "available",
        }),
      ]),
    );
    expect(JSON.stringify(body)).not.toContain(apiKey);
  });

  it("rejects sync without a configured credential", async () => {
    const environment = await createValidEnvironment();

    const response = await fetchFromApp(
      "/api/configuration/ai/providers/openai/models/sync",
      environment,
      { method: "POST" },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "AiCredentialUnavailable",
        providerId: "openai",
        fieldId: "api_key",
      },
    });
  });

  it("rejects unsupported active selections and keeps the previous selection", async () => {
    const environment = await createValidEnvironment();
    const credentialVault = createInMemoryCredentialVault();
    const aiProvider = createFakeAiGenerationPort({
      remoteModels: [{ id: "gpt-5.6-terra" }],
    });
    await fetchFromApp(
      "/api/configuration/ai/providers/openai/credentials",
      environment,
      {
        method: "PUT",
        json: { credentialValues: [{ fieldId: "api_key", value: apiKey }] },
      },
      { credentialVault, aiProvider },
    );
    await fetchFromApp(
      "/api/configuration/ai/providers/openai/models/sync",
      environment,
      { method: "POST" },
      { credentialVault, aiProvider },
    );

    const response = await fetchFromApp(
      "/api/configuration/ai/active-selection",
      environment,
      {
        method: "PUT",
        json: { providerId: "openai", modelId: "gpt-5.6-sol" },
      },
      { credentialVault, aiProvider },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "AiModelUnavailable",
        providerId: "openai",
        modelId: "gpt-5.6-sol",
      },
    });
    expect(
      (await readStoredConfiguration(environment.NEUTRALNEWS_DATA_DIR!))
        .activeSelection,
    ).toEqual({ providerId: "openai", modelId: "gpt-5.6-terra" });
  });

  it("persists a compatible active selection and invalidates dependent feed cache", async () => {
    const environment = await createValidEnvironment();
    let invalidations = 0;

    const response = await fetchFromApp(
      "/api/configuration/ai/active-selection",
      environment,
      {
        method: "PUT",
        json: { providerId: "openai", modelId: "gpt-5.6-sol" },
      },
      {
        clearFeedCache: async () => {
          invalidations += 1;
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      configurationVersion: 2,
      activeSelection: { providerId: "openai", modelId: "gpt-5.6-sol" },
    });
    expect(invalidations).toBe(1);
  });

  it("returns sanitized remote errors when testing credentials and syncing models", async () => {
    const environment = await createValidEnvironment();
    const credentialVault = createInMemoryCredentialVault();
    const aiProvider = createFakeAiGenerationPort({
      credentialTestResult: err(
        new ExternalPortError("openai.models.list", "TransientFailure", 503),
      ),
      listAccessibleModelsResult: err(
        new ExternalPortError("openai.models.list", "TransientFailure", 503),
      ),
    });
    await fetchFromApp(
      "/api/configuration/ai/providers/openai/credentials",
      environment,
      {
        method: "PUT",
        json: { credentialValues: [{ fieldId: "api_key", value: apiKey }] },
      },
      { credentialVault, aiProvider },
    );

    const tested = await fetchFromApp(
      "/api/configuration/ai/providers/openai/credentials/test",
      environment,
      {
        method: "POST",
        json: { credentialValues: [{ fieldId: "api_key", value: apiKey }] },
      },
      { credentialVault, aiProvider },
    );
    const synced = await fetchFromApp(
      "/api/configuration/ai/providers/openai/models/sync",
      environment,
      { method: "POST" },
      { credentialVault, aiProvider },
    );

    expect(tested.status).toBe(502);
    const testedBody = await tested.text();
    expect(JSON.parse(testedBody)).toEqual({
      error: {
        code: "AiProviderRemoteError",
        providerId: "openai",
        category: "TransientFailure",
        statusCode: 503,
      },
    });
    expect(testedBody).not.toContain(apiKey);
    expect(synced.status).toBe(200);
    expect(await synced.json()).toMatchObject({
      warnings: [{ code: "AiModelSyncFailed", providerId: "openai" }],
    });
  });
});
