import {
  createAiProviderConfigurationSnapshot,
  createDefaultAiProviderConfigurationSnapshot,
  createEffectiveAiProviderConfiguration,
  err,
  initialAiProviderCatalogSnapshot,
  InvalidAiProviderConfigurationError,
  InvalidAiProviderConfigurationValueError,
  isOk,
  ok,
  TaggedError,
  validateAiModelSelection,
  type AiModelSelection,
  type AiModelSynchronizationSnapshot,
  type AiProviderCatalogSnapshot,
  type AiProviderConfigurationSnapshot,
  type EffectiveAiProviderConfiguration,
  type InvalidAiProviderCatalogError,
  type Result,
} from "app-domain";

import {
  CorruptJsonError,
  createLocalJsonFileRepository,
  type JsonValue,
  type LocalJsonFileRepository,
  type LocalJsonFileRepositoryError,
} from "./local-json-file-repository.js";

const defaultRelativePath = "configuration/ai-providers.json";

export class AiProviderConfigurationStorageError extends TaggedError<"AiProviderConfigurationStorageError"> {
  public readonly type = "AiProviderConfigurationStorageError";

  constructor(public readonly cause: LocalJsonFileRepositoryError) {
    super("AiProviderConfigurationStorageError");
    this.message = "Could not persist AI provider configuration";
  }
}

export type JsonAiProviderConfigurationRepositoryError =
  | AiProviderConfigurationStorageError
  | InvalidAiProviderConfigurationError
  | InvalidAiProviderCatalogError;

export interface JsonAiProviderConfigurationRepository {
  getEffectiveConfiguration: () => Promise<
    Result<
      EffectiveAiProviderConfiguration,
      JsonAiProviderConfigurationRepositoryError
    >
  >;
  saveActiveSelection: (input: {
    selection: AiModelSelection;
  }) => Promise<
    Result<
      EffectiveAiProviderConfiguration,
      JsonAiProviderConfigurationRepositoryError
    >
  >;
  saveCredentialReference: (input: {
    providerId: string;
    fieldId: string;
    reference: string;
    secretValue?: string | undefined;
  }) => Promise<
    Result<
      EffectiveAiProviderConfiguration,
      JsonAiProviderConfigurationRepositoryError
    >
  >;
  saveModelSynchronization: (input: AiModelSynchronizationSnapshot) => Promise<
    Result<
      EffectiveAiProviderConfiguration,
      JsonAiProviderConfigurationRepositoryError
    >
  >;
}

export interface JsonAiProviderConfigurationRepositoryOptions {
  jsonRepository?: LocalJsonFileRepository | undefined;
  relativePath?: string | undefined;
  catalogSnapshot?: AiProviderCatalogSnapshot | undefined;
}

const cloneJson = <TValue>(value: TValue): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

const incrementVersion = (
  snapshot: AiProviderConfigurationSnapshot,
): number => snapshot.configurationVersion + 1;

const toStorageError = (error: LocalJsonFileRepositoryError) =>
  new AiProviderConfigurationStorageError(error);

const createSnapshotFromCurrent = (
  current: AiProviderConfigurationSnapshot,
  input: {
    activeSelection?: AiModelSelection | undefined;
    credentialReferences?: AiProviderConfigurationSnapshot["credentialReferences"] | undefined;
    modelSynchronizations?: AiProviderConfigurationSnapshot["modelSynchronizations"] | undefined;
  },
) =>
  createAiProviderConfigurationSnapshot({
    schemaVersion: 1,
    configurationVersion: incrementVersion(current),
    activeSelection: input.activeSelection ?? current.activeSelection,
    credentialReferences:
      input.credentialReferences ?? current.credentialReferences,
    providerOverrides: current.providerOverrides,
    modelOverrides: current.modelOverrides,
    modelSynchronizations:
      input.modelSynchronizations ?? current.modelSynchronizations,
  });

const selectionConfigurationError = (selection: AiModelSelection) =>
  new InvalidAiProviderConfigurationError([
    new InvalidAiProviderConfigurationValueError("activeSelection", selection),
  ]);

export const createJsonAiProviderConfigurationRepository = (
  dataDirectory: string,
  options: JsonAiProviderConfigurationRepositoryOptions = {},
): JsonAiProviderConfigurationRepository => {
  const jsonRepository =
    options.jsonRepository ?? createLocalJsonFileRepository(dataDirectory);
  const relativePath = options.relativePath ?? defaultRelativePath;
  const catalogSnapshot =
    options.catalogSnapshot ?? initialAiProviderCatalogSnapshot;

  const writeSnapshot = async (
    snapshot: AiProviderConfigurationSnapshot,
  ): Promise<Result<void, AiProviderConfigurationStorageError>> => {
    const result = await jsonRepository.writeJson(
      relativePath,
      cloneJson(snapshot),
    );

    return result.ok ? ok(undefined) : err(toStorageError(result.error));
  };

  const effectiveFromSnapshot = (
    snapshot: AiProviderConfigurationSnapshot,
  ): Result<EffectiveAiProviderConfiguration, InvalidAiProviderCatalogError | InvalidAiProviderConfigurationError> =>
    createEffectiveAiProviderConfiguration(catalogSnapshot, snapshot);

  const readSnapshot = async (): Promise<
    Result<
      AiProviderConfigurationSnapshot,
      AiProviderConfigurationStorageError | InvalidAiProviderConfigurationError
    >
  > => {
    const readResult = await jsonRepository.readJson(relativePath);

    if (!readResult.ok) {
      if (readResult.error instanceof CorruptJsonError) {
        const defaultSnapshot = createDefaultAiProviderConfigurationSnapshot(catalogSnapshot);
        const writeResult = await writeSnapshot(defaultSnapshot);

        return writeResult.ok ? ok(defaultSnapshot) : writeResult;
      }

      return err(toStorageError(readResult.error));
    }

    if (readResult.value === null) {
      const defaultSnapshot = createDefaultAiProviderConfigurationSnapshot(catalogSnapshot);
      const writeResult = await writeSnapshot(defaultSnapshot);

      return writeResult.ok ? ok(defaultSnapshot) : writeResult;
    }

    const snapshot = createAiProviderConfigurationSnapshot(readResult.value);

    if (!snapshot.ok) {
      const defaultSnapshot = createDefaultAiProviderConfigurationSnapshot(catalogSnapshot);
      const writeResult = await writeSnapshot(defaultSnapshot);

      return writeResult.ok ? ok(defaultSnapshot) : writeResult;
    }

    if (
      !isOk(snapshot) ||
      JSON.stringify(snapshot.value) !== JSON.stringify(readResult.value)
    ) {
      const writeResult = await writeSnapshot(snapshot.value);

      if (!writeResult.ok) {
        return writeResult;
      }
    }

    return snapshot;
  };

  const readEffectiveConfiguration = async (): Promise<
    Result<
      EffectiveAiProviderConfiguration,
      JsonAiProviderConfigurationRepositoryError
    >
  > => {
    const snapshot = await readSnapshot();

    if (!snapshot.ok) {
      return snapshot;
    }

    const effective = effectiveFromSnapshot(snapshot.value);

    if (effective.ok) {
      return effective;
    }

    const defaultSnapshot = createDefaultAiProviderConfigurationSnapshot(catalogSnapshot);
    const writeResult = await writeSnapshot(defaultSnapshot);

    return writeResult.ok ? effectiveFromSnapshot(defaultSnapshot) : writeResult;
  };

  const saveMutatedSnapshot = async (
    snapshot: AiProviderConfigurationSnapshot,
  ): Promise<
    Result<
      EffectiveAiProviderConfiguration,
      JsonAiProviderConfigurationRepositoryError
    >
  > => {
    const effective = effectiveFromSnapshot(snapshot);

    if (!effective.ok) {
      return effective;
    }

    const writeResult = await writeSnapshot(snapshot);

    if (!writeResult.ok) {
      return writeResult;
    }

    return effective;
  };

  return {
    getEffectiveConfiguration: readEffectiveConfiguration,

    saveActiveSelection: async ({ selection }) => {
      const current = await readSnapshot();

      if (!current.ok) {
        return current;
      }

      const nextSnapshot = createSnapshotFromCurrent(current.value, {
        activeSelection: selection,
      });

      if (!nextSnapshot.ok) {
        return nextSnapshot;
      }

      const effective = effectiveFromSnapshot(nextSnapshot.value);

      if (!effective.ok) {
        return effective;
      }

      const selectable = validateAiModelSelection({
        providers: effective.value.providers,
        models: effective.value.models,
        selection,
        requiredCapabilities: [],
      });

      if (!selectable.ok) {
        return err(selectionConfigurationError(selection));
      }

      const writeResult = await writeSnapshot(nextSnapshot.value);

      if (!writeResult.ok) {
        return writeResult;
      }

      return effective;
    },

    saveCredentialReference: async ({ providerId, fieldId, reference }) => {
      const current = await readSnapshot();

      if (!current.ok) {
        return current;
      }

      const credentialReferences = [
        ...current.value.credentialReferences.filter(
          (credentialReference) =>
            credentialReference.providerId !== providerId ||
            credentialReference.fieldId !== fieldId,
        ),
        { providerId, fieldId, reference },
      ];
      const nextSnapshot = createSnapshotFromCurrent(current.value, {
        credentialReferences,
      });

      if (!nextSnapshot.ok) {
        return nextSnapshot;
      }

      return saveMutatedSnapshot(nextSnapshot.value);
    },

    saveModelSynchronization: async (input) => {
      const current = await readSnapshot();

      if (!current.ok) {
        return current;
      }

      const modelSynchronizations = [
        ...current.value.modelSynchronizations.filter(
          (synchronization) => synchronization.providerId !== input.providerId,
        ),
        input,
      ];
      const nextSnapshot = createSnapshotFromCurrent(current.value, {
        modelSynchronizations,
      });

      if (!nextSnapshot.ok) {
        return nextSnapshot;
      }

      return saveMutatedSnapshot(nextSnapshot.value);
    },
  };
};
