import { readFile } from "node:fs/promises";

import {
  createArticle,
  createRuntimeEvidenceFragment,
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
  parseDocument?: (() => Promise<never>) | undefined;
}) =>
  createArticleExtractorAdapter({
    ...(input.parseDocument === undefined
      ? {}
      : { parseDocument: input.parseDocument }),
    externalServicePolicy: {
      timeoutMs: input.timeoutMs ?? 5_000,
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

    expect(result).toEqual({
      ok: true,
      value: { article, evidence: fallbackEvidence, extractionStatus: "partial" },
    });
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

    expect(result).toEqual({
      ok: true,
      value: { article, evidence: fallbackEvidence, extractionStatus: "partial" },
    });
  });

  it("enforces the response byte limit", async () => {
    const adapter = createAdapter({ body: "contenido demasiado grande" });

    const result = await adapter.extractArticle({
      article,
      fallbackEvidence,
      options: { maxBytes: 4, maxRedirects: 1 },
    });

    expect(result).toEqual({
      ok: true,
      value: { article, evidence: fallbackEvidence, extractionStatus: "partial" },
    });
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

      expect(result).toEqual({
        ok: true,
        value: { article, evidence: fallbackEvidence, extractionStatus: "partial" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps fallback evidence when the download fails", async () => {
    const adapter = createAdapter({
      requestUrl: async () => {
        throw new Error("network unavailable");
      },
    });

    const result = await adapter.extractArticle({
      article,
      fallbackEvidence,
      options: { maxBytes: 20_000, maxRedirects: 1 },
    });

    expect(result).toEqual({
      ok: true,
      value: { article, evidence: fallbackEvidence, extractionStatus: "partial" },
    });
  });

  it("keeps fallback evidence for a long HTTP 200 paywall", async () => {
    const paywallBody = `
      <html><head>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"NewsArticle","isAccessibleForFree":false}
        </script>
      </head><body><article><h1>Nota para suscriptores</h1>
        <p>${"Contenido de acceso restringido. ".repeat(20)}</p>
      </article></body></html>
    `;
    const adapter = createAdapter({ body: paywallBody });

    const result = await adapter.extractArticle({
      article,
      fallbackEvidence,
      options: { maxBytes: 20_000, maxRedirects: 1 },
    });

    expect(result).toEqual({
      ok: true,
      value: { article, evidence: fallbackEvidence, extractionStatus: "partial" },
    });
  });

  it("keeps fallback evidence for a subscription-required paywall", async () => {
    const body = `
      <html><body>
        <article class="subscription-required"><h1>Nota para suscriptores</h1>
          <p>${"Contenido accesible sólo para suscriptores. ".repeat(20)}</p>
        </article>
      </body></html>
    `;
    const adapter = createAdapter({ body });

    const result = await adapter.extractArticle({
      article,
      fallbackEvidence,
      options: { maxBytes: 20_000, maxRedirects: 1 },
    });

    expect(result).toEqual({
      ok: true,
      value: { article, evidence: fallbackEvidence, extractionStatus: "partial" },
    });
  });

  it("returns full text for a short valid article", async () => {
    const body = `
      <html><body><article><h1>Comunicado breve</h1>
        <p>Artículo válido de menos de doscientos caracteres.</p>
      </article></body></html>
    `;
    const adapter = createAdapter({ body });

    const result = await adapter.extractArticle({
      article,
      fallbackEvidence,
      options: { maxBytes: 20_000, maxRedirects: 1 },
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.extractionStatus).toBe("full_text");
      expect(result.value.evidence[0]).toMatchObject({
        provenance: { contentKind: "extracted_body" },
        quality: { contentLevel: "complete" },
        text: expect.stringContaining(
          "Artículo válido de menos de doscientos caracteres.",
        ),
      });
    }
  });

  it("extracts full text from an editorial div without article or main", async () => {
    const body = `
      <html><body><div class="article-body"><h1>Título en un div</h1>
        <p>Contenido editorial válido dentro de un contenedor div.</p>
      </div></body></html>
    `;
    const adapter = createAdapter({ body });

    const result = await adapter.extractArticle({
      article,
      fallbackEvidence,
      options: { maxBytes: 20_000, maxRedirects: 1 },
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.extractionStatus).toBe("full_text");
      expect(result.value.article.title).toBe("Título en un div");
      expect(result.value.evidence[0]).toMatchObject({
        provenance: { contentKind: "extracted_body" },
        quality: { contentLevel: "complete" },
        text: expect.stringContaining(
          "Contenido editorial válido dentro de un contenedor div.",
        ),
      });
    }
  });

  it("extracts the publication date from a time element", async () => {
    const body = `
      <html><body><article><h1>Nota abierta</h1>
        <time datetime="2026-08-22T15:00:00.000Z">22 de agosto</time>
        <p>${"Contenido editorial verificable. ".repeat(20)}</p>
      </article></body></html>
    `;
    const adapter = createAdapter({ body });

    const result = await adapter.extractArticle({
      article,
      fallbackEvidence,
      options: { maxBytes: 20_000, maxRedirects: 1 },
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.article.publishedAt).toBe("2026-08-22T15:00:00.000Z");
    }
  });

  it("extracts the publication date from JSON-LD", async () => {
    const body = `
      <html><head><script type="application/ld+json">
        {"@context":"https://schema.org","@type":"NewsArticle","datePublished":"2026-08-23T16:30:00.000Z"}
      </script></head><body><article><h1>Nota abierta</h1>
        <p>${"Contenido editorial verificable. ".repeat(20)}</p>
      </article></body></html>
    `;
    const adapter = createAdapter({ body });

    const result = await adapter.extractArticle({
      article,
      fallbackEvidence,
      options: { maxBytes: 20_000, maxRedirects: 1 },
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.article.publishedAt).toBe("2026-08-23T16:30:00.000Z");
    }
  });

  it("applies the timeout while parsing HTML", async () => {
    vi.useFakeTimers();
    try {
      const adapter = createAdapter({
        body: await readFixture("extractable.html"),
        timeoutMs: 1,
        parseDocument: async () => new Promise(() => undefined),
      });
      const extraction = adapter.extractArticle({
        article,
        fallbackEvidence,
        options: { maxBytes: 20_000, maxRedirects: 1 },
      });

      await vi.advanceTimersByTimeAsync(2);

      await expect(extraction).resolves.toEqual({
        ok: true,
        value: { article, evidence: fallbackEvidence, extractionStatus: "partial" },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
