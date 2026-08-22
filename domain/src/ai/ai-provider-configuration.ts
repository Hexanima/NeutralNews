import { TaggedError } from "../types/error.js";
import { err, ok, type Result } from "../types/result.js";
import type {
  AiModelDefinition,
  AiModelSelection,
  AiProviderDefinition,
} from "./ai-model-definition.js";
import { validateAiModelSelection } from "./ai-model-definition.js";
import {
  createAiProviderCatalog,
  type AiProviderCatalogSnapshot,
  type InvalidAiProviderCatalogError,
} from "./ai-provider-catalog.js";

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

const catalogForOverrideValidation = (
  providerOverrides: readonly AiProviderDefinition[],
  modelOverrides: readonly AiModelDefinition[],
): AiProviderCatalogSnapshot => {
  const providersById = new Map(
    providerOverrides.map((provider) => [provider.id, provider]),
  );

  for (const model of modelOverrides) {
    if (!providersById.has(model.providerId)) {
      providersById.set(model.providerId, {
        id: model.providerId,
        name: model.providerId,
        credentialSchema: { fields: [] },
      });
    }
  }

  return {
    schemaVersion: 1,
    providers: [...providersById.values()],
    models: modelOverrides,
  };
};

const toSelectionError = (errorType: string, selection: AiModelSelection) =>
  invalidValue(
    errorType === "AiModelIncompatible" ? "compatibilityStatus" : "activeSelection",
    selection,
  );

const validateEffectiveSelection = (
  providers: readonly AiProviderDefinition[],
  models: readonly AiModelDefinition[],
  selection: AiModelSelection,
): InvalidAiProviderConfigurationValueError | null => {
  const result = validateAiModelSelection({
    providers,
    models,
    selection,
    requiredCapabilities: [],
  });

  return result.ok ? null : toSelectionError(result.error.type, selection);
};

const defaultSelectionFromCatalog = (
  catalogSnapshot: AiProviderCatalogSnapshot,
): AiModelSelection => {
  const catalog = createAiProviderCatalog(catalogSnapshot);
  const model = catalog.ok
    ? catalog.value.models.find(
        (candidate) => candidate.compatibilityStatus === "compatible",
      )
    : undefined;

  return {
    providerId: model?.providerId ?? "",
    modelId: model?.modelId ?? "",
  };
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
    ? (snapshot.providerOverrides as readonly AiProviderDefinition[])
    : undefined;
  const modelOverrides = Array.isArray(snapshot.modelOverrides)
    ? (snapshot.modelOverrides as readonly AiModelDefinition[])
    : undefined;
  const overrideCatalog =
    providerOverrides !== undefined && modelOverrides !== undefined
      ? createAiProviderCatalog(
          catalogForOverrideValidation(providerOverrides, modelOverrides),
        )
      : undefined;

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
    ...(overrideCatalog !== undefined && !overrideCatalog.ok ? [overrideCatalog.error] : []),
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
      : { providerId: "", modelId: "" },
    credentialReferences:
      credentialReferences?.flatMap((reference) => (reference.ok ? [reference.value] : [])) ?? [],
    providerOverrides: providerOverrides ?? [],
    modelOverrides: modelOverrides ?? [],
  });
};

export const createDefaultAiProviderConfigurationSnapshot = (
  catalogSnapshot: AiProviderCatalogSnapshot,
): AiProviderConfigurationSnapshot => ({
  schemaVersion: aiProviderConfigurationSchemaVersion,
  configurationVersion: initialAiProviderConfigurationVersion,
  activeSelection: defaultSelectionFromCatalog(catalogSnapshot),
  credentialReferences: [],
  providerOverrides: [],
  modelOverrides: [],
});

export const createEffectiveAiProviderConfiguration = (
  catalogSnapshot: AiProviderCatalogSnapshot,
  localSnapshot: AiProviderConfigurationSnapshot | null,
): Result<EffectiveAiProviderConfiguration, InvalidAiProviderCatalogError | InvalidAiProviderConfigurationError> => {
  const snapshot = localSnapshot ?? createDefaultAiProviderConfigurationSnapshot(catalogSnapshot);
  const mergedCatalogSnapshot = {
    schemaVersion: catalogSnapshot.schemaVersion,
    providers: mergeProviders(catalogSnapshot.providers, snapshot.providerOverrides),
    models: mergeModels(catalogSnapshot.models, snapshot.modelOverrides),
  };
  const catalog = createAiProviderCatalog(mergedCatalogSnapshot);

  if (!catalog.ok) {
    return catalog;
  }

  const selectionError = validateEffectiveSelection(
    catalog.value.providers,
    catalog.value.models,
    snapshot.activeSelection,
  );

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
