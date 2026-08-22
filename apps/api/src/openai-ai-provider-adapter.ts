import Ajv from "ajv";
import OpenAI from "openai";
import {
  AiCredentialUnavailableError,
  AiInvalidStructuredOutputError,
  AiProviderRejectedError,
  AiProviderUnsupportedError,
  ExternalPortError,
  PortCancelledError,
  PortLimitExceededError,
  err,
  ok,
  validateAiModelSelection,
  type AiAccessibleModel,
  type AiCapability,
  type AiCredentialFieldValue,
  type AiGenerationPort,
  type AiGenerationResult,
  type AiModelDefinition,
  type AiModelSelection,
  type AiUsageMetrics,
  type AiWebSearchResult,
  type ArticleUrl,
  type EffectiveAiProviderConfiguration,
  type IsoDateTimeString,
  type JsonValue,
  type LimitedPortOperationOptions,
  type PortError,
  type Result,
} from "app-domain";

import type { JsonAiProviderConfigurationRepository } from "./ai-provider-configuration-repository.js";
import type { CredentialVault, CredentialVaultError } from "./credential-vault.js";
import {
  executeExternalOperation,
  type ExternalServiceError,
  type ExternalServicePolicy,
} from "./external-service-policy.js";

export interface OpenAiClientLike {
  responses: {
    create: (body: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>;
  };
  models: {
    list: (options?: { signal?: AbortSignal }) => unknown;
  };
}

export interface OpenAiClientFactoryInput {
  apiKey: string;
}

export interface OpenAiAiProviderAdapterOptions {
  configurationRepository: Pick<JsonAiProviderConfigurationRepository, "getEffectiveConfiguration">;
  credentialVault: CredentialVault;
  createClient?: ((input: OpenAiClientFactoryInput) => OpenAiClientLike) | undefined;
  externalServicePolicy?: Partial<ExternalServicePolicy> | undefined;
}

const providerId = "openai";
const apiKeyFieldId = "api_key";
const credentialVaultReadOperationName = "openai.credential_vault.read";
const schemaValidator = new Ajv({ allErrors: false });
const operationDefaults: ExternalServicePolicy = {
  timeoutMs: 15_000,
  maxAttempts: 3,
  retryDelayMs: 250,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isJsonValue = (value: unknown): value is JsonValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return Number.isFinite(value as number) || typeof value !== "number";
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(isJsonValue);
};

const asArray = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];

const getString = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const property = value[key];

  return typeof property === "string" ? property : undefined;
};

const getNumber = (value: unknown, key: string): number | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const property = value[key];

  return typeof property === "number" && Number.isFinite(property)
    ? property
    : undefined;
};

const toIsoDateTime = (unixSeconds: number | undefined): IsoDateTimeString | undefined =>
  unixSeconds === undefined
    ? undefined
    : (new Date(unixSeconds * 1000).toISOString() as IsoDateTimeString);

const defaultCreateClient = ({ apiKey }: OpenAiClientFactoryInput): OpenAiClientLike =>
  new OpenAI({ apiKey, maxRetries: 0 }) as OpenAiClientLike;

const requiredCapabilitiesForStructuredOutput = (
  requiredCapabilities: readonly AiCapability[],
): readonly AiCapability[] =>
  Array.from(new Set([...requiredCapabilities, "structured_outputs"]));

const requiredCapabilitiesForWebSearch = (
  requiredCapabilities: readonly AiCapability[],
): readonly AiCapability[] =>
  Array.from(new Set([...requiredCapabilities, "web_search"]));

const mapConfigurationError = (operationName: string): ExternalPortError =>
  new ExternalPortError(operationName, "PermanentFailure");

const mapCredentialVaultReadError = (error: CredentialVaultError): PortError => {
  if (
    error.type === "CredentialNotFound" ||
    error.type === "CredentialReferenceMismatch"
  ) {
    return new AiCredentialUnavailableError(providerId, apiKeyFieldId);
  }

  return new ExternalPortError(
    credentialVaultReadOperationName,
    "PermanentFailure",
  );
};

const mapExternalError = (
  provider: string,
  operationName: string,
  error: ExternalServiceError,
): PortError => {
  if (error.category === "Timeout") {
    return new PortLimitExceededError(operationName, "timeoutMs");
  }

  if (error.category === "Cancelled") {
    return new PortCancelledError(operationName);
  }

  if (error.category === "TransientFailure") {
    return new ExternalPortError(
      operationName,
      error.category,
      error.statusCode,
    );
  }

  if (
    error.statusCode !== undefined &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return new AiProviderRejectedError(provider, operationName, error.statusCode);
  }

  return new ExternalPortError(
    operationName,
    error.category,
    error.statusCode,
  );
};

const withExternalOperation = async <TResult>(
  input: {
    operationName: string;
    idempotent: boolean;
    options?: LimitedPortOperationOptions | undefined;
    policy: ExternalServicePolicy;
    provider: string;
    run: (context: { signal: AbortSignal }) => Promise<TResult>;
  },
): Promise<Result<TResult, PortError>> => {
  const result = await executeExternalOperation({
    ...input.policy,
    timeoutMs: input.options?.timeoutMs ?? input.policy.timeoutMs,
    operationName: input.operationName,
    idempotent: input.idempotent,
    signal: input.options?.signal ?? new AbortController().signal,
    run: ({ signal }) => input.run({ signal }),
  });

  return result.ok
    ? ok(result.value)
    : err(mapExternalError(input.provider, input.operationName, result.error));
};

const findModel = (
  configuration: EffectiveAiProviderConfiguration,
  selection: AiModelSelection,
  requiredCapabilities: readonly AiCapability[],
): Result<AiModelDefinition, PortError> => {
  const validated = validateAiModelSelection({
    providers: configuration.providers,
    models: configuration.models,
    selection,
    requiredCapabilities,
  });

  return validated.ok ? ok(validated.value.model) : validated;
};

const resolveStoredApiKey = async (
  configuration: EffectiveAiProviderConfiguration,
  credentialVault: CredentialVault,
): Promise<Result<string, PortError>> => {
  const reference = configuration.credentialReferences.find(
    (credentialReference) =>
      credentialReference.providerId === providerId &&
      credentialReference.fieldId === apiKeyFieldId,
  );

  if (reference === undefined) {
    return err(new AiCredentialUnavailableError(providerId, apiKeyFieldId));
  }

  const secret = await credentialVault.readSecret(providerId, reference.reference);

  return secret.ok
    ? ok(secret.value)
    : err(mapCredentialVaultReadError(secret.error));
};

const credentialValue = (
  values: readonly AiCredentialFieldValue[],
  fieldId: string,
): string | null =>
  values.find((value) => value.fieldId === fieldId)?.value.trim() || null;

const validateStructuredOutput = (
  output: JsonValue,
  outputSchema: JsonValue,
): boolean => {
  try {
    const validate = schemaValidator.compile(outputSchema as object);

    return validate(output) === true;
  } catch {
    return false;
  }
};

const parseStructuredOutput = (
  response: unknown,
): Result<JsonValue, AiInvalidStructuredOutputError> => {
  const outputText = getString(response, "output_text");

  if (outputText === undefined) {
    return err(new AiInvalidStructuredOutputError(providerId));
  }

  try {
    const parsed = JSON.parse(outputText) as unknown;

    return isJsonValue(parsed)
      ? ok(parsed)
      : err(new AiInvalidStructuredOutputError(providerId));
  } catch {
    return err(new AiInvalidStructuredOutputError(providerId));
  }
};

const containsModelRefusal = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some(containsModelRefusal);
  }

  if (!isRecord(value)) {
    return false;
  }

  if (getString(value, "type") === "refusal" || getString(value, "refusal") !== undefined) {
    return true;
  }

  return Object.values(value).some(containsModelRefusal);
};

const normalizeDomains = (domains: readonly string[] = []): string[] =>
  Array.from(
    new Set(
      domains
        .map((domain) => domain.trim().toLowerCase())
        .filter((domain) => domain.length > 0),
    ),
  );

const domainsOverlap = (left: string, right: string): boolean =>
  left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);

const hasUnenforceableBlockedDomains = (
  allowedDomains: readonly string[] | undefined,
  blockedDomains: readonly string[] | undefined,
): boolean =>
  normalizeDomains(blockedDomains).length > 0 && normalizeDomains(allowedDomains).length === 0;

const effectiveAllowedDomains = (
  allowedDomains: readonly string[] | undefined,
  blockedDomains: readonly string[] | undefined,
): string[] => {
  const allowed = normalizeDomains(allowedDomains);
  const blocked = normalizeDomains(blockedDomains);

  return allowed.filter(
    (allowedDomain) => !blocked.some((blockedDomain) => domainsOverlap(allowedDomain, blockedDomain)),
  );
};

const getIncompleteReason = (response: unknown): string | undefined => {
  if (!isRecord(response) || !isRecord(response.incomplete_details)) {
    return undefined;
  }

  return getString(response.incomplete_details, "reason");
};

const normalizeResponseState = (
  response: unknown,
  operationName: string,
): Result<void, PortError> => {
  const status = getString(response, "status");

  if (status !== undefined && status !== "completed") {
    if (status === "cancelled") {
      return err(new PortCancelledError(operationName));
    }

    if (status === "incomplete") {
      const reason = getIncompleteReason(response);

      if (reason === "max_output_tokens" || reason === "max_tokens") {
        return err(new PortLimitExceededError(operationName, "maxItems"));
      }

      if (reason === "content_filter") {
        return err(new AiProviderRejectedError(providerId, operationName));
      }
    }

    return err(new ExternalPortError(operationName, "PermanentFailure"));
  }

  if (containsModelRefusal(response)) {
    return err(new AiProviderRejectedError(providerId, operationName));
  }

  return ok(undefined);
};
const collectCitations = (
  value: unknown,
  blockedDomains: readonly string[] = [],
  allowedDomains: readonly string[] = [],
): { url: ArticleUrl; title?: string | undefined }[] => {
  const citations = new Map<string, { url: ArticleUrl; title?: string | undefined }>();
  const blocked = new Set(normalizeDomains(blockedDomains));
  const allowed = new Set(normalizeDomains(allowedDomains));

  const isBlocked = (rawUrl: string): boolean => {
    try {
      const parsed = new URL(rawUrl);

      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return true;
      }

      const hostname = parsed.hostname.toLowerCase();
      const matchesDomain = (domain: string): boolean =>
        hostname === domain || hostname.endsWith(`.${domain}`);

      if (allowed.size > 0 && ![...allowed].some(matchesDomain)) {
        return true;
      }

      return [...blocked].some(matchesDomain);
    } catch {
      return true;
    }
  };

  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }

    if (!isRecord(candidate)) {
      return;
    }

    const type = getString(candidate, "type");
    const url = getString(candidate, "url");

    if (
      url !== undefined &&
      (type === "url_citation" || type === "url" || type === "open_page") &&
      !isBlocked(url)
    ) {
      citations.set(url, {
        url: url as ArticleUrl,
        ...(getString(candidate, "title") === undefined
          ? {}
          : { title: getString(candidate, "title") }),
      });
    }

    Object.values(candidate).forEach(visit);
  };

  visit(value);

  return [...citations.values()];
};

const countWebSearchCalls = (value: unknown): number => {
  let count = 0;

  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }

    if (!isRecord(candidate)) {
      return;
    }

    if (getString(candidate, "type") === "web_search_call") {
      count += 1;
    }

    Object.values(candidate).forEach(visit);
  };

  visit(value);

  return count;
};

const usageFromResponse = (
  response: unknown,
): AiUsageMetrics => {
  const usage = isRecord(response) ? response.usage : undefined;
  const inputDetails = isRecord(usage) ? usage.input_tokens_details : undefined;

  return {
    ...(getNumber(usage, "input_tokens") === undefined
      ? {}
      : { inputUnits: getNumber(usage, "input_tokens") }),
    ...(getNumber(usage, "output_tokens") === undefined
      ? {}
      : { outputUnits: getNumber(usage, "output_tokens") }),
    ...(getNumber(inputDetails, "cached_tokens") === undefined
      ? {}
      : { cachedInputUnits: getNumber(inputDetails, "cached_tokens") }),
    ...(getNumber(usage, "total_tokens") === undefined
      ? {}
      : { totalUnits: getNumber(usage, "total_tokens") }),
    webSearchCalls: countWebSearchCalls(response),
  };
};

const remoteModelFromValue = (model: unknown): AiAccessibleModel | null => {
  const id = getString(model, "id");

  if (id === undefined) {
    return null;
  }

  return {
    id,
    ...(toIsoDateTime(getNumber(model, "created")) === undefined
      ? {}
      : { createdAt: toIsoDateTime(getNumber(model, "created")) }),
    ...(getString(model, "owned_by") === undefined
      ? {}
      : { ownedBy: getString(model, "owned_by") }),
  };
};

const remoteModelsFromResponse = (response: unknown): readonly AiAccessibleModel[] =>
  asArray(isRecord(response) ? response.data : undefined).flatMap((model) => {
    const parsed = remoteModelFromValue(model);

    return parsed === null ? [] : [parsed];
  });

const isAsyncIterable = (
  value: unknown,
): value is AsyncIterable<unknown> =>
  isRecord(value) && Symbol.asyncIterator in value;

const collectRemoteModels = async (
  listing: unknown,
): Promise<readonly AiAccessibleModel[]> => {
  const collectFromIterable = async (iterable: AsyncIterable<unknown>) => {
    const models: AiAccessibleModel[] = [];

    for await (const model of iterable) {
      const parsed = remoteModelFromValue(model);

      if (parsed !== null) {
        models.push(parsed);
      }
    }

    return models;
  };

  if (isAsyncIterable(listing)) {
    return collectFromIterable(listing);
  }

  const resolvedListing = await Promise.resolve(listing);

  return isAsyncIterable(resolvedListing)
    ? collectFromIterable(resolvedListing)
    : remoteModelsFromResponse(resolvedListing);
};

export const createOpenAiAiProviderAdapter = ({
  configurationRepository,
  credentialVault,
  createClient = defaultCreateClient,
  externalServicePolicy,
}: OpenAiAiProviderAdapterOptions): AiGenerationPort => {
  const policy = { ...operationDefaults, ...externalServicePolicy };

  const resolveConfiguredClient = async (
    selection: AiModelSelection,
    requiredCapabilities: readonly AiCapability[],
    operationName: string,
  ): Promise<Result<{ client: OpenAiClientLike; model: AiModelDefinition }, PortError>> => {
    if (selection.providerId !== providerId) {
      return err(new AiProviderUnsupportedError(selection.providerId));
    }

    const configuration = await configurationRepository.getEffectiveConfiguration();

    if (!configuration.ok) {
      return err(mapConfigurationError(operationName));
    }

    const model = findModel(configuration.value, selection, requiredCapabilities);

    if (!model.ok) {
      return model;
    }

    const apiKey = await resolveStoredApiKey(configuration.value, credentialVault);

    if (!apiKey.ok) {
      return apiKey;
    }

    return ok({ client: createClient({ apiKey: apiKey.value }), model: model.value });
  };

  const resolveClientForProvider = async (
    requestedProviderId: string,
    operationName: string,
  ): Promise<Result<OpenAiClientLike, PortError>> => {
    if (requestedProviderId !== providerId) {
      return err(new AiProviderUnsupportedError(requestedProviderId));
    }

    const configuration = await configurationRepository.getEffectiveConfiguration();

    if (!configuration.ok) {
      return err(mapConfigurationError(operationName));
    }

    const apiKey = await resolveStoredApiKey(configuration.value, credentialVault);

    return apiKey.ok ? ok(createClient({ apiKey: apiKey.value })) : apiKey;
  };

  return {
    generateStructuredResponse: async (input) => {
      const operationName = "openai.responses.create";

      if (input.outputSchema === undefined) {
        return err(new AiInvalidStructuredOutputError(providerId));
      }
      const resolved = await resolveConfiguredClient(
        input.selection,
        requiredCapabilitiesForStructuredOutput(input.requiredCapabilities),
        operationName,
      );

      if (!resolved.ok) {
        return resolved;
      }

      const response = await withExternalOperation({
        operationName,
        idempotent: false,
        options: input.options,
        policy,
        provider: providerId,
        run: ({ signal }) =>
          resolved.value.client.responses.create(
            {
              model: resolved.value.model.remoteModelId,
              input: input.prompt,
              store: false,
              text: {
                format: {
                  type: "json_schema",
                  name: "neutral_news_response",
                  strict: true,
                  schema: input.outputSchema,
                },
              },
            },
            { signal },
          ),
      });

      if (!response.ok) {
        return response;
      }

      const responseState = normalizeResponseState(response.value, operationName);

      if (!responseState.ok) {
        return responseState;
      }

      const output = parseStructuredOutput(response.value);

      if (!output.ok) {
        return output;
      }

      if (!validateStructuredOutput(output.value, input.outputSchema)) {
        return err(new AiInvalidStructuredOutputError(providerId));
      }

      const result: AiGenerationResult = {
        output: output.value,
        citations: collectCitations(response.value),
        usage: usageFromResponse(response.value),
      };

      return ok(result);
    },

    searchWeb: async (input) => {
      const operationName = "openai.responses.web_search";
      const resolved = await resolveConfiguredClient(
        input.selection,
        requiredCapabilitiesForWebSearch(input.requiredCapabilities),
        operationName,
      );

      if (!resolved.ok) {
        return resolved;
      }

      if (hasUnenforceableBlockedDomains(input.allowedDomains, input.blockedDomains)) {
        return err(new ExternalPortError(operationName, "PermanentFailure"));
      }

      const allowedDomains = effectiveAllowedDomains(input.allowedDomains, input.blockedDomains);

      if (input.allowedDomains !== undefined && input.allowedDomains.length > 0 && allowedDomains.length === 0) {
        return err(new ExternalPortError(operationName, "PermanentFailure"));
      }

      const response = await withExternalOperation({
        operationName,
        idempotent: false,
        options: input.options,
        policy,
        provider: providerId,
        run: ({ signal }) =>
          resolved.value.client.responses.create(
            {
              model: resolved.value.model.remoteModelId,
              input: input.query,
              store: false,
              include: ["web_search_call.action.sources"],
              tool_choice: "required",
              tools: [
                {
                  type: "web_search",
                  ...(allowedDomains.length === 0
                    ? {}
                    : { filters: { allowed_domains: allowedDomains } }),
                },
              ],
            },
            { signal },
          ),
      });

      if (!response.ok) {
        return response;
      }

      const responseState = normalizeResponseState(response.value, operationName);

      if (!responseState.ok) {
        return responseState;
      }

      if (countWebSearchCalls(response.value) === 0) {
        return err(new ExternalPortError(operationName, "PermanentFailure"));
      }

      const result: AiWebSearchResult = {
        text: getString(response.value, "output_text") ?? "",
        citations: collectCitations(
          response.value,
          input.blockedDomains,
          input.allowedDomains,
        ),
        usage: usageFromResponse(response.value),
      };

      return ok(result);
    },

    listAccessibleModels: async (input) => {
      const operationName = "openai.models.list";
      const resolved = await resolveClientForProvider(input.providerId, operationName);

      if (!resolved.ok) {
        return resolved;
      }

      const response = await withExternalOperation({
        operationName,
        idempotent: true,
        options: input.options,
        policy,
        provider: providerId,
        run: ({ signal }) => collectRemoteModels(resolved.value.models.list({ signal })),
      });

      return response.ok ? ok(response.value) : response;
    },

    testCredential: async (input) => {
      const operationName = "openai.models.list";

      if (input.providerId !== providerId) {
        return err(new AiProviderUnsupportedError(input.providerId));
      }

      const apiKey = credentialValue(input.credentialValues, apiKeyFieldId);

      if (apiKey === null) {
        return err(new AiCredentialUnavailableError(providerId, apiKeyFieldId));
      }

      const client = createClient({ apiKey });
      const response = await withExternalOperation({
        operationName,
        idempotent: true,
        options: input.options,
        policy,
        provider: providerId,
        run: ({ signal }) => collectRemoteModels(client.models.list({ signal })),
      });

      return response.ok
        ? ok({
            providerId,
            accessibleModelCount: response.value.length,
          })
        : response;
    },
  };
};
