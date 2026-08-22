import {
  AiCapabilityUnavailableError,
  AiCredentialUnavailableError,
  AiInvalidStructuredOutputError,
  AiProviderRejectedError,
  ExternalPortError,
  PortCancelledError,
  PortLimitExceededError,
  initialAiProviderCatalogSnapshot,
  isErr,
  isOk,
  ok,
  type AiModelDefinition,
  type EffectiveAiProviderConfiguration,
  type Result,
} from "app-domain";
import { describe, expect, it } from "vitest";

import { createInMemoryCredentialVault } from "./credential-vault.js";
import { createOpenAiAiProviderAdapter } from "./openai-ai-provider-adapter.js";
import type { JsonAiProviderConfigurationRepository } from "./ai-provider-configuration-repository.js";

interface FakeResponsesResource {
  calls: unknown[];
  createResult?: unknown;
  createError?: unknown;
  create: (body: unknown, options?: unknown) => Promise<unknown>;
}

interface FakeModelsResource {
  calls: unknown[];
  listResult?: unknown;
  listError?: unknown;
  list: (options?: unknown) => Promise<unknown>;
}

interface FakeOpenAiClient {
  responses: FakeResponsesResource;
  models: FakeModelsResource;
}

const selectedModel = initialAiProviderCatalogSnapshot.models[0]!;

const createFakeClient = (): FakeOpenAiClient => ({
  responses: {
    calls: [],
    createResult: {
      output_text: JSON.stringify({ summary: "ok" }),
      output: [
        {
          content: [
            {
              annotations: [
                {
                  type: "url_citation",
                  url: "https://example.com/noticia",
                  title: "Noticia",
                },
              ],
            },
          ],
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        input_tokens_details: { cached_tokens: 2 },
      },
    },
    create: async function create(body) {
      this.calls.push(body);

      if (this.createError !== undefined) {
        throw this.createError;
      }

      return this.createResult;
    },
  },
  models: {
    calls: [],
    listResult: {
      data: [
        {
          id: "gpt-5.6-terra",
          created: 1784980800,
          owned_by: "openai",
        },
      ],
    },
    list: async function list(options) {
      this.calls.push(options);

      if (this.listError !== undefined) {
        throw this.listError;
      }

      return this.listResult;
    },
  },
});


const createPaginatedModels = (pages: readonly (readonly unknown[])[]) => ({
  async *[Symbol.asyncIterator]() {
    for (const page of pages) {
      for (const model of page) {
        yield model;
      }
    }
  },
});
const createRepository = (
  reference: string | null,
  models: readonly AiModelDefinition[] = initialAiProviderCatalogSnapshot.models,
): JsonAiProviderConfigurationRepository => {
  const configuration: EffectiveAiProviderConfiguration = {
    schemaVersion: 1,
    configurationVersion: 1,
    providers: initialAiProviderCatalogSnapshot.providers,
    models,
    activeSelection: {
      providerId: selectedModel.providerId,
      modelId: selectedModel.modelId,
    },
    credentialReferences:
      reference === null
        ? []
        : [
            {
              providerId: "openai",
              fieldId: "api_key",
              reference,
            },
          ],
    providerOverrides: [],
    modelOverrides: [],
  };

  return {
    getEffectiveConfiguration: async () => ok(configuration),
    saveActiveSelection: async () => ok(configuration),
    saveCredentialReference: async () => ok(configuration),
  };
};

const createAdapter = async (options: {
  client?: FakeOpenAiClient;
  reference?: string | null;
  models?: readonly AiModelDefinition[];
} = {}) => {
  const vault = createInMemoryCredentialVault();
  const saved = options.reference === undefined
    ? await vault.saveSecret("openai", "sk-from-vault")
    : null;
  const reference = options.reference === undefined
    ? (saved !== null && isOk(saved) ? saved.value.reference : null)
    : options.reference;
  const client = options.client ?? createFakeClient();
  const createdApiKeys: string[] = [];
  const adapter = createOpenAiAiProviderAdapter({
    configurationRepository: createRepository(reference, options.models),
    credentialVault: vault,
    createClient: ({ apiKey }) => {
      createdApiKeys.push(apiKey);
      return client;
    },
    externalServicePolicy: {
      timeoutMs: 1000,
      maxAttempts: 1,
      retryDelayMs: 0,
    },
  });

  return { adapter, client, createdApiKeys, vault };
};

describe("OpenAI AI provider adapter", () => {
  it("generates structured output with the configured vault credential and remote model id", async () => {
    const { adapter, client, createdApiKeys } = await createAdapter();

    const result = await adapter.generateStructuredResponse({
      selection: { providerId: "openai", modelId: "gpt-5.6-terra" },
      requiredCapabilities: ["structured_outputs"],
      prompt: "Generar resumen",
      outputSchema: { type: "object", properties: { summary: { type: "string" } } },
    });

    expect(isOk(result)).toBe(true);
    expect(createdApiKeys).toEqual(["sk-from-vault"]);
    expect(client.responses.calls).toHaveLength(1);
    expect(client.responses.calls[0]).toMatchObject({
      model: "gpt-5.6-terra",
      input: "Generar resumen",
      text: {
        format: {
          type: "json_schema",
          name: "neutral_news_response",
          strict: true,
          schema: { type: "object", properties: { summary: { type: "string" } } },
        },
      },
    });
    expect(JSON.stringify(client.responses.calls[0])).not.toContain("sk-from-vault");
    if (isOk(result)) {
      expect(result.value).toEqual({
        output: { summary: "ok" },
        citations: [{ url: "https://example.com/noticia", title: "Noticia" }],
        usage: {
          inputUnits: 10,
          outputUnits: 5,
          cachedInputUnits: 2,
          totalUnits: 15,
          webSearchCalls: 0,
        },
      });
    }
  });

  it("uses Responses web_search only when the selected model declares the capability", async () => {
    const { adapter, client } = await createAdapter();
    client.responses.createResult = {
      output_text: "Resultado con fuentes",
      output: [
        {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            sources: [{ type: "url", url: "https://example.com/fuente" }],
          },
        },
      ],
      usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 },
    };

    const result = await adapter.searchWeb({
      selection: { providerId: "openai", modelId: "gpt-5.6-terra" },
      requiredCapabilities: ["web_search"],
      query: "presupuesto nacional",
      allowedDomains: ["example.com"],
    });

    expect(isOk(result)).toBe(true);
    expect(client.responses.calls[0]).toMatchObject({
      model: "gpt-5.6-terra",
      input: "presupuesto nacional",
      tools: [
        {
          type: "web_search",
          filters: { allowed_domains: ["example.com"] },
        },
      ],
    });
    if (isOk(result)) {
      expect(result.value.text).toBe("Resultado con fuentes");
      expect(result.value.citations).toEqual([{ url: "https://example.com/fuente" }]);
      expect(result.value.usage.webSearchCalls).toBe(1);
    }
  });

  it("rejects missing web search capability before calling OpenAI", async () => {
    const client = createFakeClient();
    const models = initialAiProviderCatalogSnapshot.models.map((model) =>
      model.modelId === "gpt-5.6-terra"
        ? { ...model, capabilities: ["structured_outputs", "reasoning_high"] }
        : model,
    );
    const { adapter } = await createAdapter({ client, models });

    const result = await adapter.searchWeb({
      selection: { providerId: "openai", modelId: "gpt-5.6-terra" },
      requiredCapabilities: ["web_search"],
      query: "presupuesto nacional",
    });

    expect(isErr(result)).toBe(true);
    expect(client.responses.calls).toHaveLength(0);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(AiCapabilityUnavailableError);
    }
  });

  it("lists accessible models from every paginated OpenAI page", async () => {
    const client = createFakeClient();
    client.models.listResult = createPaginatedModels([
      [
        {
          id: "gpt-5.6-terra",
          created: 1784980800,
          owned_by: "openai",
        },
      ],
      [
        {
          id: "gpt-5.6-sol",
          created: 1785067200,
          owned_by: "openai",
        },
      ],
    ]);
    const { adapter } = await createAdapter({ client });

    const result = await adapter.listAccessibleModels({ providerId: "openai" });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.map((model) => model.id)).toEqual([
        "gpt-5.6-terra",
        "gpt-5.6-sol",
      ]);
    }
  });

  it("lists accessible models using the credential stored in the vault", async () => {
    const { adapter, createdApiKeys } = await createAdapter();

    const result = await adapter.listAccessibleModels({ providerId: "openai" });

    expect(isOk(result)).toBe(true);
    expect(createdApiKeys).toEqual(["sk-from-vault"]);
    if (isOk(result)) {
      expect(result.value).toEqual([
        {
          id: "gpt-5.6-terra",
          createdAt: "2026-07-25T12:00:00.000Z",
          ownedBy: "openai",
        },
      ]);
    }
  });

  it("tests an ephemeral credential without writing it to the vault", async () => {
    const client = createFakeClient();
    const { adapter, createdApiKeys, vault } = await createAdapter({ client, reference: null });

    const result = await adapter.testCredential({
      providerId: "openai",
      credentialValues: [{ fieldId: "api_key", value: "sk-ephemeral" }],
    });
    const description = await vault.describeSecret("openai");

    expect(isOk(result)).toBe(true);
    expect(createdApiKeys).toEqual(["sk-ephemeral"]);
    expect(client.models.calls).toHaveLength(1);
    expect(isOk(description) && description.value.configured).toBe(false);
    if (isOk(result)) {
      expect(result.value).toEqual({ providerId: "openai", accessibleModelCount: 1 });
    }
  });

  it("counts every paginated model when testing an ephemeral credential", async () => {
    const client = createFakeClient();
    client.models.listResult = createPaginatedModels([
      [{ id: "gpt-5.6-terra", created: 1784980800, owned_by: "openai" }],
      [{ id: "gpt-5.6-sol", created: 1785067200, owned_by: "openai" }],
      [{ id: "gpt-5.6-luna", created: 1785153600, owned_by: "openai" }],
    ]);
    const { adapter } = await createAdapter({ client, reference: null });

    const result = await adapter.testCredential({
      providerId: "openai",
      credentialValues: [{ fieldId: "api_key", value: "sk-ephemeral" }],
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.accessibleModelCount).toBe(3);
    }
  });

  it("returns a credential error when the configured vault reference is unavailable", async () => {
    const { adapter, client } = await createAdapter({ reference: "cred_v1_missing" });

    const result = await adapter.listAccessibleModels({ providerId: "openai" });

    expect(isErr(result)).toBe(true);
    expect(client.models.calls).toHaveLength(0);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(AiCredentialUnavailableError);
    }
  });

  it("normalizes provider rejection and invalid structured output without leaking secrets or prompts", async () => {
    const rejectedClient = createFakeClient();
    rejectedClient.responses.createError = { status: 401, message: "sk-from-vault Generar resumen" };
    const rejected = await createAdapter({ client: rejectedClient });

    const rejectionResult = await rejected.adapter.generateStructuredResponse({
      selection: { providerId: "openai", modelId: "gpt-5.6-terra" },
      requiredCapabilities: ["structured_outputs"],
      prompt: "Generar resumen",
      outputSchema: { type: "object" },
    });

    expect(isErr(rejectionResult)).toBe(true);
    if (isErr(rejectionResult)) {
      expect(rejectionResult.error).toBeInstanceOf(AiProviderRejectedError);
      expect(JSON.stringify(rejectionResult.error)).not.toContain("sk-from-vault");
      expect(JSON.stringify(rejectionResult.error)).not.toContain("Generar resumen");
    }

    const invalidClient = createFakeClient();
    invalidClient.responses.createResult = { output_text: "no-json" };
    const invalid = await createAdapter({ client: invalidClient });
    const invalidResult = await invalid.adapter.generateStructuredResponse({
      selection: { providerId: "openai", modelId: "gpt-5.6-terra" },
      requiredCapabilities: ["structured_outputs"],
      prompt: "Generar resumen",
      outputSchema: { type: "object" },
    });

    expect(isErr(invalidResult)).toBe(true);
    if (isErr(invalidResult)) {
      expect(invalidResult.error).toBeInstanceOf(AiInvalidStructuredOutputError);
    }
  });

  it("normalizes provider timeouts to the port limit error contract", async () => {
    const client = createFakeClient();
    client.models.list = async function list(options) {
      this.calls.push(options);
      await new Promise(() => undefined);
    };
    const { adapter } = await createAdapter({ client, externalTimeoutMs: 1 });

    const result = await adapter.listAccessibleModels({ providerId: "openai" });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(PortLimitExceededError);
      expect(result.error.limitName).toBe("timeoutMs");
    }
  });

  it("normalizes caller cancellation to the port cancellation error contract", async () => {
    const client = createFakeClient();
    const abortController = new AbortController();
    abortController.abort();
    const { adapter } = await createAdapter({ client });

    const result = await adapter.listAccessibleModels({
      providerId: "openai",
      options: { signal: abortController.signal },
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(PortCancelledError);
    }
  });

  it("rejects structured generation without a JSON schema before calling OpenAI", async () => {
    const client = createFakeClient();
    const { adapter } = await createAdapter({ client });

    const result = await adapter.generateStructuredResponse({
      selection: { providerId: "openai", modelId: "gpt-5.6-terra" },
      requiredCapabilities: ["structured_outputs"],
      prompt: "Generar resumen",
    } as Parameters<typeof adapter.generateStructuredResponse>[0]);

    expect(isErr(result)).toBe(true);
    expect(client.responses.calls).toHaveLength(0);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(AiInvalidStructuredOutputError);
    }
  });
  it("maps transient provider failures through the external port error contract", async () => {
    const client = createFakeClient();
    client.models.listError = { status: 500 };
    const { adapter } = await createAdapter({ client });

    const result = await adapter.listAccessibleModels({ providerId: "openai" });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ExternalPortError);
      expect(result.error.category).toBe("TransientFailure");
      expect(result.error.statusCode).toBe(500);
    }
  });
});