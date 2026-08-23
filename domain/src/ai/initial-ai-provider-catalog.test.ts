import { describe, expect, it } from "vitest";

import {
  createAiProviderCatalog,
  initialAiProviderCatalogSnapshot,
  isOk,
} from "../index.js";

const findOpenAiProvider = () =>
  initialAiProviderCatalogSnapshot.providers.find(
    (provider) => provider.id === "openai",
  );

const openAiModels = () =>
  initialAiProviderCatalogSnapshot.models.filter(
    (model) => model.providerId === "openai",
  );

describe("initial AI provider catalog", () => {
  it("defines a versioned OpenAI catalog with the required API key secret field", () => {
    const result = createAiProviderCatalog(initialAiProviderCatalogSnapshot);

    expect(result.ok).toBe(true);
    if (!isOk(result)) {
      throw result.error;
    }

    expect(result.value.schemaVersion).toBe(1);
    expect(findOpenAiProvider()).toMatchObject({
      id: "openai",
      name: "OpenAI",
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
    });
  });

  it("includes the initial OpenAI models as configurable data with capabilities and compatibility", () => {
    const models = openAiModels();

    expect(models.map((model) => model.modelId)).toEqual([
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "gpt-5.6-luna",
    ]);
    for (const model of models) {
      expect(model.remoteModelId).toBe(model.modelId);
      expect(model.capabilities).toContain("structured_outputs");
      expect(model.capabilities).toContain("web_search");
      expect(
        model.capabilities.some((capability) =>
          capability.startsWith("reasoning_"),
        ),
      ).toBe(true);
      expect(model.compatibilityStatus).toBe("compatible");
    }
  });

  it("rejects unknown schema versions", () => {
    const result = createAiProviderCatalog({
      ...initialAiProviderCatalogSnapshot,
      schemaVersion: 2,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects invalid schema versions, duplicate models, and models without providers", () => {
    const invalidSchema = createAiProviderCatalog({
      ...initialAiProviderCatalogSnapshot,
      schemaVersion: 0,
    });
    const duplicateModel = createAiProviderCatalog({
      ...initialAiProviderCatalogSnapshot,
      models: [
        ...initialAiProviderCatalogSnapshot.models,
        initialAiProviderCatalogSnapshot.models[0]!,
      ],
    });
    const missingProvider = createAiProviderCatalog({
      ...initialAiProviderCatalogSnapshot,
      models: [
        {
          ...initialAiProviderCatalogSnapshot.models[0]!,
          providerId: "missing",
        },
      ],
    });

    expect(invalidSchema.ok).toBe(false);
    expect(duplicateModel.ok).toBe(false);
    expect(missingProvider.ok).toBe(false);
  });
});
