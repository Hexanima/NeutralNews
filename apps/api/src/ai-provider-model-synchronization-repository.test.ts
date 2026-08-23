import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isOk } from "app-domain";
import { afterEach, describe, expect, it } from "vitest";

import { createJsonAiProviderConfigurationRepository } from "./ai-provider-configuration-repository.js";

const temporaryDirectories: string[] = [];
const configPath = join("configuration", "ai-providers.json");
const syncedAt = "2026-08-22T18:30:00.000Z";

const createTemporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "neutralnews-ai-sync-"));
  temporaryDirectories.push(directory);

  return directory;
};

const readStoredConfiguration = async (directory: string) =>
  JSON.parse(await readFile(join(directory, configPath), "utf8")) as {
    configurationVersion: number;
    credentialReferences: unknown[];
    modelSynchronizations: unknown[];
  };

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("JSON AI provider model synchronization repository", () => {
  it("migrates legacy AI provider configuration snapshots with empty model synchronizations", async () => {
    const directory = await createTemporaryDirectory();
    await mkdir(join(directory, "configuration"));
    await writeFile(
      join(directory, configPath),
      `${JSON.stringify({
        schemaVersion: 1,
        configurationVersion: 4,
        activeSelection: { providerId: "openai", modelId: "gpt-5.6-terra" },
        credentialReferences: [
          { providerId: "openai", fieldId: "api_key", reference: "cred_v1_existing" },
        ],
        providerOverrides: [],
        modelOverrides: [],
      })}\n`,
    );
    const repository = createJsonAiProviderConfigurationRepository(directory);

    const result = await repository.getEffectiveConfiguration();

    expect(result.ok).toBe(true);
    if (!isOk(result)) {
      throw result.error;
    }
    expect(result.value.modelSynchronizations).toEqual([]);
    expect(await readStoredConfiguration(directory)).toMatchObject({
      configurationVersion: 4,
      credentialReferences: [
        { providerId: "openai", fieldId: "api_key", reference: "cred_v1_existing" },
      ],
      modelSynchronizations: [],
    });
  });

  it("persists the latest successful model synchronization without leaking credential values", async () => {
    const directory = await createTemporaryDirectory();
    const repository = createJsonAiProviderConfigurationRepository(directory);
    await repository.saveCredentialReference({
      providerId: "openai",
      fieldId: "api_key",
      reference: "cred_v1_visible_reference",
      secretValue: "sk-should-never-be-written",
    });

    const saved = await repository.saveModelSynchronization({
      providerId: "openai",
      syncedAt,
      remoteModels: [
        { id: "gpt-5.6-terra", ownedBy: "openai" },
        { id: "gpt-remote-new", createdAt: "2026-08-22T00:00:00.000Z" },
      ],
    });

    expect(saved.ok).toBe(true);
    if (!isOk(saved)) {
      throw saved.error;
    }
    expect(saved.value.configurationVersion).toBe(3);
    expect(saved.value.modelSynchronizations).toEqual([
      {
        providerId: "openai",
        syncedAt,
        remoteModels: [
          { id: "gpt-5.6-terra", ownedBy: "openai" },
          { id: "gpt-remote-new", createdAt: "2026-08-22T00:00:00.000Z" },
        ],
      },
    ]);
    expect(
      saved.value.models.find((model) => model.modelId === "gpt-remote-new"),
    ).toMatchObject({ compatibilityStatus: "unknown", availabilityStatus: "available" });

    const storedBody = await readFile(join(directory, configPath), "utf8");
    expect(storedBody).toContain("cred_v1_visible_reference");
    expect(storedBody).not.toContain("sk-should-never-be-written");
    expect(await readStoredConfiguration(directory)).toMatchObject({
      configurationVersion: 3,
      modelSynchronizations: saved.value.modelSynchronizations,
    });
  });
});
