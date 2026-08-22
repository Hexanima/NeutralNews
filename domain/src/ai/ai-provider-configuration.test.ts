import { describe, expect, it } from "vitest";

import {
  createAiProviderConfigurationSnapshot,
  createDefaultAiProviderConfigurationSnapshot,
  createEffectiveAiProviderConfiguration,
  initialAiProviderCatalogSnapshot,
  isOk,
  validateAiModelSelection,
  type AiProviderCatalogSnapshot,
  type AiProviderConfigurationSnapshot,
} from "../index.js";

const customCatalog = {
  schemaVersion: 1,
  providers: [
    {
      id: "custom",
      name: "Custom AI",
      credentialSchema: {
        fields: [
          {
            id: "token",
            label: "Token",
            type: "secret",
            required: true,
          },
        ],
      },
    },
  ],
  models: [
    {
      providerId: "custom",
      modelId: "custom-compatible",
      remoteModelId: "custom-compatible",
      capabilities: ["structured_outputs", "web_search", "reasoning_medium"],
      compatibilityStatus: "compatible",
    },
  ],
} satisfies AiProviderCatalogSnapshot;

const effectiveFrom = (
  snapshot: AiProviderConfigurationSnapshot | null,
  catalog: AiProviderCatalogSnapshot = initialAiProviderCatalogSnapshot,
) => {
  const configuration = createEffectiveAiProviderConfiguration(
    catalog,
    snapshot,
  );

  expect(configuration.ok).toBe(true);
  if (!isOk(configuration)) {
    throw configuration.error;
  }

  return configuration.value;
};

describe("AI provider effective configuration", () => {
  it("creates defaults from the provided catalog and selects its first compatible model", () => {
    const defaultSnapshot = createDefaultAiProviderConfigurationSnapshot(customCatalog);
    const configuration = effectiveFrom(defaultSnapshot, customCatalog);

    expect(defaultSnapshot).toEqual({
      schemaVersion: 1,
      configurationVersion: 1,
      activeSelection: { providerId: "custom", modelId: "custom-compatible" },
      credentialReferences: [],
      providerOverrides: [],
      modelOverrides: [],
    });
    expect(configuration.activeSelection).toEqual({
      providerId: "custom",
      modelId: "custom-compatible",
    });
    expect(configuration.providers.map((provider) => provider.id)).toEqual([
      "custom",
    ]);
    expect(configuration.models.map((model) => model.modelId)).toEqual([
      "custom-compatible",
    ]);
  });

  it("uses Terra on first startup because the initial catalog orders it first", () => {
    const configuration = effectiveFrom(null);

    expect(configuration.activeSelection).toEqual({
      providerId: "openai",
      modelId: "gpt-5.6-terra",
    });
  });

  it("applies local provider and model overrides without changing model IDs in domain logic", () => {
    const sol = initialAiProviderCatalogSnapshot.models.find(
      (model) => model.modelId === "gpt-5.6-sol",
    )!;
    const snapshot = createAiProviderConfigurationSnapshot({
      schemaVersion: 1,
      configurationVersion: 4,
      activeSelection: { providerId: "openai", modelId: "gpt-5.6-sol" },
      credentialReferences: [
        {
          providerId: "openai",
          fieldId: "api_key",
          reference: "cred_v1_local_reference",
        },
      ],
      providerOverrides: [
        {
          id: "openai",
          name: "OpenAI Local",
          credentialSchema: {
            fields: [
              {
                id: "api_key",
                label: "API key",
                type: "secret",
                required: true,
              },
            ],
          },
        },
      ],
      modelOverrides: [
        {
          ...sol,
          remoteModelId: "gpt-5.6-sol-override",
          compatibilityStatus: "unknown",
        },
      ],
    });

    expect(snapshot.ok).toBe(true);
    if (!isOk(snapshot)) {
      throw snapshot.error;
    }

    const configuration = effectiveFrom(snapshot.value);

    expect(configuration.configurationVersion).toBe(4);
    expect(configuration.providers[0]?.name).toBe("OpenAI Local");
    expect(
      configuration.models.find((model) => model.modelId === "gpt-5.6-sol"),
    ).toMatchObject({
      modelId: "gpt-5.6-sol",
      remoteModelId: "gpt-5.6-sol-override",
      compatibilityStatus: "unknown",
    });
    expect(configuration.credentialReferences).toEqual([
      {
        providerId: "openai",
        fieldId: "api_key",
        reference: "cred_v1_local_reference",
      },
    ]);
  });

  it("parses active selections without depending on a built-in catalog", () => {
    const snapshot = createAiProviderConfigurationSnapshot({
      schemaVersion: 1,
      configurationVersion: 1,
      activeSelection: { providerId: "runtime", modelId: "runtime-model" },
      credentialReferences: [],
      providerOverrides: [],
      modelOverrides: [],
    });

    expect(snapshot.ok).toBe(true);
    if (isOk(snapshot)) {
      expect(snapshot.value.activeSelection).toEqual({
        providerId: "runtime",
        modelId: "runtime-model",
      });
    }
  });

  it("rejects effective selections that point to missing or incompatible models in the provided catalog", () => {
    const missingSelection = createEffectiveAiProviderConfiguration(
      initialAiProviderCatalogSnapshot,
      {
        schemaVersion: 1,
        configurationVersion: 1,
        activeSelection: { providerId: "openai", modelId: "missing" },
        credentialReferences: [],
        providerOverrides: [],
        modelOverrides: [],
      },
    );
    const incompatibleSelection = createEffectiveAiProviderConfiguration(
      initialAiProviderCatalogSnapshot,
      {
        schemaVersion: 1,
        configurationVersion: 1,
        activeSelection: { providerId: "openai", modelId: "gpt-5.6-luna" },
        credentialReferences: [],
        providerOverrides: [],
        modelOverrides: [
          {
            ...initialAiProviderCatalogSnapshot.models.find(
              (model) => model.modelId === "gpt-5.6-luna",
            )!,
            compatibilityStatus: "incompatible",
          },
        ],
      },
    );

    expect(missingSelection.ok).toBe(false);
    expect(incompatibleSelection.ok).toBe(false);
  });

  it("keeps model IDs as data consumed through generic selection validation", () => {
    const configuration = effectiveFrom(null);
    const result = validateAiModelSelection({
      providers: configuration.providers,
      models: configuration.models,
      selection: { providerId: "openai", modelId: "gpt-5.6-luna" },
      requiredCapabilities: ["structured_outputs", "web_search"],
    });

    expect(result.ok).toBe(true);
  });
});
