import { TaggedError } from "../types/error.js";
import { err, ok, type Result } from "../types/result.js";
import type {
  AiCapability,
  AiCredentialFieldDefinition,
  AiModelCompatibilityStatus,
  AiModelDefinition,
  AiProviderDefinition,
} from "./ai-model-definition.js";

export const aiProviderCatalogSchemaVersion = 1;

export interface AiProviderCatalogSnapshot {
  readonly schemaVersion: number;
  readonly providers: readonly AiProviderDefinition[];
  readonly models: readonly AiModelDefinition[];
}

export interface AiProviderCatalog extends AiProviderCatalogSnapshot {}

export type AiProviderCatalogField =
  | "schemaVersion"
  | "providers"
  | "provider"
  | "models"
  | "model"
  | "credentialField"
  | "capabilities"
  | "compatibilityStatus"
  | "id";

export class InvalidAiProviderCatalogValueError extends TaggedError<"InvalidAiProviderCatalogValue"> {
  public readonly type = "InvalidAiProviderCatalogValue";

  constructor(
    public readonly field: AiProviderCatalogField,
    public readonly value: unknown,
  ) {
    super("InvalidAiProviderCatalogValue");
    this.message = `Invalid AI provider catalog ${field}`;
  }
}

export class InvalidAiProviderCatalogError extends TaggedError<"InvalidAiProviderCatalog"> {
  public readonly type = "InvalidAiProviderCatalog";

  constructor(
    public readonly errors: readonly InvalidAiProviderCatalogValueError[],
  ) {
    super("InvalidAiProviderCatalog");
    this.message = "AI provider catalog violates domain invariants";
  }
}

const validCredentialFieldTypes = new Set(["secret", "text", "url"]);
const validCapabilities = new Set<AiCapability>([
  "structured_outputs",
  "web_search",
  "reasoning_low",
  "reasoning_medium",
  "reasoning_high",
]);
const validCompatibilityStatuses = new Set<AiModelCompatibilityStatus>([
  "compatible",
  "incompatible",
  "unknown",
]);

const invalidValue = (field: AiProviderCatalogField, value: unknown) =>
  new InvalidAiProviderCatalogValueError(field, value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const createCredentialField = (
  value: unknown,
): Result<AiCredentialFieldDefinition, InvalidAiProviderCatalogValueError> => {
  if (!isRecord(value)) {
    return err(invalidValue("credentialField", value));
  }

  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.label) ||
    typeof value.type !== "string" ||
    !validCredentialFieldTypes.has(value.type) ||
    typeof value.required !== "boolean" ||
    (value.description !== undefined && typeof value.description !== "string")
  ) {
    return err(invalidValue("credentialField", value));
  }

  return ok({
    id: value.id,
    label: value.label,
    type: value.type as AiCredentialFieldDefinition["type"],
    required: value.required,
    ...(value.description === undefined ? {} : { description: value.description }),
  });
};

const createProvider = (
  value: unknown,
): Result<AiProviderDefinition, InvalidAiProviderCatalogValueError> => {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.name)) {
    return err(invalidValue("provider", value));
  }

  if (!isRecord(value.credentialSchema) || !Array.isArray(value.credentialSchema.fields)) {
    return err(invalidValue("provider", value));
  }

  const fields = value.credentialSchema.fields.map(createCredentialField);
  const invalidField = fields.find((field) => !field.ok);

  if (invalidField !== undefined && !invalidField.ok) {
    return invalidField;
  }

  const validFields = fields.flatMap((field) => (field.ok ? [field.value] : []));
  const fieldIds = new Set<string>();

  for (const field of validFields) {
    if (fieldIds.has(field.id)) {
      return err(invalidValue("id", field.id));
    }

    fieldIds.add(field.id);
  }

  return ok({
    id: value.id,
    name: value.name,
    credentialSchema: { fields: validFields },
  });
};

const createModel = (
  value: unknown,
): Result<AiModelDefinition, InvalidAiProviderCatalogValueError> => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.providerId) ||
    !isNonEmptyString(value.modelId) ||
    !isNonEmptyString(value.remoteModelId) ||
    !Array.isArray(value.capabilities) ||
    typeof value.compatibilityStatus !== "string" ||
    !validCompatibilityStatuses.has(value.compatibilityStatus as AiModelCompatibilityStatus)
  ) {
    return err(invalidValue("model", value));
  }

  if (
    value.capabilities.length === 0 ||
    !value.capabilities.every(
      (capability): capability is AiCapability =>
        typeof capability === "string" && validCapabilities.has(capability as AiCapability),
    )
  ) {
    return err(invalidValue("capabilities", value.capabilities));
  }

  return ok({
    providerId: value.providerId,
    modelId: value.modelId,
    remoteModelId: value.remoteModelId,
    capabilities: value.capabilities,
    compatibilityStatus: value.compatibilityStatus as AiModelCompatibilityStatus,
  });
};

export const createAiProviderCatalog = (
  snapshot: unknown,
): Result<AiProviderCatalog, InvalidAiProviderCatalogError> => {
  if (!isRecord(snapshot)) {
    return err(new InvalidAiProviderCatalogError([invalidValue("providers", snapshot)]));
  }

  const schemaVersion = snapshot.schemaVersion === aiProviderCatalogSchemaVersion
    ? ok(aiProviderCatalogSchemaVersion)
    : err(invalidValue("schemaVersion", snapshot.schemaVersion));
  const providers = Array.isArray(snapshot.providers)
    ? snapshot.providers.map(createProvider)
    : undefined;
  const models = Array.isArray(snapshot.models)
    ? snapshot.models.map(createModel)
    : undefined;

  const providerIds = new Set<string>();
  const duplicateProviderIds = new Set<string>();
  for (const provider of providers ?? []) {
    if (!provider.ok) {
      continue;
    }

    if (providerIds.has(provider.value.id)) {
      duplicateProviderIds.add(provider.value.id);
      continue;
    }

    providerIds.add(provider.value.id);
  }

  const modelIds = new Set<string>();
  const duplicateModelIds = new Set<string>();
  const missingProviderIds = new Set<string>();
  for (const model of models ?? []) {
    if (!model.ok) {
      continue;
    }

    const modelKey = `${model.value.providerId}/${model.value.modelId}`;
    if (modelIds.has(modelKey)) {
      duplicateModelIds.add(modelKey);
      continue;
    }

    modelIds.add(modelKey);
    if (!providerIds.has(model.value.providerId)) {
      missingProviderIds.add(model.value.providerId);
    }
  }

  const errors = [
    ...(schemaVersion.ok ? [] : [schemaVersion.error]),
    ...(providers === undefined
      ? [invalidValue("providers", snapshot.providers)]
      : providers.flatMap((provider) => (provider.ok ? [] : [provider.error]))),
    ...(models === undefined
      ? [invalidValue("models", snapshot.models)]
      : models.flatMap((model) => (model.ok ? [] : [model.error]))),
    ...[...duplicateProviderIds].map((id) => invalidValue("id", id)),
    ...[...duplicateModelIds].map((id) => invalidValue("id", id)),
    ...[...missingProviderIds].map((id) => invalidValue("provider", id)),
  ];

  if (errors.length > 0) {
    return err(new InvalidAiProviderCatalogError(errors));
  }

  return ok({
    schemaVersion: schemaVersion.ok ? schemaVersion.value : 1,
    providers: providers?.flatMap((provider) => (provider.ok ? [provider.value] : [])) ?? [],
    models: models?.flatMap((model) => (model.ok ? [model.value] : [])) ?? [],
  });
};
