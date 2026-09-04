import { createHash } from "node:crypto";

import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import {
  ExternalPortError,
  PortCancelledError,
  PortLimitExceededError,
  createArticle,
  createRuntimeEvidenceFragment,
  err,
  ok,
  type Article,
  type ArticleExtractionResult,
  type ArticleExtractorPort,
  type ArticleUrl,
  type EvidenceFragment,
  type IsoDateTimeString,
  type LimitedPortOperationOptions,
  type PortError,
  type Result,
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

export interface ArticleExtractorAdapterOptions {
  readonly externalServicePolicy?: Partial<ExternalServicePolicy> | undefined;
  readonly resolveHostname?: ResolveHostname | undefined;
  readonly requestUrl?: ExternalResourceRequest | undefined;
}

const extractOperationName = "article.extract";
const defaultMaxBytes = 2_097_152;
const defaultMaxRedirects = 3;
const minimumEditorialTextLength = 200;
const operationDefaults: ExternalServicePolicy = {
  timeoutMs: 15_000,
  maxAttempts: 3,
  retryDelayMs: 250,
};

const deterministicUuid = (seed: string): UUID => {
  const hex = createHash("sha256").update(seed).digest("hex");
  const variant = ((Number.parseInt(hex[16] ?? "8", 16) & 0x3) | 0x8).toString(16);

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}` as UUID;
};

const firstHeaderValue = (
  headers: ExternalResourceResponse["headers"],
  name: string,
): string | undefined => {
  const value = headers[name];

  return Array.isArray(value) ? value[0] : value;
};

const isHtmlResponse = (response: ExternalResourceResponse): boolean => {
  const contentType = firstHeaderValue(response.headers, "content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();

  return contentType === "text/html" || contentType === "application/xhtml+xml";
};

const metaContent = (
  document: Document,
  selectors: readonly string[],
): string | undefined => {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.getAttribute("content")?.trim();

    if (value !== undefined && value !== "") {
      return value;
    }
  }

  return undefined;
};

const normalizedIsoDate = (value: string | undefined): IsoDateTimeString | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp)
    ? undefined
    : (new Date(timestamp).toISOString() as IsoDateTimeString);
};

const asNonEmptyText = (value: string | null | undefined): string | undefined => {
  const normalized = value?.replace(/\s+/g, " ").trim();

  return normalized === "" || normalized === undefined ? undefined : normalized;
};

const partialResult = (
  article: Article,
  fallbackEvidence: readonly EvidenceFragment[],
) =>
  ok({
    article,
    evidence: fallbackEvidence,
    extractionStatus: "partial" as const,
  });

const extractFromHtml = (input: {
  readonly html: string;
  readonly article: Article;
  readonly resolvedUrl: string;
  readonly fallbackEvidence: readonly EvidenceFragment[];
}): Result<
  ArticleExtractionResult,
  PortError
> => {
  let dom: JSDOM;
  let parsed: ReturnType<Readability["parse"]>;

  try {
    dom = new JSDOM(input.html, { url: input.resolvedUrl });
    const heading = asNonEmptyText(dom.window.document.querySelector("article h1, main h1, h1")?.textContent);
    const metadataTitle = metaContent(dom.window.document, [
      'meta[property="og:title"]',
      'meta[name="title"]',
    ]);
    const metadataAuthor = metaContent(dom.window.document, [
      'meta[name="author"]',
      'meta[property="article:author"]',
    ]);
    const metadataPublishedAt = normalizedIsoDate(
      metaContent(dom.window.document, [
        'meta[property="article:published_time"]',
        'meta[name="date"]',
        'meta[name="publish-date"]',
      ]),
    );
    parsed = new Readability(dom.window.document).parse();

    const text = asNonEmptyText(parsed?.textContent);

    if (text === undefined || text.length < minimumEditorialTextLength) {
      return partialResult(input.article, input.fallbackEvidence);
    }

    const title = heading ?? asNonEmptyText(parsed?.title) ?? metadataTitle ?? input.article.title;
    const author = asNonEmptyText(parsed?.byline) ?? metadataAuthor ?? input.article.author;
    const publishedAt = metadataPublishedAt ?? input.article.publishedAt;
    const updatedArticle = createArticle({
      id: input.article.id,
      sourceId: input.article.sourceId,
      url: input.article.url,
      title,
      author,
      language: input.article.language,
      publishedAt,
    });

    if (!updatedArticle.ok) {
      return partialResult(input.article, input.fallbackEvidence);
    }

    const evidence = createRuntimeEvidenceFragment({
      id: deterministicUuid(`${input.article.id}:extracted_body:${input.resolvedUrl}`),
      text,
      provenance: {
        articleId: updatedArticle.value.id,
        sourceId: updatedArticle.value.sourceId,
        url: updatedArticle.value.url,
        contentKind: "extracted_body",
      },
      quality: { contentLevel: "complete" },
    });

    return evidence.ok
      ? ok({
          article: updatedArticle.value,
          evidence: [evidence.value],
          extractionStatus: "full_text",
        })
      : partialResult(input.article, input.fallbackEvidence);
  } catch {
    return partialResult(input.article, input.fallbackEvidence);
  }
};

const mapExternalServiceError = (error: ExternalServiceError): PortError => {
  if (error.category === "Timeout") {
    return new PortLimitExceededError(extractOperationName, "timeoutMs");
  }

  if (error.category === "Cancelled") {
    return new PortCancelledError(extractOperationName);
  }

  return new ExternalPortError(
    extractOperationName,
    error.category,
    error.statusCode,
  );
};

const mapExternalUrlPolicyError = (error: ExternalUrlPolicyError): PortError => {
  if (error.reason === "ResponseTooLarge") {
    return new PortLimitExceededError(extractOperationName, "maxBytes");
  }

  if (error.reason === "TooManyRedirects") {
    return new PortLimitExceededError(extractOperationName, "maxRedirects");
  }

  if (error.reason === "RequestFailed") {
    return new ExternalPortError(extractOperationName, "TransientFailure");
  }

  return new ExternalPortError(extractOperationName, "PermanentFailure");
};

const fetchArticle = async (input: {
  readonly articleUrl: ArticleUrl;
  readonly options: LimitedPortOperationOptions | undefined;
  readonly policy: ExternalServicePolicy;
  readonly resolveHostname: ResolveHostname | undefined;
  readonly requestUrl: ExternalResourceRequest | undefined;
}): Promise<Result<ExternalResourceResponse, PortError>> => {
  const response = await executeExternalOperation({
    ...input.policy,
    timeoutMs: input.options?.timeoutMs ?? input.policy.timeoutMs,
    operationName: extractOperationName,
    idempotent: true,
    signal: input.options?.signal ?? new AbortController().signal,
    run: async ({ signal }) => {
      const resource = await requestExternalResource(input.articleUrl, {
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
        if ([401, 402, 403].includes(resource.value.statusCode)) {
          return resource;
        }

        throw { statusCode: resource.value.statusCode };
      }

      if (!isHtmlResponse(resource.value)) {
        throw { statusCode: 415 };
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

export const createArticleExtractorAdapter = ({
  externalServicePolicy,
  resolveHostname,
  requestUrl,
}: ArticleExtractorAdapterOptions = {}): ArticleExtractorPort => {
  const policy = { ...operationDefaults, ...externalServicePolicy };

  return {
    extractArticle: async ({ article, fallbackEvidence, options }) => {
      const fetched = await fetchArticle({
        articleUrl: article.url,
        options,
        policy,
        resolveHostname,
        requestUrl,
      });

      if (!fetched.ok) {
        return fetched;
      }

      if ([401, 402, 403].includes(fetched.value.statusCode)) {
        return partialResult(article, fallbackEvidence);
      }

      return extractFromHtml({
        html: new TextDecoder("utf-8", { fatal: false }).decode(fetched.value.body),
        article,
        resolvedUrl: fetched.value.url,
        fallbackEvidence,
      });
    },
  };
};
