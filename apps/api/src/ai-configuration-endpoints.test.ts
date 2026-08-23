import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import {
  AiCredentialUnavailableError,
  createFakeAiGenerationPort,
  err,
  ExternalPortError,
  initialAiProviderCatalogSnapshot,
} from "app-domain";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, loadApiConfig } from "./app.js";
import { createSession } from "./authentication.js";
import {
  createInMemoryCredentialVault,
  CredentialVaultUnavailableError,
  type CredentialVault,
} from "./credential-vault.js";

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
    credentialVault?: CredentialVault;
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

  it("does not report orphan vault secrets as configured without a persisted reference", async () => {
    const environment = await createValidEnvironment();
    const credentialVault = createInMemoryCredentialVault();
    const saved = await credentialVault.saveSecret("openai", apiKey);

    expect(saved.ok).toBe(true);

    const response = await fetchFromApp(
      "/api/configuration/ai",
      environment,
      undefined,
      { credentialVault },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      providers: [
        {
          id: "openai",
          credentialStatus: { status: "not_configured" },
        },
      ],
    });
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

  it("rejects credential deletion for providers outside the catalog", async () => {
    const environment = await createValidEnvironment();
    await fetchFromApp("/api/configuration/ai", environment);

    const response = await fetchFromApp(
      "/api/configuration/ai/providers/missing/credentials",
      environment,
      { method: "DELETE" },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "AiProviderNotFound", providerId: "missing" },
    });
    expect(
      (await readStoredConfiguration(environment.NEUTRALNEWS_DATA_DIR!))
        .configurationVersion,
    ).toBe(1);
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

  it("clears synced model availability when replacing a credential", async () => {
    const environment = await createValidEnvironment();
    const credentialVault = createInMemoryCredentialVault();
    const aiProvider = createFakeAiGenerationPort({
      remoteModels: [{ id: "gpt-5.6-terra" }, { id: "gpt-5.6-sol" }],
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
      { credentialVault, aiProvider },
    );
    const selected = await fetchFromApp(
      "/api/configuration/ai/active-selection",
      environment,
      {
        method: "PUT",
        json: { providerId: "openai", modelId: "gpt-5.6-sol" },
      },
      { credentialVault, aiProvider },
    );

    expect(replaced.status).toBe(200);
    const body = await replaced.json();
    expect(body.modelSynchronizations).toEqual([]);
    expect(body.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: "gpt-5.6-sol",
          availabilityStatus: "unknown",
        }),
      ]),
    );
    expect(selected.status).toBe(409);
    expect(await selected.json()).toEqual({
      error: {
        code: "AiModelUnavailable",
        providerId: "openai",
        modelId: "gpt-5.6-sol",
      },
    });
    expect(
      (await readStoredConfiguration(environment.NEUTRALNEWS_DATA_DIR!))
        .modelSynchronizations,
    ).toEqual([]);
  });

  it("clears synced model availability when deleting a credential", async () => {
    const environment = await createValidEnvironment();
    const credentialVault = createInMemoryCredentialVault();
    const aiProvider = createFakeAiGenerationPort({
      remoteModels: [{ id: "gpt-5.6-terra" }, { id: "gpt-5.6-sol" }],
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

    const deleted = await fetchFromApp(
      "/api/configuration/ai/providers/openai/credentials",
      environment,
      { method: "DELETE" },
      { credentialVault, aiProvider },
    );
    const selected = await fetchFromApp(
      "/api/configuration/ai/active-selection",
      environment,
      {
        method: "PUT",
        json: { providerId: "openai", modelId: "gpt-5.6-sol" },
      },
      { credentialVault, aiProvider },
    );

    expect(deleted.status).toBe(200);
    const body = await deleted.json();
    expect(body.modelSynchronizations).toEqual([]);
    expect(body.providers[0].credentialStatus).toEqual({
      status: "not_configured",
    });
    expect(body.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: "gpt-5.6-sol",
          availabilityStatus: "unknown",
        }),
      ]),
    );
    expect(selected.status).toBe(409);
    expect(await selected.json()).toEqual({
      error: {
        code: "AiModelUnavailable",
        providerId: "openai",
        modelId: "gpt-5.6-sol",
      },
    });
    const stored = await readStoredConfiguration(
      environment.NEUTRALNEWS_DATA_DIR!,
    );
    expect(stored.credentialReferences).toEqual([]);
    expect(stored.modelSynchronizations).toEqual([]);
  });

  it("returns an explicit vault error when syncing with an unavailable credential vault", async () => {
    const environment = await createValidEnvironment();
    await mkdir(join(environment.NEUTRALNEWS_DATA_DIR!, "configuration"), {
      recursive: true,
    });
    await writeFile(
      join(environment.NEUTRALNEWS_DATA_DIR!, configPath),
      `${JSON.stringify({
        schemaVersion: 1,
        configurationVersion: 1,
        activeSelection: { providerId: "openai", modelId: "gpt-5.6-terra" },
        credentialReferences: [
          {
            providerId: "openai",
            fieldId: "api_key",
            reference: "cred_v1_missing_key",
          },
        ],
        providerOverrides: [],
        modelOverrides: [],
        modelSynchronizations: [],
      })}\n`,
    );
    const unavailableVault: CredentialVault = {
      saveSecret: async () => ({ ok: false, error: new CredentialVaultUnavailableError() }),
      readSecret: async () => ({ ok: false, error: new CredentialVaultUnavailableError() }),
      describeSecret: async () => ({ ok: false, error: new CredentialVaultUnavailableError() }),
      deleteSecret: async () => ({ ok: false, error: new CredentialVaultUnavailableError() }),
    };

    const response = await fetchFromApp(
      "/api/configuration/ai/providers/openai/models/sync",
      environment,
      { method: "POST" },
      { credentialVault: unavailableVault },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "CredentialVaultUnavailable" },
    });
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

  it("rejects active selections before model availability is confirmed", async () => {
    const environment = await createValidEnvironment();

    const response = await fetchFromApp(
      "/api/configuration/ai/active-selection",
      environment,
      {
        method: "PUT",
        json: { providerId: "openai", modelId: "gpt-5.6-sol" },
      },
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

  it("rejects incompatible active selections and keeps the previous selection", async () => {
    const environment = await createValidEnvironment();
    await mkdir(join(environment.NEUTRALNEWS_DATA_DIR!, "configuration"), {
      recursive: true,
    });
    await writeFile(
      join(environment.NEUTRALNEWS_DATA_DIR!, configPath),
      `${JSON.stringify({
        schemaVersion: 1,
        configurationVersion: 1,
        activeSelection: { providerId: "openai", modelId: "gpt-5.6-terra" },
        credentialReferences: [],
        providerOverrides: [],
        modelOverrides: initialAiProviderCatalogSnapshot.models.map((model) =>
          model.modelId === "gpt-5.6-sol"
            ? { ...model, compatibilityStatus: "incompatible" }
            : model,
        ),
        modelSynchronizations: [
          {
            providerId: "openai",
            syncedAt: "2026-08-22T00:00:00.000Z",
            remoteModels: [{ id: "gpt-5.6-terra" }, { id: "gpt-5.6-sol" }],
          },
        ],
      })}\n`,
    );

    const response = await fetchFromApp(
      "/api/configuration/ai/active-selection",
      environment,
      {
        method: "PUT",
        json: { providerId: "openai", modelId: "gpt-5.6-sol" },
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "AiModelIncompatible",
        providerId: "openai",
        modelId: "gpt-5.6-sol",
      },
    });
    expect(
      (await readStoredConfiguration(environment.NEUTRALNEWS_DATA_DIR!))
        .activeSelection,
    ).toEqual({ providerId: "openai", modelId: "gpt-5.6-terra" });
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
    const credentialVault = createInMemoryCredentialVault();
    const aiProvider = createFakeAiGenerationPort({
      remoteModels: [{ id: "gpt-5.6-terra" }, { id: "gpt-5.6-sol" }],
    });
    let invalidations = 0;
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
      {
        credentialVault,
        aiProvider,
        clearFeedCache: async () => {
          invalidations += 1;
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      configurationVersion: 4,
      activeSelection: { providerId: "openai", modelId: "gpt-5.6-sol" },
    });
    expect(invalidations).toBe(1);
  });

  it("does not persist an active selection when feed invalidation fails", async () => {
    const environment = await createValidEnvironment();
    const credentialVault = createInMemoryCredentialVault();
    const aiProvider = createFakeAiGenerationPort({
      remoteModels: [{ id: "gpt-5.6-terra" }, { id: "gpt-5.6-sol" }],
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
      {
        credentialVault,
        aiProvider,
        clearFeedCache: async () => {
          throw new Error("feed invalidation failed");
        },
      },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "InternalServerError" });
    expect(await readStoredConfiguration(environment.NEUTRALNEWS_DATA_DIR!))
      .toMatchObject({
        configurationVersion: 3,
        activeSelection: { providerId: "openai", modelId: "gpt-5.6-terra" },
      });
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
    expect(synced.status).toBe(502);
    const syncedBody = await synced.text();
    expect(JSON.parse(syncedBody)).toEqual({
      error: {
        code: "AiProviderRemoteError",
        providerId: "openai",
        category: "TransientFailure",
        statusCode: 503,
      },
    });
    expect(syncedBody).not.toContain(apiKey);
  });

  it("returns credential unavailable when model sync cannot read provider credentials", async () => {
    const environment = await createValidEnvironment();
    const credentialVault = createInMemoryCredentialVault();
    const aiProvider = createFakeAiGenerationPort({
      listAccessibleModelsResult: err(
        new AiCredentialUnavailableError("openai", "api_key"),
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

    const response = await fetchFromApp(
      "/api/configuration/ai/providers/openai/models/sync",
      environment,
      { method: "POST" },
      { credentialVault, aiProvider },
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
});
