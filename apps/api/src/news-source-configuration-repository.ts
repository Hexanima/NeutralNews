import {
  createDefaultNewsSourceConfigurationSnapshot,
  createEffectiveNewsSourceConfiguration,
  createNewsSourceConfigurationSnapshot,
  err,
  initialNewsSourceCatalogSnapshot,
  isOk,
  ok,
  TaggedError,
  type EffectiveNewsSourceConfiguration,
  type InvalidNewsSourceCatalogError,
  type InvalidNewsSourceConfigurationError,
  type NewsSourceCatalogEntrySnapshot,
  type NewsSourceCatalogSnapshot,
  type NewsSourceConfigurationOverrideSnapshot,
  type NewsSourceConfigurationSnapshot,
  type Result,
} from "app-domain";

import {
  CorruptJsonError,
  createLocalJsonFileRepository,
  type JsonValue,
  type LocalJsonFileRepository,
  type LocalJsonFileRepositoryError,
} from "./local-json-file-repository.js";

const defaultRelativePath = "configuration/news-sources.json";

export class NewsSourceConfigurationStorageError extends TaggedError<"NewsSourceConfigurationStorageError"> {
  public readonly type = "NewsSourceConfigurationStorageError";

  constructor(public readonly cause: LocalJsonFileRepositoryError) {
    super("NewsSourceConfigurationStorageError");
    this.message = "Could not persist news source configuration";
  }
}

export type JsonNewsSourceConfigurationRepositoryError =
  | NewsSourceConfigurationStorageError
  | InvalidNewsSourceConfigurationError
  | InvalidNewsSourceCatalogError;

export interface JsonNewsSourceConfigurationRepository {
  getEffectiveConfiguration: () => Promise<
    Result<
      EffectiveNewsSourceConfiguration,
      JsonNewsSourceConfigurationRepositoryError
    >
  >;
  saveEntry: (input: {
    entry: NewsSourceCatalogEntrySnapshot;
  }) => Promise<
    Result<
      EffectiveNewsSourceConfiguration,
      JsonNewsSourceConfigurationRepositoryError
    >
  >;
  deleteSource: (input: {
    id: string;
  }) => Promise<
    Result<
      EffectiveNewsSourceConfiguration,
      JsonNewsSourceConfigurationRepositoryError
    >
  >;
  restoreDefaults: () => Promise<
    Result<
      EffectiveNewsSourceConfiguration,
      JsonNewsSourceConfigurationRepositoryError
    >
  >;
}

export interface JsonNewsSourceConfigurationRepositoryOptions {
  jsonRepository?: LocalJsonFileRepository | undefined;
  relativePath?: string | undefined;
  catalogSnapshot?: NewsSourceCatalogSnapshot | undefined;
}

const cloneJson = <TValue>(value: TValue): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

const entryEquals = (
  left: NewsSourceCatalogEntrySnapshot,
  right: NewsSourceCatalogEntrySnapshot,
) => JSON.stringify(left) === JSON.stringify(right);

const overrideEqualsDefault = (
  entry: NewsSourceCatalogEntrySnapshot,
  catalogSnapshot: NewsSourceCatalogSnapshot,
): boolean => {
  const defaultEntry = catalogSnapshot.sources.find(
    (candidate) => candidate.source.id === entry.source.id,
  );

  return defaultEntry !== undefined && entryEquals(defaultEntry, entry);
};

const incrementVersion = (
  snapshot: NewsSourceConfigurationSnapshot,
): number => snapshot.configurationVersion + 1;

const toStorageError = (error: LocalJsonFileRepositoryError) =>
  new NewsSourceConfigurationStorageError(error);

export const createJsonNewsSourceConfigurationRepository = (
  dataDirectory: string,
  options: JsonNewsSourceConfigurationRepositoryOptions = {},
): JsonNewsSourceConfigurationRepository => {
  const jsonRepository =
    options.jsonRepository ?? createLocalJsonFileRepository(dataDirectory);
  const relativePath = options.relativePath ?? defaultRelativePath;
  const catalogSnapshot =
    options.catalogSnapshot ?? initialNewsSourceCatalogSnapshot;

  const writeSnapshot = async (
    snapshot: NewsSourceConfigurationSnapshot,
  ): Promise<Result<void, NewsSourceConfigurationStorageError>> => {
    const result = await jsonRepository.writeJson(
      relativePath,
      cloneJson(snapshot),
    );

    return result.ok ? ok(undefined) : err(toStorageError(result.error));
  };

  const effectiveFromSnapshot = (
    snapshot: NewsSourceConfigurationSnapshot,
  ): Result<
    EffectiveNewsSourceConfiguration,
    InvalidNewsSourceCatalogError
  > => createEffectiveNewsSourceConfiguration(catalogSnapshot, snapshot);

  const readSnapshot = async (): Promise<
    Result<
      NewsSourceConfigurationSnapshot,
      NewsSourceConfigurationStorageError | InvalidNewsSourceConfigurationError
    >
  > => {
    const readResult = await jsonRepository.readJson(relativePath);

    if (!readResult.ok) {
      if (readResult.error instanceof CorruptJsonError) {
        const defaultSnapshot = createDefaultNewsSourceConfigurationSnapshot();
        const writeResult = await writeSnapshot(defaultSnapshot);

        return writeResult.ok ? ok(defaultSnapshot) : writeResult;
      }

      return err(toStorageError(readResult.error));
    }

    if (readResult.value === null) {
      const defaultSnapshot = createDefaultNewsSourceConfigurationSnapshot();
      const writeResult = await writeSnapshot(defaultSnapshot);

      return writeResult.ok ? ok(defaultSnapshot) : writeResult;
    }

    const snapshot = createNewsSourceConfigurationSnapshot(readResult.value);

    if (!snapshot.ok) {
      return snapshot;
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

  const readEffectiveConfiguration =
    async (): Promise<
      Result<
        EffectiveNewsSourceConfiguration,
        JsonNewsSourceConfigurationRepositoryError
      >
    > => {
      const snapshot = await readSnapshot();

      if (!snapshot.ok) {
        return snapshot;
      }

      return effectiveFromSnapshot(snapshot.value);
    };

  const saveMutatedSnapshot = async (
    snapshot: NewsSourceConfigurationSnapshot,
  ): Promise<
    Result<
      EffectiveNewsSourceConfiguration,
      JsonNewsSourceConfigurationRepositoryError
    >
  > => {
    const writeResult = await writeSnapshot(snapshot);

    if (!writeResult.ok) {
      return writeResult;
    }

    return effectiveFromSnapshot(snapshot);
  };

  return {
    getEffectiveConfiguration: readEffectiveConfiguration,

    saveEntry: async ({ entry }) => {
      const current = await readSnapshot();

      if (!current.ok) {
        return current;
      }

      const nextOverrides = current.value.sourceOverrides.filter(
        (override) => override.id !== entry.source.id,
      );
      const shouldPersistOverride = !overrideEqualsDefault(
        entry,
        catalogSnapshot,
      );
      const sourceOverrides: NewsSourceConfigurationOverrideSnapshot[] =
        shouldPersistOverride
          ? [...nextOverrides, { id: entry.source.id, entry }]
          : nextOverrides;
      const nextSnapshot = createNewsSourceConfigurationSnapshot({
        schemaVersion: 2,
        configurationVersion: incrementVersion(current.value),
        sourceOverrides,
      });

      if (!nextSnapshot.ok) {
        return nextSnapshot;
      }

      return saveMutatedSnapshot(nextSnapshot.value);
    },

    deleteSource: async ({ id }) => {
      const current = await readSnapshot();

      if (!current.ok) {
        return current;
      }

      const defaultExists = catalogSnapshot.sources.some(
        (entry) => entry.source.id === id,
      );
      const nextOverrides = current.value.sourceOverrides.filter(
        (override) => override.id !== id,
      );
      const sourceOverrides: NewsSourceConfigurationOverrideSnapshot[] =
        defaultExists ? [...nextOverrides, { id, deleted: true }] : nextOverrides;
      const nextSnapshot = createNewsSourceConfigurationSnapshot({
        schemaVersion: 2,
        configurationVersion: incrementVersion(current.value),
        sourceOverrides,
      });

      if (!nextSnapshot.ok) {
        return nextSnapshot;
      }

      return saveMutatedSnapshot(nextSnapshot.value);
    },

    restoreDefaults: async () => {
      const current = await readSnapshot();

      if (!current.ok) {
        return current;
      }

      const nextSnapshot: NewsSourceConfigurationSnapshot = {
        schemaVersion: 2,
        configurationVersion: incrementVersion(current.value),
        sourceOverrides: [],
      };

      return saveMutatedSnapshot(nextSnapshot);
    },
  };
};
