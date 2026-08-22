import { TaggedError } from "../types/error.js";
import { err, ok, type Result } from "../types/result.js";
import type {
  AiModelDefinition,
  AiModelSelection,
  AiProviderDefinition,
} from "./ai-model-definition.js";
import {
  createAiProviderCatalog,
  type AiProviderCatalogSnapshot,
  type InvalidAiProviderCatalogError,
} from "./ai-provider-catalog.js";
import { initialAiProviderCatalogSnapshot } from "./initial-ai-provider-catalog.js";

export const aiProviderConfigurationSchemaVersion = 1;
export const initialAiProviderConfigurationVersion = 1;

export interface AiCredentialReferenceSnapshot {
  readonly providerId: string;
  readonly fieldId: string;
  readonly reference: string;
}

export interface AiProviderConfigurationSnapshot {
  readonly schemaVersion: typeof aiProviderConfigurationSchemaVersion;
  readonly configurationVersion: number;
  readonly activeSelection: AiModelSelection;
  readonly credentialReferences: readonly AiCredentialReferenceSnapshot[];
  readonly providerOverrides: readonly AiProviderDefinition[];
  readonly modelOverrides: readonly AiModelDefinition[];
}

export interface EffectiveAiProviderConfiguration {
  readonly schemaVersion: number;
  readonly configurationVersion: number;
  readonly providers: readonly AiProviderDefinition[];
  readonly models: readonly AiModelDefinition[];
  readonly activeSelection: AiModelSelection;
  readonly credentialReferences: readonly AiCredentialReferenceSnapshot[];
  readonly providerOverrides: readonly AiProviderDefinition[];
  readonly modelOverrides: readonly AiModelDefinition[];
}

export type AiProviderConfigurationField =
  | "schemaVersion"
  | "configurationVersion"
  | "activeSelection"
  | "credentialReferences"
  | "credentialReference"
  | "providerOverrides"
  | "modelOverrides"
  | "compatibilityStatus";

export class InvalidAiProviderConfigurationValueError extends TaggedError<"InvalidAiProviderConfigurationValue"> {
  public readonly type = "InvalidAiProviderConfigurationValue";

  constructor(
    public readonly field: AiProviderConfigurationField,
    public readonly value: unknown,
  ) {
    super("InvalidAiProviderConfigurationValue");
    this.message = `Invalid AI provider configuration ${field}`;
  }
}

export class InvalidAiProviderConfigurationError extends TaggedError<"InvalidAiProviderConfiguration"> {
  public readonly type = "InvalidAiProviderConfiguration";

  constructor(
    public readonly errors: readonly (
      | InvalidAiProviderConfigurationValueError
      | InvalidAiProviderCatalogError
    )[],
  ) {
    super("InvalidAiProviderConfiguration");
    this.message = "AI provider configuration violates domain invariants";
  }
}

const invalidValue = (field: AiProviderConfigurationField, value: unknown) =>
  new InvalidAiProviderConfigurationValueError(field, value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const createVersion = (
  value: unknown,
  field: "schemaVersion" | "configurationVersion",
): Result<number, InvalidAiProviderConfigurationValueError> =>
  isPositiveInteger(value) ? ok(value) : err(invalidValue(field, value));

const createSelection = (
  value: unknown,
): Result<AiModelSelection, InvalidAiProviderConfigurationValueError> => {
  if (!isRecord(value) || !isNonEmptyString(value.providerId) || !isNonEmptyString(value.modelId)) {
    return err(invalidValue("activeSelection", value));
  }

  return ok({ providerId: value.providerId, modelId: value.modelId });
};

const createCredentialReference = (
  value: unknown,
): Result<AiCredentialReferenceSnapshot, InvalidAiProviderConfigurationValueError> => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.providerId) ||
    !isNonEmptyString(value.fieldId) ||
    !isNonEmptyString(value.reference)
  ) {
    return err(invalidValue("credentialReference", value));
  }

  return ok({
    providerId: value.providerId,
    fieldId: value.fieldId,
    reference: value.reference,
  });
};

const defaultCatalogWithOverrides = (snapshot: {
  readonly providerOverrides: readonly AiProviderDefinition[];
  readonly modelOverrides: readonly AiModelDefinition[];
}): AiProviderCatalogSnapshot => ({
  schemaVersion: initialAiProviderCatalogSnapshot.schemaVersion,
  providers: mergeProviders(
    initialAiProviderCatalogSnapshot.providers,
    snapshot.providerOverrides,
  ),
  models: mergeModels(
    initialAiProviderCatalogSnapshot.models,
    snapshot.modelOverrides,
  ),
});

const mergeProviders = (
  providers: readonly AiProviderDefinition[],
  overrides: readonly AiProviderDefinition[],
): readonly AiProviderDefinition[] => {
  const overridesById = new Map(overrides.map((provider) => [provider.id, provider]));
  const merged = providers.map((provider) => overridesById.get(provider.id) ?? provider);
  const defaultIds = new Set(providers.map((provider) => provider.id));

  return [
    ...merged,
    ...overrides.filter((provider) => !defaultIds.has(provider.id)),
  ];
};

const modelKey = (model: Pick<AiModelDefinition, "providerId" | "modelId">) =>
  `${model.providerId}/${model.modelId}`;

const mergeModels = (
  models: readonly AiModelDefinition[],
  overrides: readonly AiModelDefinition[],
): readonly AiModelDefinition[] => {
  const overridesById = new Map(overrides.map((model) => [modelKey(model), model]));
  const merged = models.map((model) => overridesById.get(modelKey(model)) ?? model);
  const defaultIds = new Set(models.map(modelKey));

  return [
    ...merged,
    ...overrides.filter((model) => !defaultIds.has(modelKey(model))),
  ];
};

const findSelectedModel = (
  models: readonly AiModelDefinition[],
  selection: AiModelSelection,
): AiModelDefinition | undefined =>
  models.find(
    (model) =>
      model.providerId === selection.providerId &&
      model.modelId === selection.modelId,
  );

const validateSelection = (
  catalogSnapshot: AiProviderCatalogSnapshot,
  selection: AiModelSelection,
): InvalidAiProviderConfigurationValueError | null => {
  const catalog = createAiProviderCatalog(catalogSnapshot);

  if (!catalog.ok) {
    return invalidValue("activeSelection", selection);
  }

  const model = findSelectedModel(catalog.value.models, selection);

  if (model === undefined || model.compatibilityStatus === "incompatible") {
    return invalidValue(
      model === undefined ? "activeSelection" : "compatibilityStatus",
      selection,
    );
  }

  return null;
};

export const createAiProviderConfigurationSnapshot = (
  snapshot: unknown,
): Result<AiProviderConfigurationSnapshot, InvalidAiProviderConfigurationError> => {
  if (!isRecord(snapshot)) {
    return err(new InvalidAiProviderConfigurationError([invalidValue("schemaVersion", snapshot)]));
  }

  const schemaVersion = createVersion(snapshot.schemaVersion, "schemaVersion");
  const configurationVersion = createVersion(
    snapshot.configurationVersion,
    "configurationVersion",
  );
  const activeSelection = createSelection(snapshot.activeSelection);
  const credentialReferences = Array.isArray(snapshot.credentialReferences)
    ? snapshot.credentialReferences.map(createCredentialReference)
    : undefined;
  const providerOverrides = Array.isArray(snapshot.providerOverrides)
    ? snapshot.providerOverrides
    : undefined;
  const modelOverrides = Array.isArray(snapshot.modelOverrides)
    ? snapshot.modelOverrides
    : undefined;

  const effectiveCatalog =
    providerOverrides !== undefined && modelOverrides !== undefined
      ? createAiProviderCatalog(
          defaultCatalogWithOverrides({ providerOverrides, modelOverrides }),
        )
      : undefined;
  const selectionError =
    activeSelection.ok && effectiveCatalog?.ok
      ? validateSelection(effectiveCatalog.value, activeSelection.value)
      : null;

  const errors = [
    ...(schemaVersion.ok && schemaVersion.value === aiProviderConfigurationSchemaVersion
      ? []
      : [invalidValue("schemaVersion", snapshot.schemaVersion)]),
    ...(configurationVersion.ok ? [] : [configurationVersion.error]),
    ...(activeSelection.ok ? [] : [activeSelection.error]),
    ...(credentialReferences === undefined
      ? [invalidValue("credentialReferences", snapshot.credentialReferences)]
      : credentialReferences.flatMap((reference) => (reference.ok ? [] : [reference.error]))),
    ...(providerOverrides === undefined
      ? [invalidValue("providerOverrides", snapshot.providerOverrides)]
      : []),
    ...(modelOverrides === undefined
      ? [invalidValue("modelOverrides", snapshot.modelOverrides)]
      : []),
    ...(effectiveCatalog !== undefined && !effectiveCatalog.ok ? [effectiveCatalog.error] : []),
    ...(selectionError === null ? [] : [selectionError]),
  ];

  if (errors.length > 0) {
    return err(new InvalidAiProviderConfigurationError(errors));
  }

  return ok({
    schemaVersion: aiProviderConfigurationSchemaVersion,
    configurationVersion: configurationVersion.ok
      ? configurationVersion.value
      : initialAiProviderConfigurationVersion,
    activeSelection: activeSelection.ok
      ? activeSelection.value
      : { providerId: "openai", modelId: "gpt-5.6-terra" },
    credentialReferences:
      credentialReferences?.flatMap((reference) => (reference.ok ? [reference.value] : [])) ?? [],
    providerOverrides: providerOverrides ?? [],
    modelOverrides: modelOverrides ?? [],
  });
};

export const createDefaultAiProviderConfigurationSnapshot =
  (): AiProviderConfigurationSnapshot => ({
    schemaVersion: aiProviderConfigurationSchemaVersion,
    configurationVersion: initialAiProviderConfigurationVersion,
    activeSelection: { providerId: "openai", modelId: "gpt-5.6-terra" },
    credentialReferences: [],
    providerOverrides: [],
    modelOverrides: [],
  });

export const createEffectiveAiProviderConfiguration = (
  catalogSnapshot: AiProviderCatalogSnapshot,
  localSnapshot: AiProviderConfigurationSnapshot | null,
): Result<EffectiveAiProviderConfiguration, InvalidAiProviderCatalogError | InvalidAiProviderConfigurationError> => {
  const snapshot = localSnapshot ?? createDefaultAiProviderConfigurationSnapshot();
  const mergedCatalogSnapshot = {
    schemaVersion: catalogSnapshot.schemaVersion,
    providers: mergeProviders(catalogSnapshot.providers, snapshot.providerOverrides),
    models: mergeModels(catalogSnapshot.models, snapshot.modelOverrides),
  };
  const catalog = createAiProviderCatalog(mergedCatalogSnapshot);

  if (!catalog.ok) {
    return catalog;
  }

  const selectionError = validateSelection(catalog.value, snapshot.activeSelection);

  if (selectionError !== null) {
    return err(new InvalidAiProviderConfigurationError([selectionError]));
  }

  return ok({
    schemaVersion: catalog.value.schemaVersion,
    configurationVersion: snapshot.configurationVersion,
    providers: catalog.value.providers,
    models: catalog.value.models,
    activeSelection: snapshot.activeSelection,
    credentialReferences: snapshot.credentialReferences,
    providerOverrides: snapshot.providerOverrides,
    modelOverrides: snapshot.modelOverrides,
  });
};
