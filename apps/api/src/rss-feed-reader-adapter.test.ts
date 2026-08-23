import { readFile } from "node:fs/promises";

import {
  ExternalPortError,
  PortCancelledError,
  PortLimitExceededError,
  isErr,
  isOk,
  type ArticleUrl,
  type CountryCode,
  type IsoDateTimeString,
  type LanguageCode,
  type NewsSource,
  type UUID,
} from "app-domain";
import { describe, expect, it, vi } from "vitest";

import { createRssFeedReaderAdapter } from "./rss-feed-reader-adapter.js";

const sourceId = "11111111-1111-4111-8111-111111111111" as UUID;
const reviewedAt = "2026-08-20T00:00:00.000Z" as IsoDateTimeString;
const source: NewsSource = {
  id: sourceId,
  name: "Medio Sintetico",
  orientation: "sin_clasificar",
  type: "media",
  region: "argentina",
  country: "AR" as CountryCode,
  language: "es-ar" as LanguageCode,
  active: true,
  approvalStatus: "approved",
  reviewedAt,
};

const feedUrl = "https://feeds.example.com/politica.xml" as ArticleUrl;

const readFixture = (fileName: string) =>
  readFile(new URL(`./fixtures/rss/${fileName}`, import.meta.url), "utf8");

const encode = (body: string): Uint8Array => new TextEncoder().encode(body);

const createAdapter = (input: {
  body?: string | undefined;
  statusCode?: number | undefined;
  headers?: Record<string, string> | undefined;
  requestUrl?: Parameters<typeof createRssFeedReaderAdapter>[0]["requestUrl"];
  timeoutMs?: number | undefined;
}) =>
  createRssFeedReaderAdapter({
    externalServicePolicy: {
      timeoutMs: input.timeoutMs ?? 1000,
      maxAttempts: 1,
      retryDelayMs: 0,
    },
    resolveHostname: async () => ["93.184.216.34"],
    requestUrl:
      input.requestUrl ??
      (async () => ({
        statusCode: input.statusCode ?? 200,
        headers: input.headers ?? {},
        body: encode(input.body ?? ""),
      })),
  });

describe("RSS feed reader adapter", () => {
  it("reads RSS items as articles with rss_summary evidence", async () => {
    const adapter = createAdapter({ body: await readFixture("medio-rss.xml") });

    const result = await adapter.readFeed({
      source,
      feedUrl,
      options: { maxItems: 10, maxBytes: 20_000, maxRedirects: 1 },
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.sourceId).toBe(sourceId);
      expect(result.value.feedUrl).toBe(feedUrl);
      expect(result.value.articles).toHaveLength(2);
      expect(result.value.articles[0]).toMatchObject({
        sourceId,
        url: "https://example.com/politica/reforma-presupuestaria",
        title: "Congreso debate una reforma presupuestaria",
        language: "es-ar",
        publishedAt: "2026-08-20T13:30:00.000Z",
      });
      expect(result.value.evidence[0]).toMatchObject({
        text: "Legisladores presentaron posiciones distintas durante la sesion.",
        provenance: {
          articleId: result.value.articles[0]?.id,
          sourceId,
          url: "https://example.com/politica/reforma-presupuestaria",
          contentKind: "rss_summary",
        },
        quality: { contentLevel: "partial" },
      });
    }
  });

  it("reads Atom entries with alternate links and summary/content text", async () => {
    const adapter = createAdapter({ body: await readFixture("medio-atom.xml") });

    const result = await adapter.readFeed({
      source,
      feedUrl,
      options: { maxItems: 10, maxBytes: 20_000, maxRedirects: 1 },
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.articles).toHaveLength(2);
      expect(result.value.articles[0]).toMatchObject({
        sourceId,
        url: "https://atom.example.org/noticias/mesa-regional",
        title: "Autoridades anuncian una mesa regional",
        language: "es-ar",
        publishedAt: "2026-08-21T09:15:00.000Z",
      });
      expect(result.value.evidence[1]).toMatchObject({
        text: "La convocatoria se realizara durante la proxima semana.",
        provenance: {
          articleId: result.value.articles[1]?.id,
          sourceId,
          url: "https://atom.example.org/noticias/comision",
          contentKind: "rss_summary",
        },
      });
    }
  });

  it("omits invalid entries and applies maxItems after filtering valid entries", async () => {
    const adapter = createAdapter({
      body: await readFixture("medio-rss-mixto.xml"),
    });

    const result = await adapter.readFeed({
      source,
      feedUrl,
      options: { maxItems: 1, maxBytes: 20_000, maxRedirects: 1 },
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.articles).toHaveLength(1);
      expect(result.value.evidence).toHaveLength(1);
      expect(result.value.articles[0]).toMatchObject({
        title: "Entrada valida sin fecha confiable",
        url: "https://example.com/valida-sin-fecha",
      });
      expect(result.value.articles[0]?.publishedAt).toBeUndefined();
    }
  });

  it.each([0, -1])(
    "returns an empty successful result when maxItems is %s",
    async (maxItems) => {
      const adapter = createAdapter({ body: await readFixture("medio-rss.xml") });

      const result = await adapter.readFeed({
        source,
        feedUrl,
        options: { maxItems, maxBytes: 20_000, maxRedirects: 1 },
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.articles).toEqual([]);
        expect(result.value.evidence).toEqual([]);
      }
    },
  );

  it("returns a permanent parse error for invalid XML without leaking the XML body", async () => {
    const leakedBody = "<rss><channel><item><title>xml-body-secret</title>";
    const adapter = createAdapter({ body: leakedBody });

    const result = await adapter.readFeed({
      source,
      feedUrl,
      options: { maxBytes: 20_000, maxRedirects: 1 },
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ExternalPortError);
      expect(result.error).toMatchObject({
        operationName: "rss.feed.parse",
        category: "PermanentFailure",
      });
      expect(JSON.stringify(result.error)).not.toContain("xml-body-secret");
    }
  });

  it("normalizes timeouts and caller cancellation to the port contract", async () => {
    vi.useFakeTimers();
    try {
      const timeoutAdapter = createAdapter({
        timeoutMs: 1,
        requestUrl: async () => new Promise(() => undefined),
      });
      const timedOut = timeoutAdapter.readFeed({
        source,
        feedUrl,
        options: { maxBytes: 20_000, maxRedirects: 1 },
      });

      await vi.advanceTimersByTimeAsync(2);
      const timeoutResult = await timedOut;

      expect(isErr(timeoutResult)).toBe(true);
      if (isErr(timeoutResult)) {
        expect(timeoutResult.error).toBeInstanceOf(PortLimitExceededError);
        expect(timeoutResult.error).toMatchObject({
          operationName: "rss.feed.read",
          limitName: "timeoutMs",
        });
      }

      const abortController = new AbortController();
      const cancelledAdapter = createAdapter({ body: "" });
      abortController.abort();
      const cancelled = await cancelledAdapter.readFeed({
        source,
        feedUrl,
        options: {
          signal: abortController.signal,
          maxBytes: 20_000,
          maxRedirects: 1,
        },
      });

      expect(isErr(cancelled)).toBe(true);
      if (isErr(cancelled)) {
        expect(cancelled.error).toBeInstanceOf(PortCancelledError);
        expect(cancelled.error).toMatchObject({
          operationName: "rss.feed.read",
        });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps response size and redirect policy failures to port limit errors", async () => {
    const tooLarge = await createAdapter({ body: "demasiado grande" }).readFeed({
      source,
      feedUrl,
      options: { maxBytes: 4, maxRedirects: 1 },
    });

    expect(isErr(tooLarge)).toBe(true);
    if (isErr(tooLarge)) {
      expect(tooLarge.error).toBeInstanceOf(PortLimitExceededError);
      expect(tooLarge.error).toMatchObject({
        operationName: "rss.feed.read",
        limitName: "maxBytes",
      });
    }

    const redirected = await createAdapter({
      statusCode: 302,
      headers: { location: "/siguiente.xml" },
    }).readFeed({
      source,
      feedUrl,
      options: { maxBytes: 20_000, maxRedirects: 0 },
    });

    expect(isErr(redirected)).toBe(true);
    if (isErr(redirected)) {
      expect(redirected.error).toBeInstanceOf(PortLimitExceededError);
      expect(redirected.error).toMatchObject({
        operationName: "rss.feed.read",
        limitName: "maxRedirects",
      });
    }
  });
});