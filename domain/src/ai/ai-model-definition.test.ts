import { describe, expect, it } from "vitest";

import {
  AiCapabilityUnavailableError,
  AiModelNotFoundError,
  AiProviderNotFoundError,
  isErr,
  isOk,
  type AiModelDefinition,
  type AiModelSelection,
  type AiProviderDefinition,
  validateAiModelSelection,
} from "../index.js";

const provider: AiProviderDefinition = {
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
};

const model: AiModelDefinition = {
  providerId: "openai",
  modelId: "gpt-5-mini",
  remoteModelId: "gpt-5-mini",
  capabilities: ["structured_outputs", "web_search", "reasoning_medium"],
  compatibilityStatus: "compatible",
};

describe("AI model definitions", () => {
  it("describes providers, credential fields, models, and active selection as data", () => {
    const selection: AiModelSelection = {
      providerId: "openai",
      modelId: "gpt-5-mini",
    };

    expect(provider).toEqual({
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
    expect(model.remoteModelId).toBe("gpt-5-mini");
    expect(model.capabilities).toContain("structured_outputs");
    expect(model.capabilities).toContain("web_search");
    expect(model.capabilities).toContain("reasoning_medium");
    expect(model.compatibilityStatus).toBe("compatible");
    expect(selection).toEqual({ providerId: "openai", modelId: "gpt-5-mini" });
  });

  it("accepts a selection when the provider, model, and required capabilities match", () => {
    const result = validateAiModelSelection({
      providers: [provider],
      models: [model],
      selection: { providerId: "openai", modelId: "gpt-5-mini" },
      requiredCapabilities: ["structured_outputs", "reasoning_low"],
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.provider).toBe(provider);
      expect(result.value.model).toBe(model);
    }
  });

  it("rejects a selected model that cannot satisfy a required capability", () => {
    const result = validateAiModelSelection({
      providers: [provider],
      models: [{ ...model, capabilities: ["structured_outputs"] }],
      selection: { providerId: "openai", modelId: "gpt-5-mini" },
      requiredCapabilities: ["web_search"],
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(AiCapabilityUnavailableError);
      expect(result.error.capability).toBe("web_search");
    }
  });

  it("rejects a selected model with an insufficient reasoning level", () => {
    const result = validateAiModelSelection({
      providers: [provider],
      models: [{ ...model, capabilities: ["structured_outputs", "reasoning_low"] }],
      selection: { providerId: "openai", modelId: "gpt-5-mini" },
      requiredCapabilities: ["reasoning_high"],
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(AiCapabilityUnavailableError);
      expect(result.error.capability).toBe("reasoning_high");
    }
  });

  it("rejects selections that reference unknown providers or models", () => {
    const missingProvider = validateAiModelSelection({
      providers: [provider],
      models: [model],
      selection: { providerId: "anthropic", modelId: "claude-sonnet" },
      requiredCapabilities: [],
    });
    const missingModel = validateAiModelSelection({
      providers: [provider],
      models: [model],
      selection: { providerId: "openai", modelId: "gpt-unknown" },
      requiredCapabilities: [],
    });

    expect(isErr(missingProvider)).toBe(true);
    expect(isErr(missingModel)).toBe(true);
    if (isErr(missingProvider)) {
      expect(missingProvider.error).toBeInstanceOf(AiProviderNotFoundError);
    }
    if (isErr(missingModel)) {
      expect(missingModel.error).toBeInstanceOf(AiModelNotFoundError);
    }
  });
});
