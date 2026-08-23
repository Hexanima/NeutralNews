import { createHash } from "node:crypto";

import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  ExternalPortError,
  PortCancelledError,
  PortLimitExceededError,
  createArticle,
  createRuntimeEvidenceFragment,
  err,
  ok,
  type Article,
  type ArticleUrl,
  type EvidenceFragment,
  type IsoDateTimeString,
  type LimitedPortOperationOptions,
  type NewsSource,
  type PortError,
  type Result,
  type RssFeedReaderPort,
  type RssFeedReadResult,
  type UUID,
} from "app-domain";

import {
  executeExternalOperation,
  type ExternalServiceError,
  type ExternalServicePolicy,
} from "./external-service-policy.js";
import {
  requestExternalResource,
  type ExternalResourceRequest,
  type ExternalResourceResponse,
  type ExternalUrlPolicyError,
  type ResolveHostname,
} from "./external-url-policy.js";

export interface RssFeedReaderAdapterOptions {
  readonly externalServicePolicy?: Partial<ExternalServicePolicy> | undefined;
  readonly resolveHostname?: ResolveHostname | undefined;
  readonly requestUrl?: ExternalResourceRequest | undefined;
}

type UnknownRecord = Record<string, unknown>;

interface FeedEntryCandidate {
  readonly title: string | null;
  readonly url: ArticleUrl | null;
  readonly summary: string | null;
  readonly publishedAt: IsoDateTimeString | undefined;
}

const readOperationName = "rss.feed.read";
const parseOperationName = "rss.feed.parse";
const defaultMaxItems = 20;
const defaultMaxBytes = 1_048_576;
const defaultMaxRedirects = 3;
const operationDefaults: ExternalServicePolicy = {
  timeoutMs: 15_000,
  maxAttempts: 3,
  retryDelayMs: 250,
};

const xmlParser = new XMLParser({
  attributeNamePrefix: "",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: true,
  removeNSPrefix: true,
  textNodeName: "#text",
  trimValues: true,
});

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asArray = (value: unknown): readonly unknown[] => {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

const firstRecord = (value: unknown): UnknownRecord | null => {
  const candidate = Array.isArray(value) ? value[0] : value;

  return isRecord(candidate) ? candidate : null;
};

const textFromValue = (value: unknown): string | null => {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();

    return text === "" ? null : text;
  }

  if (Array.isArray(value)) {
    const text = value.flatMap((item) => textFromValue(item) ?? []).join(" ").trim();

    return text === "" ? null : text;
  }

  if (!isRecord(value)) {
    return null;
  }

  const directText = textFromValue(value["#text"]);

  if (directText !== null) {
    return directText;
  }

  const text = Object.entries(value)
    .filter(([key]) => key !== "type" && key !== "href" && key !== "rel")
    .flatMap(([, nestedValue]) => textFromValue(nestedValue) ?? [])
    .join(" ")
    .trim();

  return text === "" ? null : text;
};

const cleanText = (value: unknown): string | null => {
  const text = textFromValue(value)
    ?.replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text === undefined || text === "" ? null : text;
};

const articleUrlFromValue = (value: unknown): ArticleUrl | null => {
  const rawUrl = cleanText(value);

  if (rawUrl === null) {
    return null;
  }

  try {
    const url = new URL(rawUrl);

    return url.protocol === "http:" || url.protocol === "https:"
      ? (rawUrl as ArticleUrl)
      : null;
  } catch {
    return null;
  }
};

const isoDateFromValue = (value: unknown): IsoDateTimeString | undefined => {
  const rawDate = cleanText(value);

  if (rawDate === null) {
    return undefined;
  }

  const timestamp = Date.parse(rawDate);

  return Number.isNaN(timestamp)
    ? undefined
    : (new Date(timestamp).toISOString() as IsoDateTimeString);
};

const deterministicUuid = (seed: string): UUID => {
  const hex = createHash("sha256").update(seed).digest("hex");
  const variant = ((Number.parseInt(hex[16] ?? "8", 16) & 0x3) | 0x8).toString(16);

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}` as UUID;
};

const rssItemsFrom = (parsed: unknown): readonly unknown[] => {
  const root = firstRecord(parsed);
  const rss = firstRecord(root?.rss);
  const channel = firstRecord(rss?.channel);

  return asArray(channel?.item);
};

const atomEntriesFrom = (parsed: unknown): readonly unknown[] => {
  const root = firstRecord(parsed);
  const feed = firstRecord(root?.feed);

  return asArray(feed?.entry);
};

const atomLinkFrom = (entry: UnknownRecord): ArticleUrl | null => {
  const links = asArray(entry.link);

  for (const link of links) {
    if (isRecord(link)) {
      const rel = cleanText(link.rel);
      const href = articleUrlFromValue(link.href);

      if (href !== null && (rel === null || rel === "alternate")) {
        return href;
      }
    }

    const textLink = articleUrlFromValue(link);

    if (textLink !== null) {
      return textLink;
    }
  }

  return null;
};

const rssCandidateFrom = (item: unknown): FeedEntryCandidate | null => {
  if (!isRecord(item)) {
    return null;
  }

  return {
    title: cleanText(item.title),
    url: articleUrlFromValue(item.link),
    summary: cleanText(item.description),
    publishedAt: isoDateFromValue(item.pubDate),
  };
};

const atomCandidateFrom = (entry: unknown): FeedEntryCandidate | null => {
  if (!isRecord(entry)) {
    return null;
  }

  return {
    title: cleanText(entry.title),
    url: atomLinkFrom(entry),
    summary: cleanText(entry.summary) ?? cleanText(entry.content),
    publishedAt: isoDateFromValue(entry.published) ?? isoDateFromValue(entry.updated),
  };
};

const buildArticle = (
  source: NewsSource,
  candidate: FeedEntryCandidate,
): Article | null => {
  if (candidate.title === null || candidate.url === null) {
    return null;
  }

  const article = createArticle({
    id: deterministicUuid(`${source.id}:${candidate.url}`),
    sourceId: source.id,
    url: candidate.url,
    title: candidate.title,
    language: source.language,
    publishedAt: candidate.publishedAt,
  });

  return article.ok ? article.value : null;
};

const buildEvidence = (
  article: Article,
  summary: string | null,
): EvidenceFragment | null => {
  if (summary === null) {
    return null;
  }

  const evidence = createRuntimeEvidenceFragment({
    id: deterministicUuid(`${article.id}:rss_summary`),
    text: summary,
    provenance: {
      articleId: article.id,
      sourceId: article.sourceId,
      url: article.url,
      contentKind: "rss_summary",
    },
    quality: {
      contentLevel: "partial",
    },
  });

  return evidence.ok ? evidence.value : null;
};

const parseFeed = (input: {
  readonly body: string;
  readonly source: NewsSource;
  readonly feedUrl: ArticleUrl;
  readonly maxItems: number;
}): Result<RssFeedReadResult, PortError> => {
  if (XMLValidator.validate(input.body) !== true) {
    return err(new ExternalPortError(parseOperationName, "PermanentFailure"));
  }

  let parsed: unknown;

  try {
    parsed = xmlParser.parse(input.body);
  } catch {
    return err(new ExternalPortError(parseOperationName, "PermanentFailure"));
  }

  const rssItems = rssItemsFrom(parsed);
  const atomEntries = atomEntriesFrom(parsed);
  const candidates = rssItems.length > 0
    ? rssItems.map(rssCandidateFrom)
    : atomEntries.map(atomCandidateFrom);

  if (rssItems.length === 0 && atomEntries.length === 0) {
    return err(new ExternalPortError(parseOperationName, "PermanentFailure"));
  }

  const articles: Article[] = [];
  const evidence: EvidenceFragment[] = [];

  for (const candidate of candidates) {
    if (candidate === null) {
      continue;
    }

    const article = buildArticle(input.source, candidate);

    if (article === null) {
      continue;
    }

    articles.push(article);

    const evidenceFragment = buildEvidence(article, candidate.summary);

    if (evidenceFragment !== null) {
      evidence.push(evidenceFragment);
    }

    if (articles.length >= input.maxItems) {
      break;
    }
  }

  return ok({
    sourceId: input.source.id,
    feedUrl: input.feedUrl,
    articles,
    evidence,
  });
};

const mapExternalServiceError = (error: ExternalServiceError): PortError => {
  if (error.category === "Timeout") {
    return new PortLimitExceededError(readOperationName, "timeoutMs");
  }

  if (error.category === "Cancelled") {
    return new PortCancelledError(readOperationName);
  }

  return new ExternalPortError(
    readOperationName,
    error.category,
    error.statusCode,
  );
};

const mapExternalUrlPolicyError = (error: ExternalUrlPolicyError): PortError => {
  if (error.reason === "ResponseTooLarge") {
    return new PortLimitExceededError(readOperationName, "maxBytes");
  }

  if (error.reason === "TooManyRedirects") {
    return new PortLimitExceededError(readOperationName, "maxRedirects");
  }

  if (error.reason === "RequestFailed") {
    return new ExternalPortError(readOperationName, "TransientFailure");
  }

  return new ExternalPortError(readOperationName, "PermanentFailure");
};

const fetchFeed = async (input: {
  readonly feedUrl: ArticleUrl;
  readonly options: LimitedPortOperationOptions | undefined;
  readonly policy: ExternalServicePolicy;
  readonly resolveHostname: ResolveHostname | undefined;
  readonly requestUrl: ExternalResourceRequest | undefined;
}): Promise<Result<ExternalResourceResponse, PortError>> => {
  const response = await executeExternalOperation({
    ...input.policy,
    timeoutMs: input.options?.timeoutMs ?? input.policy.timeoutMs,
    operationName: readOperationName,
    idempotent: true,
    signal: input.options?.signal ?? new AbortController().signal,
    run: async ({ signal }) => {
      const resource = await requestExternalResource(input.feedUrl, {
        maxBytes: input.options?.maxBytes ?? defaultMaxBytes,
        maxRedirects: input.options?.maxRedirects ?? defaultMaxRedirects,
        signal,
        resolveHostname: input.resolveHostname,
        requestUrl: input.requestUrl,
      });

      if (!resource.ok) {
        if (resource.error.reason === "RequestFailed") {
          throw { transient: true };
        }

        return resource;
      }

      if (resource.value.statusCode < 200 || resource.value.statusCode >= 300) {
        throw { statusCode: resource.value.statusCode };
      }

      return resource;
    },
  });

  if (!response.ok) {
    return err(mapExternalServiceError(response.error));
  }

  if (!response.value.ok) {
    return err(mapExternalUrlPolicyError(response.value.error));
  }

  return ok(response.value.value);
};

export const createRssFeedReaderAdapter = ({
  externalServicePolicy,
  resolveHostname,
  requestUrl,
}: RssFeedReaderAdapterOptions = {}): RssFeedReaderPort => {
  const policy = { ...operationDefaults, ...externalServicePolicy };

  return {
    readFeed: async ({ source, feedUrl, options }) => {
      const fetched = await fetchFeed({
        feedUrl,
        options,
        policy,
        resolveHostname,
        requestUrl,
      });

      if (!fetched.ok) {
        return fetched;
      }

      return parseFeed({
        body: new TextDecoder("utf-8", { fatal: false }).decode(fetched.value.body),
        source,
        feedUrl,
        maxItems: Math.max(0, options?.maxItems ?? defaultMaxItems),
      });
    },
  };
};