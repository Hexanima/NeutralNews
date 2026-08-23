import type { AiProviderCatalogSnapshot } from "./ai-provider-catalog.js";

export const initialAiProviderCatalogSnapshot = {
  schemaVersion: 1,
  providers: [
    {
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
    },
  ],
  models: [
    {
      providerId: "openai",
      modelId: "gpt-5.6-terra",
      remoteModelId: "gpt-5.6-terra",
      capabilities: ["structured_outputs", "web_search", "reasoning_high"],
      compatibilityStatus: "compatible",
      availabilityStatus: "unknown",
    },
    {
      providerId: "openai",
      modelId: "gpt-5.6-sol",
      remoteModelId: "gpt-5.6-sol",
      capabilities: ["structured_outputs", "web_search", "reasoning_medium"],
      compatibilityStatus: "compatible",
      availabilityStatus: "unknown",
    },
    {
      providerId: "openai",
      modelId: "gpt-5.6-luna",
      remoteModelId: "gpt-5.6-luna",
      capabilities: ["structured_outputs", "web_search", "reasoning_low"],
      compatibilityStatus: "compatible",
      availabilityStatus: "unknown",
    },
  ],
} satisfies AiProviderCatalogSnapshot;
