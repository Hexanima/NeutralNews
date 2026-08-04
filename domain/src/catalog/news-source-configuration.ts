import { TaggedError } from "../types/error.js";
import { err, ok, type Result } from "../types/result.js";
import {
  createNewsSourceCatalog,
  type InvalidNewsSourceCatalogError,
  type NewsSourceCatalogEntry,
  type NewsSourceCatalogEntrySnapshot,
  type NewsSourceCatalogSnapshot,
} from "./news-source-catalog.js";
import { initialNewsSourceCatalogSnapshot } from "./initial-news-source-catalog.js";

export const newsSourceConfigurationSchemaVersion = 2;
export const initialNewsSourceConfigurationVersion = 1;

export interface NewsSourceConfigurationOverrideSnapshot {
  readonly id: string;
  readonly entry?: NewsSourceCatalogEntrySnapshot | undefined;
  readonly deleted?: boolean | undefined;
}

export interface NewsSourceConfigurationSnapshot {
  readonly schemaVersion: typeof newsSourceConfigurationSchemaVersion;
  readonly configurationVersion: number;
  readonly sourceOverrides: readonly NewsSourceConfigurationOverrideSnapshot[];
}

interface LegacyNewsSourceConfigurationSnapshot {
  readonly schemaVersion: 1;
  readonly configurationVersion: number;
  readonly sources: readonly NewsSourceCatalogEntrySnapshot[];
}

export interface EffectiveNewsSourceConfiguration {
  readonly schemaVersion: number;
  readonly configurationVersion: number;
  readonly cacheVersion: string;
  readonly sources: readonly NewsSourceCatalogEntry[];
  readonly sourceOverrides: readonly NewsSourceConfigurationOverrideSnapshot[];
}

export type NewsSourceConfigurationField =
  | "schemaVersion"
  | "configurationVersion"
  | "sourceOverrides"
  | "sourceOverride"
  | "sources"
  | "id";

export class InvalidNewsSourceConfigurationValueError extends TaggedError<"InvalidNewsSourceConfigurationValue"> {
  public readonly type = "InvalidNewsSourceConfigurationValue";

  constructor(
    public readonly field: NewsSourceConfigurationField,
    public readonly value: unknown,
  ) {
    super("InvalidNewsSourceConfigurationValue");
    this.message = `Invalid news source configuration ${field}`;
  }
}

export class InvalidNewsSourceConfigurationError extends TaggedError<"InvalidNewsSourceConfiguration"> {
  public readonly type = "InvalidNewsSourceConfiguration";

  constructor(
    public readonly errors: readonly (
      | InvalidNewsSourceConfigurationValueError
      | InvalidNewsSourceCatalogError
    )[],
  ) {
    super("InvalidNewsSourceConfiguration");
    this.message = "News source configuration violates domain invariants";
  }
}

const invalidValue = (
  field: NewsSourceConfigurationField,
  value: unknown,
) => new InvalidNewsSourceConfigurationValueError(field, value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;

const snapshotEntryEquals = (
  left: NewsSourceCatalogEntrySnapshot,
  right: NewsSourceCatalogEntrySnapshot,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const defaultCatalogEntriesById = () =>
  new Map(
    initialNewsSourceCatalogSnapshot.sources.map((entry) => [
      entry.source.id,
      entry,
    ]),
  );

const createVersion = (
  value: unknown,
  field: "schemaVersion" | "configurationVersion",
): Result<number, InvalidNewsSourceConfigurationValueError> =>
  isPositiveInteger(value) ? ok(value) : err(invalidValue(field, value));

const createOverrideSnapshot = (
  value: unknown,
): Result<
  NewsSourceConfigurationOverrideSnapshot,
  InvalidNewsSourceConfigurationValueError | InvalidNewsSourceCatalogError
> => {
  if (!isRecord(value) || typeof value.id !== "string") {
    return err(invalidValue("sourceOverride", value));
  }

  if (value.deleted === true) {
    if ("entry" in value) {
      return err(invalidValue("sourceOverride", value));
    }

    return ok({ id: value.id, deleted: true });
  }

  if (!isRecord(value.entry)) {
    return err(invalidValue("sourceOverride", value));
  }

  const entryCatalog = createNewsSourceCatalog({
    schemaVersion: 1,
    sources: [value.entry],
  });

  if (!entryCatalog.ok) {
    return entryCatalog;
  }

  const entry = value.entry as unknown as NewsSourceCatalogEntrySnapshot;

  if (entry.source.id !== value.id) {
    return err(invalidValue("id", value.id));
  }

  return ok({ id: value.id, entry });
};

const normalizeCurrentSnapshot = (
  snapshot: Record<string, unknown>,
): Result<NewsSourceConfigurationSnapshot, InvalidNewsSourceConfigurationError> => {
  const schemaVersion = createVersion(snapshot.schemaVersion, "schemaVersion");
  const configurationVersion = createVersion(
    snapshot.configurationVersion,
    "configurationVersion",
  );
  const overrides = Array.isArray(snapshot.sourceOverrides)
    ? snapshot.sourceOverrides.map(createOverrideSnapshot)
    : undefined;

  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();

  for (const override of overrides ?? []) {
    if (!override.ok) {
      continue;
    }

    if (seenIds.has(override.value.id)) {
      duplicateIds.add(override.value.id);
      continue;
    }

    seenIds.add(override.value.id);
  }

  const errors = [
    ...(schemaVersion.ok ? [] : [schemaVersion.error]),
    ...(configurationVersion.ok ? [] : [configurationVersion.error]),
    ...(overrides === undefined
      ? [invalidValue("sourceOverrides", snapshot.sourceOverrides)]
      : overrides.flatMap((override) => (override.ok ? [] : [override.error]))),
    ...[...duplicateIds].map((id) => invalidValue("id", id)),
  ];

  if (errors.length > 0) {
    return err(new InvalidNewsSourceConfigurationError(errors));
  }

  const validOverrides = overrides as readonly Result<
    NewsSourceConfigurationOverrideSnapshot,
    InvalidNewsSourceConfigurationValueError | InvalidNewsSourceCatalogError
  >[];

  return ok({
    schemaVersion: newsSourceConfigurationSchemaVersion,
    configurationVersion: configurationVersion.ok
      ? configurationVersion.value
      : initialNewsSourceConfigurationVersion,
    sourceOverrides: validOverrides.flatMap((override) =>
      override.ok ? [override.value] : [],
    ),
  });
};

const migrateLegacySnapshot = (
  snapshot: LegacyNewsSourceConfigurationSnapshot,
): Result<NewsSourceConfigurationSnapshot, InvalidNewsSourceConfigurationError> => {
  const legacyCatalog = createNewsSourceCatalog({
    schemaVersion: 1,
    sources: snapshot.sources,
  });

  if (!legacyCatalog.ok) {
    return err(new InvalidNewsSourceConfigurationError([legacyCatalog.error]));
  }

  const defaults = defaultCatalogEntriesById();
  const legacyEntries = new Map(
    snapshot.sources.map((entry) => [entry.source.id, entry]),
  );
  const sourceOverrides: NewsSourceConfigurationOverrideSnapshot[] = [];

  for (const defaultEntry of initialNewsSourceCatalogSnapshot.sources) {
    const legacyEntry = legacyEntries.get(defaultEntry.source.id);

    if (legacyEntry === undefined) {
      sourceOverrides.push({ id: defaultEntry.source.id, deleted: true });
      continue;
    }

    if (!snapshotEntryEquals(defaultEntry, legacyEntry)) {
      sourceOverrides.push({ id: defaultEntry.source.id, entry: legacyEntry });
    }
  }

  for (const legacyEntry of snapshot.sources) {
    if (!defaults.has(legacyEntry.source.id)) {
      sourceOverrides.push({
        id: legacyEntry.source.id,
        entry: legacyEntry,
      });
    }
  }

  return ok({
    schemaVersion: newsSourceConfigurationSchemaVersion,
    configurationVersion: snapshot.configurationVersion,
    sourceOverrides,
  });
};

export const createNewsSourceConfigurationSnapshot = (
  snapshot: unknown,
): Result<NewsSourceConfigurationSnapshot, InvalidNewsSourceConfigurationError> => {
  if (!isRecord(snapshot)) {
    return err(
      new InvalidNewsSourceConfigurationError([
        invalidValue("schemaVersion", snapshot),
      ]),
    );
  }

  if (snapshot.schemaVersion === 1) {
    if (
      !isPositiveInteger(snapshot.configurationVersion) ||
      !Array.isArray(snapshot.sources)
    ) {
      return err(
        new InvalidNewsSourceConfigurationError([
          ...(!isPositiveInteger(snapshot.configurationVersion)
            ? [invalidValue("configurationVersion", snapshot.configurationVersion)]
            : []),
          ...(!Array.isArray(snapshot.sources)
            ? [invalidValue("sources", snapshot.sources)]
            : []),
        ]),
      );
    }

    return migrateLegacySnapshot(
      snapshot as unknown as LegacyNewsSourceConfigurationSnapshot,
    );
  }

  if (snapshot.schemaVersion !== newsSourceConfigurationSchemaVersion) {
    return err(
      new InvalidNewsSourceConfigurationError([
        invalidValue("schemaVersion", snapshot.schemaVersion),
      ]),
    );
  }

  return normalizeCurrentSnapshot(snapshot);
};

export const createDefaultNewsSourceConfigurationSnapshot =
  (): NewsSourceConfigurationSnapshot => ({
    schemaVersion: newsSourceConfigurationSchemaVersion,
    configurationVersion: initialNewsSourceConfigurationVersion,
    sourceOverrides: [],
  });

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

const catalogFingerprint = (catalogSnapshot: NewsSourceCatalogSnapshot): string => {
  let hash = 2166136261;
  const serializedCatalog = stableStringify(catalogSnapshot);

  for (let index = 0; index < serializedCatalog.length; index += 1) {
    hash ^= serializedCatalog.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
};

const effectiveCacheVersion = (
  catalogSnapshot: NewsSourceCatalogSnapshot,
  configurationVersion: number,
): string => `${catalogSnapshot.schemaVersion}:${catalogFingerprint(
  catalogSnapshot,
)}:${configurationVersion}`;

export const createEffectiveNewsSourceConfiguration = (
  catalogSnapshot: NewsSourceCatalogSnapshot,
  localSnapshot: NewsSourceConfigurationSnapshot | null,
): Result<EffectiveNewsSourceConfiguration, InvalidNewsSourceCatalogError> => {
  const catalog = createNewsSourceCatalog(catalogSnapshot);

  if (!catalog.ok) {
    return catalog;
  }

  const sourceOverrides = localSnapshot?.sourceOverrides ?? [];
  const overridesById = new Map(
    sourceOverrides.map((override) => [override.id, override]),
  );
  const defaultIds = new Set(
    catalogSnapshot.sources.map((entry) => entry.source.id),
  );
  const mergedSnapshots: NewsSourceCatalogEntrySnapshot[] = [];

  for (const entry of catalogSnapshot.sources) {
    const override = overridesById.get(entry.source.id);

    if (override?.deleted === true) {
      continue;
    }

    mergedSnapshots.push(override?.entry ?? entry);
  }

  for (const override of sourceOverrides) {
    if (override.entry !== undefined && !defaultIds.has(override.id)) {
      mergedSnapshots.push(override.entry);
    }
  }

  const effectiveCatalog = createNewsSourceCatalog({
    schemaVersion: catalog.value.schemaVersion,
    sources: mergedSnapshots,
  });

  if (!effectiveCatalog.ok) {
    return effectiveCatalog;
  }

  const configurationVersion =
    localSnapshot?.configurationVersion ??
    initialNewsSourceConfigurationVersion;

  return ok({
    schemaVersion: effectiveCatalog.value.schemaVersion,
    configurationVersion,
    cacheVersion: effectiveCacheVersion(catalogSnapshot, configurationVersion),
    sources: effectiveCatalog.value.sources,
    sourceOverrides,
  });
};

export const toNewsSourceConfigurationSnapshot = (
  configuration: EffectiveNewsSourceConfiguration,
): NewsSourceConfigurationSnapshot => ({
  schemaVersion: newsSourceConfigurationSchemaVersion,
  configurationVersion: configuration.configurationVersion,
  sourceOverrides: configuration.sourceOverrides,
});
