import { TaggedError } from "../types/error.js";
import { err, ok, type Result } from "../types/result.js";
import type { ArticleUrl } from "../entities/article-evidence.js";
import {
  createNewsSource,
  type InvalidNewsSourceError,
  type NewsSource,
  type NewsSourceSnapshot,
} from "../entities/news-source.js";

export type NewsSourceDiscovery =
  | { readonly mode: "rss"; readonly feedUrl: ArticleUrl }
  | { readonly mode: "search_only" };

export type NewsSourceDiscoverySnapshot =
  | { readonly mode: "rss"; readonly feedUrl: string }
  | { readonly mode: "search_only" };

export interface NewsSourceCatalogEntry {
  readonly source: NewsSource;
  readonly discovery: NewsSourceDiscovery;
}

export interface NewsSourceCatalogEntrySnapshot {
  readonly source: NewsSourceSnapshot;
  readonly discovery: NewsSourceDiscoverySnapshot;
}

export interface NewsSourceCatalog {
  readonly schemaVersion: number;
  readonly sources: readonly NewsSourceCatalogEntry[];
}

export interface NewsSourceCatalogSnapshot {
  readonly schemaVersion: number;
  readonly sources: readonly NewsSourceCatalogEntrySnapshot[];
}

export type NewsSourceCatalogField =
  | "schemaVersion"
  | "sources"
  | "source"
  | "discovery"
  | "mode"
  | "feedUrl"
  | "id";

export class InvalidNewsSourceCatalogValueError extends TaggedError<"InvalidNewsSourceCatalogValue"> {
  public readonly type = "InvalidNewsSourceCatalogValue";

  constructor(
    public readonly field: NewsSourceCatalogField,
    public readonly value: unknown,
  ) {
    super("InvalidNewsSourceCatalogValue");
    this.message = `Invalid news source catalog ${field}`;
  }
}

export class InvalidNewsSourceCatalogError extends TaggedError<"InvalidNewsSourceCatalog"> {
  public readonly type = "InvalidNewsSourceCatalog";

  constructor(
    public readonly errors: readonly (
      | InvalidNewsSourceCatalogValueError
      | InvalidNewsSourceError
    )[],
  ) {
    super("InvalidNewsSourceCatalog");
    this.message = "News source catalog violates domain invariants";
  }
}

const invalidValue = (field: NewsSourceCatalogField, value: unknown) =>
  new InvalidNewsSourceCatalogValueError(field, value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const createSchemaVersion = (
  value: unknown,
): Result<number, InvalidNewsSourceCatalogValueError> => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return err(invalidValue("schemaVersion", value));
  }

  return ok(value);
};

const createFeedUrl = (
  value: unknown,
): Result<ArticleUrl, InvalidNewsSourceCatalogValueError> => {
  if (typeof value !== "string") {
    return err(invalidValue("feedUrl", value));
  }

  const trimmed = value.trim();

  try {
    const url = new URL(trimmed);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return err(invalidValue("feedUrl", value));
    }

    return ok(trimmed as ArticleUrl);
  } catch {
    return err(invalidValue("feedUrl", value));
  }
};

const createDiscovery = (
  value: unknown,
): Result<NewsSourceDiscovery, InvalidNewsSourceCatalogValueError> => {
  if (!isRecord(value) || typeof value.mode !== "string") {
    return err(invalidValue("discovery", value));
  }

  if (value.mode === "search_only") {
    return ok({ mode: "search_only" });
  }

  if (value.mode !== "rss") {
    return err(invalidValue("mode", value.mode));
  }

  const feedUrl = createFeedUrl(value.feedUrl);

  if (!feedUrl.ok) {
    return feedUrl;
  }

  return ok({ mode: "rss", feedUrl: feedUrl.value });
};

type CreatedCatalogEntry = {
  readonly source: Result<
    NewsSource,
    InvalidNewsSourceError | InvalidNewsSourceCatalogValueError
  >;
  readonly discovery: Result<
    NewsSourceDiscovery,
    InvalidNewsSourceCatalogValueError
  >;
};

const createCatalogEntry = (entry: unknown): CreatedCatalogEntry => {
  if (!isRecord(entry)) {
    return {
      source: err(invalidValue("source", entry)),
      discovery: err(invalidValue("discovery", entry)),
    };
  }

  return {
    source: isRecord(entry.source)
      ? createNewsSource(entry.source as unknown as NewsSourceSnapshot)
      : err(invalidValue("source", entry.source)),
    discovery: createDiscovery(entry.discovery),
  };
};

export const createNewsSourceCatalog = (
  snapshot: unknown,
): Result<NewsSourceCatalog, InvalidNewsSourceCatalogError> => {
  if (!isRecord(snapshot)) {
    return err(
      new InvalidNewsSourceCatalogError([invalidValue("sources", snapshot)]),
    );
  }

  const schemaVersion = createSchemaVersion(snapshot.schemaVersion);
  const sourceSnapshots = Array.isArray(snapshot.sources)
    ? snapshot.sources
    : undefined;

  if (!schemaVersion.ok || sourceSnapshots === undefined) {
    return err(
      new InvalidNewsSourceCatalogError([
        ...(schemaVersion.ok ? [] : [schemaVersion.error]),
        ...(sourceSnapshots === undefined
          ? [invalidValue("sources", snapshot.sources)]
          : []),
      ]),
    );
  }

  const createdEntries = sourceSnapshots.map(createCatalogEntry);
  const ids = new Set<string>();
  const duplicateIds = new Set<string>();

  for (const entry of createdEntries) {
    if (!entry.source.ok) {
      continue;
    }

    if (ids.has(entry.source.value.id)) {
      duplicateIds.add(entry.source.value.id);
      continue;
    }

    ids.add(entry.source.value.id);
  }

  const errors = [
    ...createdEntries.flatMap((entry) => [
      ...(entry.source.ok ? [] : [entry.source.error]),
      ...(entry.discovery.ok ? [] : [entry.discovery.error]),
    ]),
    ...[...duplicateIds].map((id) => invalidValue("id", id)),
  ];

  if (errors.length > 0) {
    return err(new InvalidNewsSourceCatalogError(errors));
  }

  return ok({
    schemaVersion: schemaVersion.value,
    sources: createdEntries.flatMap((entry) =>
      entry.source.ok && entry.discovery.ok
        ? [{ source: entry.source.value, discovery: entry.discovery.value }]
        : [],
    ),
  });
};
