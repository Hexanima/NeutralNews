import { TaggedError } from "../types/error.js";
import { err, ok, type Result } from "../types/result.js";
import type {
  AiModelDefinition,
  AiModelSelection,
  AiProviderDefinition,
} from "./ai-model-definition.js";
import {
  AiModelIncompatibleError,
  AiModelNotFoundError,
  AiProviderNotFoundError,
} from "./ai-model-definition.js";
import {
  createAiProviderCatalog,
  type AiProviderCatalogSnapshot,
  type InvalidAiProviderCatalogError,
} from "./ai-provider-catalog.js";
import {
  synchronizeAiProviderModels,
  type AiModelSynchronizationSnapshot,
  type AiRemoteModelSnapshot,
} from "./ai-model-synchronization.js";

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
  readonly modelSynchronizations: readonly AiModelSynchronizationSnapshot[];
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
  readonly modelSynchronizations: readonly AiModelSynchronizationSnapshot[];
}

export type AiProviderConfigurationField =
  | "schemaVersion"
  | "configurationVersion"
  | "activeSelection"
  | "credentialReferences"
  | "credentialReference"
  | "providerOverrides"
  | "modelOverrides"
  | "modelSynchronizations"
  | "modelSynchronization"
  | "remoteModel"
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

const createRemoteModel = (
  value: unknown,
): Result<AiRemoteModelSnapshot, InvalidAiProviderConfigurationValueError> => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    (value.createdAt !== undefined && typeof value.createdAt !== "string") ||
    (value.ownedBy !== undefined && typeof value.ownedBy !== "string")
  ) {
    return err(invalidValue("remoteModel", value));
  }

  return ok({
    id: value.id,
    ...(value.createdAt === undefined ? {} : { createdAt: value.createdAt as AiRemoteModelSnapshot["createdAt"] }),
    ...(value.ownedBy === undefined ? {} : { ownedBy: value.ownedBy }),
  });
};

const createModelSynchronization = (
  value: unknown,
): Result<AiModelSynchronizationSnapshot, InvalidAiProviderConfigurationValueError> => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.providerId) ||
    !isNonEmptyString(value.syncedAt) ||
    !Array.isArray(value.remoteModels)
  ) {
    return err(invalidValue("modelSynchronization", value));
  }

  const remoteModels = value.remoteModels.map(createRemoteModel);
  const invalidRemoteModel = remoteModels.find((remoteModel) => !remoteModel.ok);

  if (invalidRemoteModel !== undefined && !invalidRemoteModel.ok) {
    return invalidRemoteModel;
  }

  return ok({
    providerId: value.providerId,
    syncedAt: value.syncedAt as AiModelSynchronizationSnapshot["syncedAt"],
    remoteModels: remoteModels.flatMap((remoteModel) =>
      remoteModel.ok ? [remoteModel.value] : [],
    ),
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

const applyModelSynchronizations = (
  models: readonly AiModelDefinition[],
  synchronizations: readonly AiModelSynchronizationSnapshot[],
): readonly AiModelDefinition[] =>
  synchronizations.reduce(
    (currentModels, synchronization) =>
      synchronizeAiProviderModels({
        providerId: synchronization.providerId,
        syncedAt: synchronization.syncedAt,
        models: currentModels,
        remoteModels: synchronization.remoteModels,
      }).models,
    models,
  );

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
  const provider = providers.find(({ id }) => id === selection.providerId);

  if (provider === undefined) {
    return toSelectionError(new AiProviderNotFoundError(selection.providerId).type, selection);
  }

  const model = models.find(
    ({ providerId, modelId }) =>
      providerId === selection.providerId && modelId === selection.modelId,
  );

  if (model === undefined) {
    return toSelectionError(
      new AiModelNotFoundError(selection.providerId, selection.modelId).type,
      selection,
    );
  }

  return model.compatibilityStatus === "compatible"
    ? null
    : toSelectionError(
        new AiModelIncompatibleError(selection.providerId, selection.modelId).type,
        selection,
      );
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
  const modelSynchronizations = snapshot.modelSynchronizations === undefined
    ? []
    : Array.isArray(snapshot.modelSynchronizations)
      ? snapshot.modelSynchronizations.map(createModelSynchronization)
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
    ...(modelSynchronizations === undefined
      ? [invalidValue("modelSynchronizations", snapshot.modelSynchronizations)]
      : modelSynchronizations.flatMap((synchronization) =>
          synchronization.ok ? [] : [synchronization.error],
        )),
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
    modelSynchronizations:
      modelSynchronizations?.flatMap((synchronization) =>
        synchronization.ok ? [synchronization.value] : [],
      ) ?? [],
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
  modelSynchronizations: [],
});

export const createEffectiveAiProviderConfiguration = (
  catalogSnapshot: AiProviderCatalogSnapshot,
  localSnapshot: AiProviderConfigurationSnapshot | null,
): Result<EffectiveAiProviderConfiguration, InvalidAiProviderCatalogError | InvalidAiProviderConfigurationError> => {
  const snapshot = localSnapshot ?? createDefaultAiProviderConfigurationSnapshot(catalogSnapshot);
  const mergedCatalogSnapshot = {
    schemaVersion: catalogSnapshot.schemaVersion,
    providers: mergeProviders(catalogSnapshot.providers, snapshot.providerOverrides),
    models: applyModelSynchronizations(
      mergeModels(catalogSnapshot.models, snapshot.modelOverrides),
      snapshot.modelSynchronizations ?? [],
    ),
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
    modelSynchronizations: snapshot.modelSynchronizations ?? [],
  });
};
