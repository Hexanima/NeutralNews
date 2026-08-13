import type { NewsSourceRegion } from "../entities/news-source.js";
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

export const newsSourceConfigurationSchemaVersion = 3;
export const initialNewsSourceConfigurationVersion = 1;
export const defaultTimeZone = "America/Argentina/Buenos_Aires";

export type RegionalTimeZoneMode = "automatic" | "manual";

export interface RegionalTimeZonePreferenceSnapshot {
  readonly mode: RegionalTimeZoneMode;
  readonly detectedTimeZone?: string | undefined;
  readonly manualTimeZone?: string | undefined;
}

export type FeedRegionDistributionSnapshot = Readonly<
  Record<NewsSourceRegion, number>
>;

export interface RegionalPreferencesSnapshot {
  readonly timeZone: RegionalTimeZonePreferenceSnapshot;
  readonly effectiveTimeZone: string;
  readonly feedDistribution: FeedRegionDistributionSnapshot;
}

export type RegionalPreferencesInput = Omit<
  RegionalPreferencesSnapshot,
  "effectiveTimeZone"
> & {
  readonly effectiveTimeZone?: string | undefined;
};

export const defaultRegionalPreferences: RegionalPreferencesSnapshot = {
  timeZone: { mode: "automatic" },
  effectiveTimeZone: defaultTimeZone,
  feedDistribution: {
    argentina: 3,
    latin_america: 2,
    international: 1,
  },
};

export interface NewsSourceConfigurationOverrideSnapshot {
  readonly id: string;
  readonly entry?: NewsSourceCatalogEntrySnapshot | undefined;
  readonly deleted?: boolean | undefined;
}

export interface NewsSourceConfigurationSnapshot {
  readonly schemaVersion: typeof newsSourceConfigurationSchemaVersion;
  readonly configurationVersion: number;
  readonly sourceOverrides: readonly NewsSourceConfigurationOverrideSnapshot[];
  readonly regionalPreferences: RegionalPreferencesSnapshot;
}

interface LegacyNewsSourceConfigurationSnapshot {
  readonly schemaVersion: 1;
  readonly configurationVersion: number;
  readonly sources: readonly NewsSourceCatalogEntrySnapshot[];
}

interface V2NewsSourceConfigurationSnapshot {
  readonly schemaVersion: 2;
  readonly configurationVersion: number;
  readonly sourceOverrides: readonly NewsSourceConfigurationOverrideSnapshot[];
}

export interface EffectiveNewsSourceConfiguration {
  readonly schemaVersion: number;
  readonly configurationVersion: number;
  readonly cacheVersion: string;
  readonly sources: readonly NewsSourceCatalogEntry[];
  readonly sourceOverrides: readonly NewsSourceConfigurationOverrideSnapshot[];
  readonly regionalPreferences: RegionalPreferencesSnapshot;
}

export type NewsSourceConfigurationField =
  | "schemaVersion"
  | "configurationVersion"
  | "sourceOverrides"
  | "sourceOverride"
  | "sources"
  | "id"
  | "regionalPreferences"
  | "timeZone"
  | "feedDistribution"
  | "instant";

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

const resultValue = <TResult, TError extends TaggedError>(
  result: Result<TResult, TError>,
): TResult => {
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isValidTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const createTimeZone = (
  value: unknown,
): Result<string, InvalidNewsSourceConfigurationValueError> => {
  if (typeof value !== "string" || value.trim() === "") {
    return err(invalidValue("timeZone", value));
  }

  const timeZone = value.trim();

  return isValidTimeZone(timeZone)
    ? ok(timeZone)
    : err(invalidValue("timeZone", value));
};

const createRegionalTimeZonePreference = (
  value: unknown,
): Result<
  RegionalPreferencesSnapshot["timeZone"],
  InvalidNewsSourceConfigurationValueError
> => {
  if (!isRecord(value)) {
    return err(invalidValue("timeZone", value));
  }

  if (value.mode === "manual") {
    const manualTimeZone = createTimeZone(value.manualTimeZone);

    return manualTimeZone.ok
      ? ok({ mode: "manual", manualTimeZone: manualTimeZone.value })
      : manualTimeZone;
  }

  if (value.mode === "automatic") {
    if (value.detectedTimeZone === undefined) {
      return ok({ mode: "automatic" });
    }

    const detectedTimeZone = createTimeZone(value.detectedTimeZone);

    return detectedTimeZone.ok
      ? ok({ mode: "automatic", detectedTimeZone: detectedTimeZone.value })
      : detectedTimeZone;
  }

  return err(invalidValue("timeZone", value));
};

const createFeedDistribution = (
  value: unknown,
): Result<FeedRegionDistributionSnapshot, InvalidNewsSourceConfigurationValueError> => {
  if (!isRecord(value)) {
    return err(invalidValue("feedDistribution", value));
  }

  const distribution = {
    argentina: value.argentina,
    latin_america: value.latin_america,
    international: value.international,
  };
  const values = Object.values(distribution);

  if (!values.every(isNonNegativeInteger)) {
    return err(invalidValue("feedDistribution", value));
  }

  const total = values.reduce((sum, count) => sum + count, 0);

  if (total < 1 || total > 6) {
    return err(invalidValue("feedDistribution", value));
  }

  return ok(distribution as FeedRegionDistributionSnapshot);
};

export const createRegionalPreferencesSnapshot = (
  value: unknown,
): Result<RegionalPreferencesSnapshot, InvalidNewsSourceConfigurationError> => {
  if (!isRecord(value)) {
    return err(
      new InvalidNewsSourceConfigurationError([
        invalidValue("regionalPreferences", value),
      ]),
    );
  }

  const timeZone = createRegionalTimeZonePreference(value.timeZone);
  const feedDistribution = createFeedDistribution(value.feedDistribution);
  const errors = [
    ...(timeZone.ok ? [] : [timeZone.error]),
    ...(feedDistribution.ok ? [] : [feedDistribution.error]),
  ];

  if (errors.length > 0) {
    return err(new InvalidNewsSourceConfigurationError(errors));
  }

  const validTimeZone = resultValue(timeZone);
  const effectiveTimeZone =
    validTimeZone.mode === "manual"
      ? validTimeZone.manualTimeZone ?? defaultTimeZone
      : validTimeZone.detectedTimeZone ?? defaultTimeZone;

  return ok({
    timeZone: validTimeZone,
    effectiveTimeZone,
    feedDistribution: resultValue(feedDistribution),
  });
};

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

const normalizeOverrideSnapshot = (
  snapshot: Record<string, unknown>,
): Result<
  Pick<NewsSourceConfigurationSnapshot, "configurationVersion" | "sourceOverrides">,
  InvalidNewsSourceConfigurationError
> => {
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
    configurationVersion: configurationVersion.ok
      ? configurationVersion.value
      : initialNewsSourceConfigurationVersion,
    sourceOverrides: validOverrides.flatMap((override) =>
      override.ok ? [override.value] : [],
    ),
  });
};

const normalizeCurrentSnapshot = (
  snapshot: Record<string, unknown>,
): Result<NewsSourceConfigurationSnapshot, InvalidNewsSourceConfigurationError> => {
  const schemaVersion = createVersion(snapshot.schemaVersion, "schemaVersion");
  const normalizedOverrides = normalizeOverrideSnapshot(snapshot);
  const regionalPreferences = createRegionalPreferencesSnapshot(
    snapshot.regionalPreferences,
  );
  const errors = [
    ...(schemaVersion.ok ? [] : [schemaVersion.error]),
    ...(normalizedOverrides.ok ? [] : normalizedOverrides.error.errors),
    ...(regionalPreferences.ok ? [] : regionalPreferences.error.errors),
  ];

  if (errors.length > 0) {
    return err(new InvalidNewsSourceConfigurationError(errors));
  }

  return ok({
    schemaVersion: newsSourceConfigurationSchemaVersion,
    configurationVersion: resultValue(normalizedOverrides).configurationVersion,
    sourceOverrides: resultValue(normalizedOverrides).sourceOverrides,
    regionalPreferences: resultValue(regionalPreferences),
  });
};

const migrateV2Snapshot = (
  snapshot: Record<string, unknown>,
): Result<NewsSourceConfigurationSnapshot, InvalidNewsSourceConfigurationError> => {
  const normalizedOverrides = normalizeOverrideSnapshot(snapshot);

  if (!normalizedOverrides.ok) {
    return normalizedOverrides;
  }

  return ok({
    schemaVersion: newsSourceConfigurationSchemaVersion,
    configurationVersion: resultValue(normalizedOverrides).configurationVersion,
    sourceOverrides: resultValue(normalizedOverrides).sourceOverrides,
    regionalPreferences: defaultRegionalPreferences,
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
    regionalPreferences: defaultRegionalPreferences,
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

  if (snapshot.schemaVersion === 2) {
    return migrateV2Snapshot(snapshot);
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
    regionalPreferences: defaultRegionalPreferences,
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
    regionalPreferences: localSnapshot?.regionalPreferences ?? defaultRegionalPreferences,
  });
};

export const toNewsSourceConfigurationSnapshot = (
  configuration: EffectiveNewsSourceConfiguration,
): NewsSourceConfigurationSnapshot => ({
  schemaVersion: newsSourceConfigurationSchemaVersion,
  configurationVersion: configuration.configurationVersion,
  sourceOverrides: configuration.sourceOverrides,
  regionalPreferences: configuration.regionalPreferences,
});

export const createLocalDateKey = (input: {
  readonly instant: string;
  readonly timeZone: string;
}): Result<string, InvalidNewsSourceConfigurationValueError> => {
  const timeZone = createTimeZone(input.timeZone);

  if (!timeZone.ok) {
    return timeZone;
  }

  const instant = new Date(input.instant);

  if (Number.isNaN(instant.getTime())) {
    return err(invalidValue("instant", input.instant));
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone.value,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );

  return ok(`${parts.year}-${parts.month}-${parts.day}`);
};
