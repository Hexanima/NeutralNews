import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AiCapabilityUnavailableError,
  AiInvalidStructuredOutputError,
  AiModelUnavailableError,
  AiProviderUnsupportedError,
  ExternalPortError,
  PortCancelledError,
  PortLimitExceededError,
  createTriangulationResult,
  defaultRegionalPreferences,
  err,
  initialNewsSourceCatalogSnapshot,
  ok,
  type Result,
  type TaggedError,
  type TriangulationResult,
} from "app-domain";

import { createApp, loadApiConfig } from "./app.js";
import { createSession } from "./authentication.js";

const temporaryDirectories: string[] = [];
const validPasswordHash =
  "$argon2id$v=19$m=32,t=2,p=2$MDEyMzQ1Njc4OWFiY2RlZg==$DFYj7N4xFFUiI8oxwK/k/skRZiCNIGR5xOGTpdhlPKs=";
const validSessionSecret = "0123456789abcdef0123456789abcdef";
const triangulation = createTriangulationResult({
  summary: "La cobertura disponible describe la reforma laboral.",
  matches: [],
  divergences: [],
  sources: [],
  warnings: [{
    kind: "insufficient_evidence",
    message: "No se encontró evidencia utilizable para realizar la triangulación.",
  }],
});

if (!triangulation.ok) {
  throw triangulation.error;
}

interface TriangulationRequestTestOptions {
  triangulationRequestOptions: {
    triangulate: (input: {
      query: string;
      signal: AbortSignal;
    }) => Promise<Result<TriangulationResult, TaggedError>>;
  };
}

const createEnvironment = async (): Promise<NodeJS.ProcessEnv> => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "neutralnews-triangulation-"));
  temporaryDirectories.push(dataDirectory);

  return {
    NEUTRALNEWS_ACCESS_PASSWORD_HASH: validPasswordHash,
    NEUTRALNEWS_SESSION_SECRET: validSessionSecret,
    NEUTRALNEWS_DATA_DIR: dataDirectory,
  };
};

const sessionHeaders = () => ({
  cookie: `neutralnews_session=${createSession({ secret: validSessionSecret })}`,
  origin: "http://127.0.0.1:3000",
  "content-type": "application/json",
});

const fetchFromApp = async (
  environment: NodeJS.ProcessEnv,
  body: unknown,
  options: TriangulationRequestTestOptions | undefined = undefined,
): Promise<Response> => {
  const server = createApp({
    config: loadApiConfig(environment),
    ...options,
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  try {
    return await fetch(`http://127.0.0.1:${address.port}/api/triangulation`, {
      method: "POST",
      headers: sessionHeaders(),
      body: JSON.stringify(body),
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    });
  }
};

const configureNoActiveSources = async (environment: NodeJS.ProcessEnv) => {
  const dataDirectory = environment.NEUTRALNEWS_DATA_DIR!;
  await mkdir(join(dataDirectory, "configuration"), { recursive: true });
  await writeFile(
    join(dataDirectory, "configuration", "news-sources.json"),
    `${JSON.stringify({
      schemaVersion: 4,
      configurationVersion: 1,
      sourceOverrides: initialNewsSourceCatalogSnapshot.sources.map(({ source }) => ({
        id: source.id,
        deleted: true,
      })),
      candidates: [],
      regionalPreferences: defaultRegionalPreferences,
    })}\n`,
  );
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("triangulation endpoint", () => {
  it("rejects an empty topic before starting triangulation", async () => {
    const response = await fetchFromApp(await createEnvironment(), { query: "   " });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "InvalidTriangulationQuery" },
    });
  });

  it("rejects a topic longer than the request limit", async () => {
    const response = await fetchFromApp(
      await createEnvironment(),
      { query: "a".repeat(501) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "InvalidTriangulationQuery" },
    });
  });

  it("returns the triangulation result for a valid topic", async () => {
    const calls: { query: string; signal: AbortSignal }[] = [];
    const response = await fetchFromApp(
      await createEnvironment(),
      { query: " reforma laboral " },
      {
        triangulationRequestOptions: {
          triangulate: async (input) => {
            calls.push(input);
            return ok(triangulation.value);
          },
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(triangulation.value);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toBe("reforma laboral");
  });

  it("uses the configured domain triangulation service by default", async () => {
    const environment = await createEnvironment();
    await configureNoActiveSources(environment);

    const response = await fetchFromApp(environment, { query: "reforma laboral" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      warnings: [{ kind: "insufficient_evidence" }],
    });
  });

  it("returns a structured timeout error", async () => {
    const response = await fetchFromApp(
      await createEnvironment(),
      { query: "reforma laboral" },
      {
        triangulationRequestOptions: {
          triangulate: async () =>
            err(new PortLimitExceededError("openai.responses.create", "timeoutMs")),
        },
      },
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      error: { code: "TriangulationTimeout" },
    });
  });

  it("returns a sanitized provider error", async () => {
    const response = await fetchFromApp(
      await createEnvironment(),
      { query: "reforma laboral" },
      {
        triangulationRequestOptions: {
          triangulate: async () =>
            err(new ExternalPortError("openai.responses.create", "PermanentFailure")),
        },
      },
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { code: "TriangulationProviderError" },
    });
  });

  it.each([
    new AiProviderUnsupportedError("unsupported"),
    new AiModelUnavailableError("openai", "unavailable-model"),
    new AiCapabilityUnavailableError("openai", "gpt-5.6-terra", "web_search"),
    new AiInvalidStructuredOutputError("openai"),
  ])("returns a provider error for %s", async (providerFailure) => {
    const response = await fetchFromApp(
      await createEnvironment(),
      { query: "reforma laboral" },
      {
        triangulationRequestOptions: {
          triangulate: async () => err(providerFailure),
        },
      },
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { code: "TriangulationProviderError" },
    });
  });

  it("does not allow an unauthenticated request to start triangulation", async () => {
    const environment = await createEnvironment();
    const server = createApp({ config: loadApiConfig(environment) });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/triangulation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "reforma laboral" }),
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
    }
  });

  it("propagates a disconnected HTTP client as a cancellation signal", async () => {
    const environment = await createEnvironment();
    let resolveStarted = () => undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let resolveCancelled = () => undefined;
    const cancelled = new Promise<void>((resolve) => {
      resolveCancelled = resolve;
    });
    const server = createApp({
      config: loadApiConfig(environment),
      triangulationRequestOptions: {
        triangulate: async ({ signal }) => new Promise((resolve) => {
          resolveStarted();
          signal.addEventListener("abort", () => {
            resolveCancelled();
            resolve(err(new PortCancelledError("triangulation")));
          }, { once: true });
        }),
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const clientRequest = httpRequest({
      hostname: "127.0.0.1",
      port: address.port,
      path: "/api/triangulation",
      method: "POST",
      headers: {
        ...sessionHeaders(),
        "content-length": Buffer.byteLength(JSON.stringify({ query: "reforma laboral" })),
      },
    });
    clientRequest.on("error", () => undefined);

    try {
      clientRequest.end(JSON.stringify({ query: "reforma laboral" }));
      await started;
      clientRequest.destroy();
      await cancelled;
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
    }
  });
});
