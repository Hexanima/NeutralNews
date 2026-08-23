import type { IncomingMessage, ServerResponse } from "node:http";

import {
  AiCapabilityUnavailableError,
  AiCredentialUnavailableError,
  AiModelIncompatibleError,
  AiModelNotFoundError,
  AiModelUnavailableError,
  AiProviderNotFoundError,
  ExternalPortError,
  initialAiProviderCatalogSnapshot,
  validateAiModelSelection,
  type AiCapability,
  type AiCredentialFieldDefinition,
  type AiCredentialFieldValue,
  type AiGenerationPort,
  type AiModelSelection,
  type EffectiveAiProviderConfiguration,
  type PortError,
} from "app-domain";

import type { ApiConfig } from "./config.js";
import {
  createJsonAiProviderConfigurationRepository,
  type JsonAiProviderConfigurationRepository,
} from "./ai-provider-configuration-repository.js";
import { createLocalJsonFileRepository } from "./local-json-file-repository.js";
import {
  createLocalEncryptedCredentialVault,
  type CredentialSecretDescription,
  type CredentialVault,
  type CredentialVaultError,
} from "./credential-vault.js";
import { createOpenAiAiProviderAdapter } from "./openai-ai-provider-adapter.js";
import { syncAiProviderModels } from "./ai-provider-model-synchronization-service.js";

const aiConfigurationPath = "/api/configuration/ai";
const providersSegment = `${aiConfigurationPath}/providers/`;
const activeSelectionPath = `${aiConfigurationPath}/active-selection`;
const maxJsonBodyBytes = 64 * 1024;

export const requiredAiConfigurationCapabilities = [
  "structured_outputs",
  "web_search",
] satisfies readonly AiCapability[];

export interface AiConfigurationRequestOptions {
  aiProvider?: Pick<
    AiGenerationPort,
    "listAccessibleModels" | "testCredential"
  > | undefined;
  credentialVault?: CredentialVault | undefined;
  clearFeedCache?: (() => Promise<void>) | undefined;
}

type CredentialStatus =
  | { status: "not_configured" }
  | { status: "vault_unavailable" }
  | { status: "configured"; configuredAt: string; updatedAt: string };

class RequestBodyError extends Error {
  constructor(
    public readonly code: "InvalidJson" | "RequestBodyTooLarge",
    message: string,
  ) {
    super(message);
  }
}

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
) => {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  let size = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;

    if (size > maxJsonBodyBytes) {
      throw new RequestBodyError(
        "RequestBodyTooLarge",
        "Request body is too large",
      );
    }

    chunks.push(buffer);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");

  if (rawBody.trim() === "") {
    throw new RequestBodyError("InvalidJson", "Request body must be JSON");
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new RequestBodyError("InvalidJson", "Request body must be JSON");
  }
};

const createDefaultCredentialVault = (config: ApiConfig): CredentialVault =>
  createLocalEncryptedCredentialVault({
    repository: createLocalJsonFileRepository(config.dataDirectory),
    key: config.credentialVaultKey,
  });

const createDefaultAiProvider = (
  repository: JsonAiProviderConfigurationRepository,
  credentialVault: CredentialVault,
  config: ApiConfig,
): Pick<AiGenerationPort, "listAccessibleModels" | "testCredential"> =>
  createOpenAiAiProviderAdapter({
    configurationRepository: repository,
    credentialVault,
    externalServicePolicy: config.externalServices,
  });

const toCredentialStatus = (
  description: CredentialSecretDescription,
): CredentialStatus =>
  description.configured
    ? {
        status: "configured",
        configuredAt: description.createdAt,
        updatedAt: description.updatedAt,
      }
    : { status: "not_configured" };

const describeProviderCredential = async (
  credentialVault: CredentialVault,
  providerId: string,
): Promise<CredentialStatus> => {
  const description = await credentialVault.describeSecret(providerId);

  if (!description.ok) {
    return { status: "vault_unavailable" };
  }

  return toCredentialStatus(description.value);
};

const toConfigurationResponse = async (
  configuration: EffectiveAiProviderConfiguration,
  credentialVault: CredentialVault,
  warnings: readonly unknown[] = [],
) => ({
  schemaVersion: configuration.schemaVersion,
  configurationVersion: configuration.configurationVersion,
  requiredCapabilities: requiredAiConfigurationCapabilities,
  activeSelection: configuration.activeSelection,
  providers: await Promise.all(
    configuration.providers.map(async (provider) => ({
      ...provider,
      credentialStatus: await describeProviderCredential(
        credentialVault,
        provider.id,
      ),
    })),
  ),
  models: configuration.models,
  modelSynchronizations: configuration.modelSynchronizations,
  warnings,
});

const sendRepositoryError = (response: ServerResponse) => {
  sendJson(response, 500, {
    error: { code: "AiProviderConfigurationStorageError" },
  });
};

const sendBodyError = (response: ServerResponse, error: RequestBodyError) => {
  sendJson(response, 400, {
    error: { code: error.code, message: error.message },
  });
};

const sendInvalidCredential = (response: ServerResponse, message: string) => {
  sendJson(response, 400, {
    error: { code: "InvalidAiCredential", message },
  });
};

const providerForId = (
  configuration: EffectiveAiProviderConfiguration,
  providerId: string,
) => configuration.providers.find((provider) => provider.id === providerId);

const fieldValuesFromBody = (
  body: unknown,
): AiCredentialFieldValue[] | null => {
  if (!isRecord(body) || !Array.isArray(body.credentialValues)) {
    return null;
  }

  const values = body.credentialValues;

  if (
    !values.every(
      (value): value is AiCredentialFieldValue =>
        isRecord(value) &&
        typeof value.fieldId === "string" &&
        value.fieldId.trim() !== "" &&
        typeof value.value === "string" &&
        value.value.trim() !== "",
    )
  ) {
    return null;
  }

  return values.map((value) => ({
    fieldId: value.fieldId.trim(),
    value: value.value,
  }));
};

const validateCredentialValues = (
  fields: readonly AiCredentialFieldDefinition[],
  values: readonly AiCredentialFieldValue[],
): AiCredentialFieldValue[] | null => {
  const fieldIds = new Set(fields.map((field) => field.id));
  const valuesByField = new Map(values.map((value) => [value.fieldId, value]));

  if (values.some((value) => !fieldIds.has(value.fieldId))) {
    return null;
  }

  if (
    fields.some(
      (field) => field.required && !valuesByField.has(field.id),
    )
  ) {
    return null;
  }

  return values.map((value) => ({
    fieldId: value.fieldId,
    value: value.value,
  }));
};

const secretCredentialField = (
  fields: readonly AiCredentialFieldDefinition[],
): AiCredentialFieldDefinition | null =>
  fields.find((field) => field.required && field.type === "secret") ?? null;

const parseProviderActionPath = (
  pathname: string,
):
  | { providerId: string; action: "credentials" | "testCredential" | "syncModels" }
  | null => {
  if (!pathname.startsWith(providersSegment)) {
    return null;
  }

  const segments = pathname.slice(providersSegment.length).split("/");

  if (segments.length === 2 && segments[1] === "credentials") {
    return {
      providerId: decodeURIComponent(segments[0]!),
      action: "credentials",
    };
  }

  if (
    segments.length === 3 &&
    segments[1] === "credentials" &&
    segments[2] === "test"
  ) {
    return {
      providerId: decodeURIComponent(segments[0]!),
      action: "testCredential",
    };
  }

  if (
    segments.length === 3 &&
    segments[1] === "models" &&
    segments[2] === "sync"
  ) {
    return {
      providerId: decodeURIComponent(segments[0]!),
      action: "syncModels",
    };
  }

  return null;
};

const mapPortErrorStatus = (error: PortError): number => {
  if (
    error instanceof AiProviderNotFoundError ||
    error instanceof AiModelNotFoundError
  ) {
    return 404;
  }

  if (
    error instanceof AiCredentialUnavailableError ||
    error instanceof AiModelIncompatibleError ||
    error instanceof AiModelUnavailableError ||
    error instanceof AiCapabilityUnavailableError
  ) {
    return 409;
  }

  if (error instanceof ExternalPortError) {
    return 502;
  }

  return 502;
};

const portErrorBody = (error: PortError) => {
  if (error instanceof AiCredentialUnavailableError) {
    return {
      error: {
        code: error.type,
        providerId: error.providerId,
        fieldId: error.fieldId,
      },
    };
  }

  if (
    error instanceof AiProviderNotFoundError ||
    error instanceof AiModelNotFoundError ||
    error instanceof AiModelIncompatibleError ||
    error instanceof AiModelUnavailableError
  ) {
    return {
      error: {
        code: error.type,
        providerId: error.providerId,
        ...("modelId" in error ? { modelId: error.modelId } : {}),
      },
    };
  }

  if (error instanceof AiCapabilityUnavailableError) {
    return {
      error: {
        code: error.type,
        providerId: error.providerId,
        modelId: error.modelId,
        capability: error.capability,
      },
    };
  }

  if (error instanceof ExternalPortError) {
    return {
      error: {
        code: "AiProviderRemoteError",
        providerId: "openai",
        category: error.category,
        ...(error.statusCode === undefined
          ? {}
          : { statusCode: error.statusCode }),
      },
    };
  }

  return { error: { code: error.type } };
};

const vaultErrorStatus = (error: CredentialVaultError): number =>
  error.type === "CredentialVaultUnavailable" ? 503 : 500;

const sendVaultError = (response: ServerResponse, error: CredentialVaultError) => {
  sendJson(response, vaultErrorStatus(error), {
    error: { code: error.type },
  });
};

const sendProviderNotFound = (response: ServerResponse, providerId: string) => {
  sendJson(response, 404, {
    error: { code: "AiProviderNotFound", providerId },
  });
};

const invalidateFeed = async (
  clearFeedCache: (() => Promise<void>) | undefined,
) => {
  await clearFeedCache?.();
};

const handleSaveCredential = async (
  response: ServerResponse,
  input: {
    providerId: string;
    body: unknown;
    repository: JsonAiProviderConfigurationRepository;
    credentialVault: CredentialVault;
    clearFeedCache?: (() => Promise<void>) | undefined;
  },
) => {
  const configuration = await input.repository.getEffectiveConfiguration();

  if (!configuration.ok) {
    sendRepositoryError(response);
    return;
  }

  const provider = providerForId(configuration.value, input.providerId);

  if (provider === undefined) {
    sendProviderNotFound(response, input.providerId);
    return;
  }

  const rawValues = fieldValuesFromBody(input.body);
  const credentialValues = rawValues === null
    ? null
    : validateCredentialValues(provider.credentialSchema.fields, rawValues);

  if (credentialValues === null) {
    sendInvalidCredential(response, "Credential values do not match provider schema");
    return;
  }

  const secretField = secretCredentialField(provider.credentialSchema.fields);

  if (secretField === null) {
    sendInvalidCredential(response, "Provider has no required secret credential field");
    return;
  }

  const secretValue = credentialValues.find(
    (value) => value.fieldId === secretField.id,
  );

  if (secretValue === undefined) {
    sendInvalidCredential(response, "Provider has no required secret credential field");
    return;
  }

  const savedSecret = await input.credentialVault.saveSecret(
    input.providerId,
    secretValue.value,
  );

  if (!savedSecret.ok) {
    sendVaultError(response, savedSecret.error);
    return;
  }

  const savedReference = await input.repository.saveCredentialReference({
    providerId: input.providerId,
    fieldId: secretField.id,
    reference: savedSecret.value.reference,
  });

  if (!savedReference.ok) {
    sendRepositoryError(response);
    return;
  }

  await invalidateFeed(input.clearFeedCache);
  sendJson(
    response,
    200,
    await toConfigurationResponse(savedReference.value, input.credentialVault),
  );
};

const handleDeleteCredential = async (
  response: ServerResponse,
  input: {
    providerId: string;
    repository: JsonAiProviderConfigurationRepository;
    credentialVault: CredentialVault;
    clearFeedCache?: (() => Promise<void>) | undefined;
  },
) => {
  const deleted = await input.credentialVault.deleteSecret(input.providerId);

  if (!deleted.ok) {
    sendVaultError(response, deleted.error);
    return;
  }

  const saved = await input.repository.deleteCredentialReferences({
    providerId: input.providerId,
  });

  if (!saved.ok) {
    sendRepositoryError(response);
    return;
  }

  await invalidateFeed(input.clearFeedCache);
  sendJson(
    response,
    200,
    await toConfigurationResponse(saved.value, input.credentialVault),
  );
};

const handleTestCredential = async (
  response: ServerResponse,
  input: {
    providerId: string;
    body: unknown;
    repository: JsonAiProviderConfigurationRepository;
    aiProvider: Pick<AiGenerationPort, "testCredential">;
  },
) => {
  const configuration = await input.repository.getEffectiveConfiguration();

  if (!configuration.ok) {
    sendRepositoryError(response);
    return;
  }

  const provider = providerForId(configuration.value, input.providerId);

  if (provider === undefined) {
    sendProviderNotFound(response, input.providerId);
    return;
  }

  const rawValues = fieldValuesFromBody(input.body);
  const credentialValues = rawValues === null
    ? null
    : validateCredentialValues(provider.credentialSchema.fields, rawValues);

  if (credentialValues === null) {
    sendInvalidCredential(response, "Credential values do not match provider schema");
    return;
  }

  const tested = await input.aiProvider.testCredential({
    providerId: input.providerId,
    credentialValues,
  });

  if (!tested.ok) {
    sendJson(response, mapPortErrorStatus(tested.error), portErrorBody(tested.error));
    return;
  }

  sendJson(response, 200, tested.value);
};

const handleSyncModels = async (
  response: ServerResponse,
  input: {
    providerId: string;
    repository: JsonAiProviderConfigurationRepository;
    credentialVault: CredentialVault;
    aiProvider: Pick<AiGenerationPort, "listAccessibleModels">;
  },
) => {
  const configuration = await input.repository.getEffectiveConfiguration();

  if (!configuration.ok) {
    sendRepositoryError(response);
    return;
  }

  const provider = providerForId(configuration.value, input.providerId);

  if (provider === undefined) {
    sendProviderNotFound(response, input.providerId);
    return;
  }

  const secretField = secretCredentialField(provider.credentialSchema.fields);
  const credentialStatus = await describeProviderCredential(
    input.credentialVault,
    input.providerId,
  );

  if (secretField === null || credentialStatus.status !== "configured") {
    sendJson(response, 409, {
      error: {
        code: "AiCredentialUnavailable",
        providerId: input.providerId,
        fieldId: secretField?.id ?? "credential",
      },
    });
    return;
  }

  const synced = await syncAiProviderModels({
    providerId: input.providerId,
    configurationRepository: input.repository,
    aiProvider: input.aiProvider,
  });

  if (!synced.ok) {
    sendRepositoryError(response);
    return;
  }

  sendJson(
    response,
    200,
    await toConfigurationResponse(
      synced.value.configuration,
      input.credentialVault,
      synced.value.warning === undefined ? [] : [synced.value.warning],
    ),
  );
};

const selectionFromBody = (body: unknown): AiModelSelection | null => {
  if (
    !isRecord(body) ||
    typeof body.providerId !== "string" ||
    body.providerId.trim() === "" ||
    typeof body.modelId !== "string" ||
    body.modelId.trim() === ""
  ) {
    return null;
  }

  return {
    providerId: body.providerId.trim(),
    modelId: body.modelId.trim(),
  };
};

const handleSaveActiveSelection = async (
  response: ServerResponse,
  input: {
    body: unknown;
    repository: JsonAiProviderConfigurationRepository;
    credentialVault: CredentialVault;
    clearFeedCache?: (() => Promise<void>) | undefined;
  },
) => {
  const selection = selectionFromBody(input.body);

  if (selection === null) {
    sendJson(response, 400, {
      error: { code: "InvalidAiModelSelection" },
    });
    return;
  }

  const configuration = await input.repository.getEffectiveConfiguration();

  if (!configuration.ok) {
    sendRepositoryError(response);
    return;
  }

  const validated = validateAiModelSelection({
    providers: configuration.value.providers,
    models: configuration.value.models,
    selection,
    requiredCapabilities: requiredAiConfigurationCapabilities,
  });

  if (!validated.ok) {
    sendJson(
      response,
      mapPortErrorStatus(validated.error),
      portErrorBody(validated.error),
    );
    return;
  }

  const saved = await input.repository.saveActiveSelection({ selection });

  if (!saved.ok) {
    sendRepositoryError(response);
    return;
  }

  await invalidateFeed(input.clearFeedCache);
  sendJson(
    response,
    200,
    await toConfigurationResponse(saved.value, input.credentialVault),
  );
};

export const handleAiConfigurationRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  config?: ApiConfig,
  options: AiConfigurationRequestOptions = {},
): Promise<boolean> => {
  const rawUrl = request.url ?? "/";
  const requestUrl = new URL(rawUrl, "http://127.0.0.1");
  const pathname = requestUrl.pathname;

  if (
    pathname !== aiConfigurationPath &&
    pathname !== activeSelectionPath &&
    !pathname.startsWith(providersSegment)
  ) {
    return false;
  }

  if (config === undefined) {
    sendRepositoryError(response);
    return true;
  }

  const repository = createJsonAiProviderConfigurationRepository(
    config.dataDirectory,
    { catalogSnapshot: initialAiProviderCatalogSnapshot },
  );
  const credentialVault =
    options.credentialVault ?? createDefaultCredentialVault(config);
  const aiProvider =
    options.aiProvider ?? createDefaultAiProvider(repository, credentialVault, config);

  if (pathname === aiConfigurationPath && request.method === "GET") {
    const configuration = await repository.getEffectiveConfiguration();

    if (!configuration.ok) {
      sendRepositoryError(response);
      return true;
    }

    sendJson(
      response,
      200,
      await toConfigurationResponse(configuration.value, credentialVault),
    );
    return true;
  }

  const providerAction = parseProviderActionPath(pathname);
  const needsBody =
    request.method === "PUT" ||
    (providerAction?.action === "testCredential" && request.method === "POST");
  let body: unknown;

  if (needsBody) {
    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendBodyError(response, error as RequestBodyError);
      return true;
    }
  }

  if (pathname === activeSelectionPath && request.method === "PUT") {
    await handleSaveActiveSelection(response, {
      body,
      repository,
      credentialVault,
      clearFeedCache: options.clearFeedCache,
    });
    return true;
  }

  if (providerAction === null) {
    return false;
  }

  if (providerAction.action === "credentials" && request.method === "PUT") {
    await handleSaveCredential(response, {
      providerId: providerAction.providerId,
      body,
      repository,
      credentialVault,
      clearFeedCache: options.clearFeedCache,
    });
    return true;
  }

  if (providerAction.action === "credentials" && request.method === "DELETE") {
    await handleDeleteCredential(response, {
      providerId: providerAction.providerId,
      repository,
      credentialVault,
      clearFeedCache: options.clearFeedCache,
    });
    return true;
  }

  if (providerAction.action === "testCredential" && request.method === "POST") {
    await handleTestCredential(response, {
      providerId: providerAction.providerId,
      body,
      repository,
      aiProvider,
    });
    return true;
  }

  if (providerAction.action === "syncModels" && request.method === "POST") {
    await handleSyncModels(response, {
      providerId: providerAction.providerId,
      repository,
      credentialVault,
      aiProvider,
    });
    return true;
  }

  return false;
};
