import { describe, expect, it } from "vitest";

import {
  createEffectiveAiProviderConfiguration,
  initialAiProviderCatalogSnapshot,
  isOk,
  synchronizeAiProviderModels,
  validateAiModelSelection,
  type AiProviderConfigurationSnapshot,
} from "../index.js";

const syncedAt = "2026-08-22T18:30:00.000Z";

describe("AI model availability synchronization", () => {
  it("marks known models by remote availability while preserving local capabilities", () => {
    const result = synchronizeAiProviderModels({
      providerId: "openai",
      syncedAt,
      models: initialAiProviderCatalogSnapshot.models,
      remoteModels: [
        { id: "gpt-5.6-terra", ownedBy: "openai" },
        { id: "gpt-remote-new", ownedBy: "openai" },
      ],
    });

    expect(result.synchronization).toEqual({
      providerId: "openai",
      syncedAt,
      remoteModels: [
        { id: "gpt-5.6-terra", ownedBy: "openai" },
        { id: "gpt-remote-new", ownedBy: "openai" },
      ],
    });
    expect(
      result.models.find((model) => model.modelId === "gpt-5.6-terra"),
    ).toMatchObject({
      availabilityStatus: "available",
      capabilities: ["structured_outputs", "web_search", "reasoning_high"],
    });
    expect(
      result.models.find((model) => model.modelId === "gpt-5.6-sol"),
    ).toMatchObject({
      availabilityStatus: "unavailable",
      capabilities: ["structured_outputs", "web_search", "reasoning_medium"],
    });
    expect(
      result.models.find((model) => model.modelId === "gpt-remote-new"),
    ).toEqual({
      providerId: "openai",
      modelId: "gpt-remote-new",
      remoteModelId: "gpt-remote-new",
      capabilities: [],
      compatibilityStatus: "unknown",
      availabilityStatus: "available",
    });
  });

  it("applies the last valid synchronization to effective configuration", () => {
    const snapshot: AiProviderConfigurationSnapshot = {
      schemaVersion: 1,
      configurationVersion: 2,
      activeSelection: { providerId: "openai", modelId: "gpt-5.6-terra" },
      credentialReferences: [],
      providerOverrides: [],
      modelOverrides: [],
      modelSynchronizations: [
        {
          providerId: "openai",
          syncedAt,
          remoteModels: [
            { id: "gpt-5.6-terra" },
            { id: "gpt-remote-new", ownedBy: "openai" },
          ],
        },
      ],
    };

    const configuration = createEffectiveAiProviderConfiguration(
      initialAiProviderCatalogSnapshot,
      snapshot,
    );

    expect(configuration.ok).toBe(true);
    if (!isOk(configuration)) {
      throw configuration.error;
    }

    expect(configuration.value.modelSynchronizations).toEqual(
      snapshot.modelSynchronizations,
    );
    expect(
      configuration.value.models.find((model) => model.modelId === "gpt-5.6-sol"),
    ).toMatchObject({ availabilityStatus: "unavailable" });
    expect(
      configuration.value.models.find((model) => model.modelId === "gpt-remote-new"),
    ).toMatchObject({
      compatibilityStatus: "unknown",
      availabilityStatus: "available",
      capabilities: [],
    });
  });

  it("rejects selections for unavailable and unmapped remote models", () => {
    const synchronized = synchronizeAiProviderModels({
      providerId: "openai",
      syncedAt,
      models: initialAiProviderCatalogSnapshot.models,
      remoteModels: [
        { id: "gpt-5.6-terra" },
        { id: "gpt-remote-new" },
      ],
    });

    const unavailable = validateAiModelSelection({
      providers: initialAiProviderCatalogSnapshot.providers,
      models: synchronized.models,
      selection: { providerId: "openai", modelId: "gpt-5.6-sol" },
      requiredCapabilities: [],
    });
    const unmapped = validateAiModelSelection({
      providers: initialAiProviderCatalogSnapshot.providers,
      models: synchronized.models,
      selection: { providerId: "openai", modelId: "gpt-remote-new" },
      requiredCapabilities: [],
    });

    expect(unavailable.ok).toBe(false);
    expect(unmapped.ok).toBe(false);
  });
});
