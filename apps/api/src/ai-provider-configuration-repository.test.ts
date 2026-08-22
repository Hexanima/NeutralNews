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
  initialAiProviderCatalogSnapshot,
  isOk,
} from "app-domain";
import { afterEach, describe, expect, it } from "vitest";

import { createJsonAiProviderConfigurationRepository } from "./ai-provider-configuration-repository.js";

const temporaryDirectories: string[] = [];
const configPath = join("configuration", "ai-providers.json");

const createTemporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "neutralnews-ai-"));
  temporaryDirectories.push(directory);

  return directory;
};

const readStoredConfiguration = async (directory: string) =>
  JSON.parse(await readFile(join(directory, configPath), "utf8")) as {
    schemaVersion: number;
    configurationVersion: number;
    activeSelection: unknown;
    credentialReferences: unknown[];
    providerOverrides: unknown[];
    modelOverrides: unknown[];
  };

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("JSON AI provider configuration repository", () => {
  it("creates the effective configuration from defaults on first startup", async () => {
    const directory = await createTemporaryDirectory();
    const repository = createJsonAiProviderConfigurationRepository(directory);

    const result = await repository.getEffectiveConfiguration();

    expect(result.ok).toBe(true);
    if (!isOk(result)) {
      throw result.error;
    }

    expect(result.value.configurationVersion).toBe(1);
    expect(result.value.activeSelection).toEqual({
      providerId: "openai",
      modelId: "gpt-5.6-terra",
    });
    expect(result.value.models.map((model) => model.modelId)).toEqual(
      initialAiProviderCatalogSnapshot.models.map((model) => model.modelId),
    );
    expect(await readStoredConfiguration(directory)).toEqual({
      schemaVersion: 1,
      configurationVersion: 1,
      activeSelection: { providerId: "openai", modelId: "gpt-5.6-terra" },
      credentialReferences: [],
      providerOverrides: [],
      modelOverrides: [],
    });
  });

  it("persists the active provider/model selection and increments the configuration version", async () => {
    const directory = await createTemporaryDirectory();
    const repository = createJsonAiProviderConfigurationRepository(directory);

    const saved = await repository.saveActiveSelection({
      selection: { providerId: "openai", modelId: "gpt-5.6-sol" },
    });

    expect(saved.ok).toBe(true);
    if (!isOk(saved)) {
      throw saved.error;
    }

    expect(saved.value.configurationVersion).toBe(2);
    expect(saved.value.activeSelection).toEqual({
      providerId: "openai",
      modelId: "gpt-5.6-sol",
    });
    expect(await readStoredConfiguration(directory)).toMatchObject({
      schemaVersion: 1,
      configurationVersion: 2,
      activeSelection: { providerId: "openai", modelId: "gpt-5.6-sol" },
    });
  });

  it("persists only opaque credential references and never secret values", async () => {
    const directory = await createTemporaryDirectory();
    const repository = createJsonAiProviderConfigurationRepository(directory);

    const saved = await repository.saveCredentialReference({
      providerId: "openai",
      fieldId: "api_key",
      reference: "cred_v1_visible_reference",
      secretValue: "sk-should-never-be-written",
    });

    expect(saved.ok).toBe(true);
    if (!isOk(saved)) {
      throw saved.error;
    }

    const storedBody = await readFile(join(directory, configPath), "utf8");
    expect(storedBody).toContain("cred_v1_visible_reference");
    expect(storedBody).not.toContain("sk-should-never-be-written");
    expect(await readStoredConfiguration(directory)).toMatchObject({
      configurationVersion: 2,
      credentialReferences: [
        {
          providerId: "openai",
          fieldId: "api_key",
          reference: "cred_v1_visible_reference",
        },
      ],
    });
  });

  it("recovers defaults when the local JSON violates the configuration schema", async () => {
    const directory = await createTemporaryDirectory();
    await mkdir(join(directory, "configuration"));
    await writeFile(
      join(directory, configPath),
      `${JSON.stringify({
        schemaVersion: 1,
        configurationVersion: 9,
        activeSelection: { providerId: "openai", modelId: "missing" },
        credentialReferences: [],
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

    expect(result.value.configurationVersion).toBe(1);
    expect(await readStoredConfiguration(directory)).toEqual({
      schemaVersion: 1,
      configurationVersion: 1,
      activeSelection: { providerId: "openai", modelId: "gpt-5.6-terra" },
      credentialReferences: [],
      providerOverrides: [],
      modelOverrides: [],
    });
  });

  it("recovers defaults when the local JSON is corrupt and keeps a recoverable copy", async () => {
    const directory = await createTemporaryDirectory();
    await mkdir(join(directory, "configuration"));
    await writeFile(join(directory, configPath), "{\"schemaVersion\":");
    const repository = createJsonAiProviderConfigurationRepository(directory);

    const result = await repository.getEffectiveConfiguration();

    expect(result.ok).toBe(true);
    if (!isOk(result)) {
      throw result.error;
    }

    expect(result.value.configurationVersion).toBe(1);
    expect(await readStoredConfiguration(directory)).toEqual({
      schemaVersion: 1,
      configurationVersion: 1,
      activeSelection: { providerId: "openai", modelId: "gpt-5.6-terra" },
      credentialReferences: [],
      providerOverrides: [],
      modelOverrides: [],
    });
    expect(
      (await readdir(join(directory, "configuration"))).some((fileName) =>
        fileName.startsWith("ai-providers.json.corrupt-"),
      ),
    ).toBe(true);
  });
});
