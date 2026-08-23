import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createFakeAiGenerationPort,
  err,
  ExternalPortError,
  isOk,
} from "app-domain";
import { afterEach, describe, expect, it } from "vitest";

import { createJsonAiProviderConfigurationRepository } from "./ai-provider-configuration-repository.js";
import { syncAiProviderModels } from "./ai-provider-model-synchronization-service.js";

const temporaryDirectories: string[] = [];
const configPath = join("configuration", "ai-providers.json");
const syncedAt = "2026-08-22T18:30:00.000Z";

const createTemporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "neutralnews-ai-sync-service-"));
  temporaryDirectories.push(directory);

  return directory;
};

const readStoredConfiguration = async (directory: string) =>
  JSON.parse(await readFile(join(directory, configPath), "utf8")) as {
    configurationVersion: number;
    modelSynchronizations: unknown[];
  };

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("AI provider model synchronization service", () => {
  it("manually synchronizes accessible models through the configured provider port", async () => {
    const directory = await createTemporaryDirectory();
    const repository = createJsonAiProviderConfigurationRepository(directory);
    const aiProvider = createFakeAiGenerationPort({
      remoteModels: [
        { id: "gpt-5.6-terra", ownedBy: "openai" },
        { id: "gpt-remote-new", ownedBy: "openai" },
      ],
    });

    const result = await syncAiProviderModels({
      providerId: "openai",
      configurationRepository: repository,
      aiProvider,
      now: () => new Date(syncedAt),
    });

    expect(result.ok).toBe(true);
    if (!isOk(result)) {
      throw result.error;
    }
    expect(aiProvider.calls.listAccessibleModels).toEqual([
      { providerId: "openai" },
    ]);
    expect(result.value.warning).toBeUndefined();
    expect(
      result.value.configuration.models.find(
        (model) => model.modelId === "gpt-5.6-terra",
      ),
    ).toMatchObject({ availabilityStatus: "available" });
    expect(
      result.value.configuration.models.find(
        (model) => model.modelId === "gpt-5.6-sol",
      ),
    ).toMatchObject({ availabilityStatus: "unavailable" });
    expect(
      result.value.configuration.models.find(
        (model) => model.modelId === "gpt-remote-new",
      ),
    ).toMatchObject({ compatibilityStatus: "unknown", availabilityStatus: "available" });
    expect(await readStoredConfiguration(directory)).toMatchObject({
      configurationVersion: 2,
      modelSynchronizations: [
        {
          providerId: "openai",
          syncedAt,
          remoteModels: [
            { id: "gpt-5.6-terra", ownedBy: "openai" },
            { id: "gpt-remote-new", ownedBy: "openai" },
          ],
        },
      ],
    });
  });

  it("keeps the last valid synchronization when the remote provider fails", async () => {
    const directory = await createTemporaryDirectory();
    const repository = createJsonAiProviderConfigurationRepository(directory);
    const successfulProvider = createFakeAiGenerationPort({
      remoteModels: [{ id: "gpt-5.6-terra" }],
    });
    await syncAiProviderModels({
      providerId: "openai",
      configurationRepository: repository,
      aiProvider: successfulProvider,
      now: () => new Date(syncedAt),
    });
    const storedBeforeFailure = await readFile(join(directory, configPath), "utf8");
    const remoteError = new ExternalPortError(
      "openai.models.list",
      "TransientFailure",
    );
    const failingProvider = createFakeAiGenerationPort({
      listAccessibleModelsResult: err(remoteError),
    });

    const result = await syncAiProviderModels({
      providerId: "openai",
      configurationRepository: repository,
      aiProvider: failingProvider,
      now: () => new Date("2026-08-22T19:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected model synchronization to fail");
    }
    expect(result.error).toBe(remoteError);
    expect(await readFile(join(directory, configPath), "utf8")).toBe(
      storedBeforeFailure,
    );
  });
});
