import { readFile } from "node:fs/promises";

import {
  ExternalPortError,
  PortLimitExceededError,
  createArticle,
  createRuntimeEvidenceFragment,
  isErr,
  isOk,
  type Article,
  type ArticleUrl,
  type EvidenceFragment,
  type UUID,
} from "app-domain";
import { describe, expect, it, vi } from "vitest";

import { createArticleExtractorAdapter } from "./article-extractor-adapter.js";

const articleId = "22222222-2222-4222-8222-222222222222" as UUID;
const sourceId = "11111111-1111-4111-8111-111111111111" as UUID;
const articleUrl = "https://example.com/politica/reforma" as ArticleUrl;

const articleResult = createArticle({
  id: articleId,
  sourceId,
  url: articleUrl,
  title: "Título RSS de la reforma",
  language: "es-ar",
  publishedAt: "2026-08-20T12:00:00.000Z",
});

if (!isOk(articleResult)) {
  throw new Error("Invalid test article");
}

const article: Article = articleResult.value;

const fallbackResult = createRuntimeEvidenceFragment({
  id: "33333333-3333-4333-8333-333333333333",
  text: "Resumen RSS que debe mantenerse cuando no hay cuerpo utilizable.",
  provenance: {
    articleId,
    sourceId,
    url: articleUrl,
    contentKind: "rss_summary",
  },
  quality: { contentLevel: "partial" },
});

if (!isOk(fallbackResult)) {
  throw new Error("Invalid fallback evidence");
}

const fallbackEvidence: readonly EvidenceFragment[] = [fallbackResult.value];

const readFixture = (fileName: string) =>
  readFile(new URL(`./fixtures/articles/${fileName}`, import.meta.url), "utf8");

const encode = (body: string): Uint8Array => new TextEncoder().encode(body);

const createAdapter = (input: {
  body?: string | undefined;
  contentType?: string | undefined;
  requestUrl?: Parameters<typeof createArticleExtractorAdapter>[0]["requestUrl"];
  timeoutMs?: number | undefined;
  resolveHostname?: Parameters<typeof createArticleExtractorAdapter>[0]["resolveHostname"];
}) =>
  createArticleExtractorAdapter({
    externalServicePolicy: {
      timeoutMs: input.timeoutMs ?? 1_000,
      maxAttempts: 1,
      retryDelayMs: 0,
    },
    resolveHostname: input.resolveHostname ?? (async () => ["93.184.216.34"]),
    requestUrl:
      input.requestUrl ??
      (async () => ({
        statusCode: 200,
        headers: { "content-type": input.contentType ?? "text/html; charset=utf-8" },
        body: encode(input.body ?? ""),
      })),
  });

describe("article extractor adapter", () => {
  it("extracts editorial metadata and full text without scripts or navigation", async () => {
    const adapter = createAdapter({ body: await readFixture("extractable.html") });

    const result = await adapter.extractArticle({
      article,
      fallbackEvidence,
      options: { maxBytes: 20_000, maxRedirects: 1 },
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) {
      return;
    }

    expect(result.value.extractionStatus).toBe("full_text");
    expect(result.value.article).toMatchObject({
      title: "El Congreso aprobó la reforma presupuestaria",
      author: "María López",
      publishedAt: "2026-08-21T10:15:00.000Z",
    });
    expect(result.value.evidence).toHaveLength(1);
    expect(result.value.evidence[0]).toMatchObject({
      provenance: { contentKind: "extracted_body" },
      quality: { contentLevel: "complete" },
    });
    expect(result.value.evidence[0]?.text).toContain("Cámara de Diputados");
    expect(result.value.evidence[0]?.text).not.toContain("Navegación");
    expect(result.value.evidence[0]?.text).not.toContain("contenido-no-editorial");
  });

  it("keeps RSS evidence when a paywall has no extractable body", async () => {
    const adapter = createAdapter({ body: await readFixture("paywalled.html") });

    const result = await adapter.extractArticle({
      article,
      fallbackEvidence,
      options: { maxBytes: 20_000, maxRedirects: 1 },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        article,
        evidence: fallbackEvidence,
        extractionStatus: "partial",
      },
    });
  });

  it("keeps RSS evidence when the HTML is invalid", async () => {
    const adapter = createAdapter({ body: await readFixture("invalid.html") });

    const result = await adapter.extractArticle({
      article,
      fallbackEvidence,
      options: { maxBytes: 20_000, maxRedirects: 1 },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        article,
        evidence: fallbackEvidence,
        extractionStatus: "partial",
      },
    });
  });

  it("does not request a URL rejected by SSRF validation", async () => {
    const requestUrl = vi.fn();
    const adapter = createAdapter({
      requestUrl,
      resolveHostname: async () => ["127.0.0.1"],
    });

    const result = await adapter.extractArticle({
      article,
      fallbackEvidence,
      options: { maxBytes: 20_000, maxRedirects: 1 },
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toMatchObject({
        operationName: "article.extract",
        category: "PermanentFailure",
      } satisfies Partial<ExternalPortError>);
    }
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("rejects non-HTML responses before parsing", async () => {
    const adapter = createAdapter({
      body: "{ \"not\": \"html\" }",
      contentType: "application/json",
    });

    const result = await adapter.extractArticle({
      article,
      fallbackEvidence,
      options: { maxBytes: 20_000, maxRedirects: 1 },
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toMatchObject({
        operationName: "article.extract",
        category: "PermanentFailure",
      } satisfies Partial<ExternalPortError>);
    }
  });

  it("enforces the response byte limit", async () => {
    const adapter = createAdapter({ body: "contenido demasiado grande" });

    const result = await adapter.extractArticle({
      article,
      fallbackEvidence,
      options: { maxBytes: 4, maxRedirects: 1 },
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toEqual(
        new PortLimitExceededError("article.extract", "maxBytes"),
      );
    }
  });

  it("enforces the operation timeout", async () => {
    vi.useFakeTimers();
    try {
      const adapter = createAdapter({
        timeoutMs: 1,
        requestUrl: async () => new Promise(() => undefined),
      });
      const extraction = adapter.extractArticle({
        article,
        fallbackEvidence,
        options: { maxBytes: 20_000, maxRedirects: 1 },
      });

      await vi.advanceTimersByTimeAsync(2);
      const result = await extraction;

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toEqual(
          new PortLimitExceededError("article.extract", "timeoutMs"),
        );
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
