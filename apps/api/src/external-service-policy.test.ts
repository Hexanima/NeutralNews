import { describe, expect, it, vi } from "vitest";

import {
  executeExternalOperation,
  normalizeExternalServiceError,
} from "./external-service-policy.js";

describe("external service policy", () => {
  it("aborts an external operation when its configurable timeout expires", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    let operationSignal: AbortSignal | undefined;

    try {
      const resultPromise = executeExternalOperation({
        operationName: "rss-feed",
        idempotent: true,
        timeoutMs: 50,
        maxAttempts: 3,
        retryDelayMs: 0,
        signal: new AbortController().signal,
        run: ({ signal }) => {
          attempts += 1;
          operationSignal = signal;

          return new Promise<string>(() => undefined);
        },
      });

      await vi.advanceTimersByTimeAsync(51);
      const result = await resultPromise;

      expect(result.ok).toBe(false);
      expect(attempts).toBe(1);
      expect(operationSignal?.aborted).toBe(true);

      if (!result.ok) {
        expect(result.error.category).toBe("Timeout");
        expect(result.error.retryable).toBe(false);
        expect(JSON.stringify(result.error)).not.toContain("rss-body");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops pending retry work when the caller cancels the operation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let attempts = 0;

    try {
      const resultPromise = executeExternalOperation({
        operationName: "article-extraction",
        idempotent: true,
        timeoutMs: 10_000,
        maxAttempts: 3,
        retryDelayMs: 1_000,
        signal: controller.signal,
        run: async () => {
          attempts += 1;
          throw { transient: true };
        },
      });

      await Promise.resolve();
      controller.abort();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
      expect(attempts).toBe(1);

      if (!result.ok) {
        expect(result.error.category).toBe("Cancelled");
        expect(result.error.retryable).toBe(false);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries transient errors for idempotent operations up to the configured limit", async () => {
    let attempts = 0;

    const result = await executeExternalOperation({
      operationName: "rss-feed",
      idempotent: true,
      timeoutMs: 10_000,
      maxAttempts: 3,
      retryDelayMs: 0,
      signal: new AbortController().signal,
      run: async () => {
        attempts += 1;

        if (attempts < 3) {
          throw { transient: true };
        }

        return "feed";
      },
    });

    expect(result).toEqual({ ok: true, value: "feed" });
    expect(attempts).toBe(3);
  });

  it("does not retry transient errors for non-idempotent operations", async () => {
    let attempts = 0;

    const result = await executeExternalOperation({
      operationName: "openai-response",
      idempotent: false,
      timeoutMs: 10_000,
      maxAttempts: 3,
      retryDelayMs: 0,
      signal: new AbortController().signal,
      run: async () => {
        attempts += 1;
        throw { transient: true };
      },
    });

    expect(result.ok).toBe(false);
    expect(attempts).toBe(1);

    if (!result.ok) {
      expect(result.error.category).toBe("TransientFailure");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("does not retry permanent HTTP client errors", async () => {
    let attempts = 0;

    const result = await executeExternalOperation({
      operationName: "article-download",
      idempotent: true,
      timeoutMs: 10_000,
      maxAttempts: 3,
      retryDelayMs: 0,
      signal: new AbortController().signal,
      run: async () => {
        attempts += 1;
        throw { statusCode: 404 };
      },
    });

    expect(result.ok).toBe(false);
    expect(attempts).toBe(1);

    if (!result.ok) {
      expect(result.error.category).toBe("PermanentFailure");
      expect(result.error.statusCode).toBe(404);
      expect(result.error.retryable).toBe(false);
    }
  });

  it("normalizes errors without serializing keys, sensitive headers, or full article bodies", () => {
    const error = normalizeExternalServiceError({
      operationName: "article-download",
      error: {
        statusCode: 502,
        message:
          "upstream failed with sk-test-secret and Authorization bearer token",
        headers: {
          authorization: "Bearer sk-test-secret",
          "x-api-key": "sk-test-secret",
        },
        body: "article-body ".repeat(200),
        transient: true,
      },
      idempotent: true,
      sensitiveValues: ["sk-test-secret", "Bearer sk-test-secret"],
    });

    const serialized = JSON.stringify(error);

    expect(error.category).toBe("TransientFailure");
    expect(error.retryable).toBe(true);
    expect(serialized).not.toContain("sk-test-secret");
    expect(serialized).not.toContain("Authorization bearer token");
    expect(serialized).not.toContain("article-body");
    expect(serialized).not.toContain("x-api-key");
    expect(serialized).not.toContain("headers");
    expect(serialized).not.toContain("body");
  });
});
