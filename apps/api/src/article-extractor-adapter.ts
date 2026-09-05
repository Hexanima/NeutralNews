import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";

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
  readonly parseDocument?: ParseDocument | undefined;
}

interface ParsedDocument {
  readonly text?: string | undefined;
  readonly title?: string | undefined;
  readonly author?: string | undefined;
  readonly publishedAt?: string | undefined;
  readonly paywalled: boolean;
}

interface ParseDocumentInput {
  readonly html: string;
  readonly resolvedUrl: string;
  readonly signal: AbortSignal;
}

type ParseDocument = (input: ParseDocumentInput) => Promise<ParsedDocument | null>;

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

const parserWorkerSource = `
const { parentPort, workerData } = require("node:worker_threads");
const { Readability } = require("@mozilla/readability");
const { JSDOM } = require("jsdom");
const asText = (value) => {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\\s+/g, " ").trim();
  return normalized === "" ? undefined : normalized;
};
const metaContent = (document, selectors) => {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.getAttribute("content");
    const text = asText(value);
    if (text !== undefined) return text;
  }
  return undefined;
};
const jsonLdValues = (value) => {
  if (Array.isArray(value)) return value.flatMap(jsonLdValues);
  if (value && typeof value === "object") return [value, ...Object.values(value).flatMap(jsonLdValues)];
  return [];
};
const readJsonLd = (document) => Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
  .flatMap((script) => { try { return jsonLdValues(JSON.parse(script.textContent || "")); } catch { return []; } });
const parse = ({ html, resolvedUrl }) => {
  const dom = new JSDOM(html, { url: resolvedUrl });
  const document = dom.window.document;
  const jsonLd = readJsonLd(document);
  const paywalled = jsonLd.some((value) => value.isAccessibleForFree === false || value.isAccessibleForFree === "false")
    || document.querySelector('[data-paywall], [data-metered], [class*="paywall" i], [id*="paywall" i]') !== null;
  const time = document.querySelector('article time[datetime], main time[datetime], time[datetime]')?.getAttribute("datetime");
  const jsonLdDate = jsonLd.find((value) => typeof value.datePublished === "string")?.datePublished;
  const publishedAt = metaContent(document, ['meta[property="article:published_time"]', 'meta[name="date"]', 'meta[name="publish-date"]']) || asText(time) || asText(jsonLdDate);
  const parsed = new Readability(document).parse();
  return {
    text: asText(parsed?.textContent),
    title: asText(document.querySelector("article h1, main h1, h1")?.textContent) || asText(parsed?.title) || metaContent(document, ['meta[property="og:title"]', 'meta[name="title"]']),
    author: asText(parsed?.byline) || metaContent(document, ['meta[name="author"]', 'meta[property="article:author"]']),
    publishedAt,
    paywalled,
  };
};
try { parentPort.postMessage({ ok: true, value: parse(workerData) }); } catch { parentPort.postMessage({ ok: false }); }
`;

const parseDocumentInWorker: ParseDocument = ({ html, resolvedUrl, signal }) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(parserWorkerSource, { eval: true, workerData: { html, resolvedUrl } });
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", abortWorker);
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const abortWorker = () => {
      void worker.terminate();
      settle(() => reject(signal.reason ?? new Error("Article parsing cancelled")));
    };

    if (signal.aborted) {
      abortWorker();
      return;
    }

    signal.addEventListener("abort", abortWorker, { once: true });
    worker.once("message", (message: unknown) => {
      const result = message as { ok?: unknown; value?: ParsedDocument };
      settle(() => resolve(result.ok === true ? (result.value ?? null) : null));
      void worker.terminate();
    });
    worker.once("error", () => settle(() => resolve(null)));
    worker.once("exit", () => settle(() => resolve(null)));
  });

const partialResult = (
  article: Article,
  fallbackEvidence: readonly EvidenceFragment[],
) =>
  ok({
    article,
    evidence: fallbackEvidence,
    extractionStatus: "partial" as const,
  });

const extractFromParsedDocument = (input: {
  readonly parsed: ParsedDocument | null;
  readonly article: Article;
  readonly resolvedUrl: string;
  readonly fallbackEvidence: readonly EvidenceFragment[];
}): Result<
  ArticleExtractionResult,
  PortError
> => {
  const text = asNonEmptyText(input.parsed?.text);
  if (input.parsed === null || input.parsed.paywalled || text === undefined || text.length < minimumEditorialTextLength) {
    return partialResult(input.article, input.fallbackEvidence);
  }

  const updatedArticle = createArticle({
    id: input.article.id,
    sourceId: input.article.sourceId,
    url: input.article.url,
    title: asNonEmptyText(input.parsed.title) ?? input.article.title,
    author: asNonEmptyText(input.parsed.author) ?? input.article.author,
    language: input.article.language,
    publishedAt: normalizedIsoDate(input.parsed.publishedAt) ?? input.article.publishedAt,
  });
  if (!updatedArticle.ok) return partialResult(input.article, input.fallbackEvidence);

  const evidence = createRuntimeEvidenceFragment({
    id: deterministicUuid(`${input.article.id}:extracted_body:${input.resolvedUrl}`),
    text,
    provenance: { articleId: updatedArticle.value.id, sourceId: updatedArticle.value.sourceId, url: updatedArticle.value.url, contentKind: "extracted_body" },
    quality: { contentLevel: "complete" },
  });
  return evidence.ok
    ? ok({ article: updatedArticle.value, evidence: [evidence.value], extractionStatus: "full_text" })
    : partialResult(input.article, input.fallbackEvidence);
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

const preservesFallback = (error: PortError): boolean =>
  !(error instanceof PortCancelledError);

export const createArticleExtractorAdapter = ({
  externalServicePolicy,
  resolveHostname,
  requestUrl,
  parseDocument = parseDocumentInWorker,
}: ArticleExtractorAdapterOptions = {}): ArticleExtractorPort => {
  const policy = { ...operationDefaults, ...externalServicePolicy };

  return {
    extractArticle: async ({ article, fallbackEvidence, options }) => {
      const startedAt = Date.now();
      const timeoutMs = options?.timeoutMs ?? policy.timeoutMs;
      const fetched = await fetchArticle({
        articleUrl: article.url,
        options,
        policy,
        resolveHostname,
        requestUrl,
      });

      if (!fetched.ok) {
        return preservesFallback(fetched.error)
          ? partialResult(article, fallbackEvidence)
          : fetched;
      }

      if ([401, 402, 403].includes(fetched.value.statusCode)) {
        return partialResult(article, fallbackEvidence);
      }

      const remainingTimeoutMs = timeoutMs - (Date.now() - startedAt);

      if (remainingTimeoutMs <= 0) {
        return partialResult(article, fallbackEvidence);
      }

      const parsed = await executeExternalOperation({
        ...policy,
        timeoutMs: remainingTimeoutMs,
        operationName: extractOperationName,
        idempotent: true,
        signal: options?.signal ?? new AbortController().signal,
        run: ({ signal }) =>
          parseDocument({
            signal,
            resolvedUrl: fetched.value.url,
            html: new TextDecoder("utf-8", { fatal: false }).decode(
              fetched.value.body,
            ),
          }),
      });

      if (!parsed.ok) {
        const error = mapExternalServiceError(parsed.error);

        return preservesFallback(error)
          ? partialResult(article, fallbackEvidence)
          : err(error);
      }

      return extractFromParsedDocument({
        parsed: parsed.value,
        article,
        resolvedUrl: fetched.value.url,
        fallbackEvidence,
      });
    },
  };
};
