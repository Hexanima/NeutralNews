import { describe, expect, it } from "vitest";

import {
  createAiProviderConfigurationSnapshot,
  createDefaultAiProviderConfigurationSnapshot,
  createEffectiveAiProviderConfiguration,
  initialAiProviderCatalogSnapshot,
  isOk,
  validateAiModelSelection,
  type AiProviderConfigurationSnapshot,
} from "../index.js";

const effectiveFrom = (snapshot: AiProviderConfigurationSnapshot | null) => {
  const configuration = createEffectiveAiProviderConfiguration(
    initialAiProviderCatalogSnapshot,
    snapshot,
  );

  expect(configuration.ok).toBe(true);
  if (!isOk(configuration)) {
    throw configuration.error;
  }

  return configuration.value;
};

describe("AI provider effective configuration", () => {
  it("creates defaults from the initial catalog and selects Terra by provider/model", () => {
    const defaultSnapshot = createDefaultAiProviderConfigurationSnapshot();
    const configuration = effectiveFrom(defaultSnapshot);

    expect(defaultSnapshot).toEqual({
      schemaVersion: 1,
      configurationVersion: 1,
      activeSelection: { providerId: "openai", modelId: "gpt-5.6-terra" },
      credentialReferences: [],
      providerOverrides: [],
      modelOverrides: [],
    });
    expect(configuration.activeSelection).toEqual({
      providerId: "openai",
      modelId: "gpt-5.6-terra",
    });
    expect(configuration.providers.map((provider) => provider.id)).toEqual([
      "openai",
    ]);
    expect(configuration.models.map((model) => model.modelId)).toEqual([
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "gpt-5.6-luna",
    ]);
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

  it("rejects active selections that point to missing or incompatible models", () => {
    const missingSelection = createAiProviderConfigurationSnapshot({
      schemaVersion: 1,
      configurationVersion: 1,
      activeSelection: { providerId: "openai", modelId: "missing" },
      credentialReferences: [],
      providerOverrides: [],
      modelOverrides: [],
    });
    const incompatibleSelection = createAiProviderConfigurationSnapshot({
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
    });

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
