import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { EventEmitter } from "node:events";
import { request as httpRequest } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConfigurationError,
  createApp,
  createHealthResponse,
  createRequestAbortSignal,
  loadApiConfig,
  resolveApiHost,
  resolveApiPort,
  startApp,
} from "./app.js";
import { createSession, sessionLifetimeSeconds } from "./authentication.js";

const temporaryDirectories: string[] = [];
const validPasswordHash =
  "$argon2id$v=19$m=32,t=2,p=2$MDEyMzQ1Njc4OWFiY2RlZg==$DFYj7N4xFFUiI8oxwK/k/skRZiCNIGR5xOGTpdhlPKs=";
const validSessionSecret = "0123456789abcdef0123456789abcdef";

const createStaticRoot = async () => {
  const staticRoot = await mkdtemp(join(tmpdir(), "neutralnews-static-"));
  temporaryDirectories.push(staticRoot);
  await writeFile(
    join(staticRoot, "index.html"),
    "<!doctype html><title>NeutralNews</title><main>SPA shell</main>",
  );
  await mkdir(join(staticRoot, "assets"));
  await writeFile(join(staticRoot, "assets", "app.js"), "console.log('asset');");

  return staticRoot;
};

const createDataDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "neutralnews-data-"));
  temporaryDirectories.push(directory);

  return directory;
};

const createValidEnvironment = async (
  overrides: NodeJS.ProcessEnv = {},
): Promise<NodeJS.ProcessEnv> => ({
  NEUTRALNEWS_ACCESS_PASSWORD_HASH: validPasswordHash,
  NEUTRALNEWS_SESSION_SECRET: validSessionSecret,
  NEUTRALNEWS_DATA_DIR: await createDataDirectory(),
  ...overrides,
});

const fetchFromApp = async (
  staticRoot: string,
  path: string,
  environment?: NodeJS.ProcessEnv,
  init?: RequestInit,
): Promise<Response> => {
  const server = createApp({
    staticRoot,
    config:
      environment === undefined ? undefined : loadApiConfig(environment),
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;

  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
};

const createSessionHeader = (secret = validSessionSecret, now = new Date()) => ({
  cookie: `neutralnews_session=${createSession({ secret, now })}`,
});

afterEach(async () => {
  vi.restoreAllMocks();

  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("api app", () => {
  it("builds a health response from the domain layer", async () => {
    const response = await createHealthResponse();

    expect(response).toEqual({
      app: "neutral-news",
      domain: "ready",
      aiProvider: "not_configured",
    });
  });

  it("uses API_PORT when it is configured", () => {
    expect(resolveApiPort({ API_PORT: "4000" })).toBe(4000);
  });

  it("falls back to PORT when API_PORT is not configured", () => {
    expect(resolveApiPort({ PORT: "3001" })).toBe(3001);
  });

  it("uses 3000 when no port is configured", () => {
    expect(resolveApiPort({})).toBe(3000);
  });

  it("gives API_PORT priority over PORT", () => {
    expect(resolveApiPort({ API_PORT: "4000", PORT: "3001" })).toBe(4000);
  });

  it("listens on loopback by default", () => {
    expect(resolveApiHost({})).toBe("127.0.0.1");
  });

  it("uses API_HOST only when it is explicitly configured", () => {
    expect(resolveApiHost({ API_HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });

  it("starts the server with the resolved host and port", async () => {
    const listen = vi.fn();
    const server = { listen };
    const createServer = vi.fn(() => server);

    startApp({
      createServer,
      environment: await createValidEnvironment({
        API_HOST: "0.0.0.0",
        API_PORT: "4100",
        NEUTRALNEWS_ALLOWED_ORIGINS: "http://127.0.0.1:4100",
      }),
    });

    expect(listen).toHaveBeenCalledWith(4100, "0.0.0.0", expect.any(Function));
  });

  it("fails before listening when configuration is invalid", () => {
    const listen = vi.fn();
    const server = { listen };
    const createServer = vi.fn(() => server);

    expect(() =>
      startApp({
        createServer,
        environment: {},
      }),
    ).toThrow(ConfigurationError);
    expect(listen).not.toHaveBeenCalled();
  });

  it("serves health from the root API route", async () => {
    const staticRoot = await createStaticRoot();
    const response = await fetchFromApp(staticRoot, "/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      app: "neutral-news",
      domain: "ready",
      aiProvider: "not_configured",
    });
  });

  it("serves health from the same-origin API prefix", async () => {
    const staticRoot = await createStaticRoot();
    const response = await fetchFromApp(staticRoot, "/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      app: "neutral-news",
      domain: "ready",
      aiProvider: "not_configured",
    });
  });

  it("does not expose runtime secrets in health responses", async () => {
    const staticRoot = await createStaticRoot();
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(staticRoot, "/api/health", environment);
    const body = await response.text();

    expect(body).not.toContain(environment.NEUTRALNEWS_ACCESS_PASSWORD_HASH);
    expect(body).not.toContain(environment.NEUTRALNEWS_SESSION_SECRET);
    expect(body).not.toContain("NEUTRALNEWS_DATA_DIR");
  });

  it("rejects frontend routes without a valid session", async () => {
    const staticRoot = await createStaticRoot();
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(staticRoot, "/", environment);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("serves the frontend index at the root route with a valid session", async () => {
    const staticRoot = await createStaticRoot();
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(staticRoot, "/", environment, {
      headers: createSessionHeader(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("SPA shell");
  });

  it("serves static frontend assets with a valid session", async () => {
    const staticRoot = await createStaticRoot();
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(staticRoot, "/assets/app.js", environment, {
      headers: createSessionHeader(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(await response.text()).toBe("console.log('asset');");
  });

  it("falls back to the frontend index for SPA reload routes with a valid session", async () => {
    const staticRoot = await createStaticRoot();
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(
      staticRoot,
      "/tema/argentina",
      environment,
      { headers: createSessionHeader() },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("SPA shell");
  });

  it("rejects configuration requests without a valid session", async () => {
    const staticRoot = await createStaticRoot();
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(
      staticRoot,
      "/api/configuration/news-sources",
      environment,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("serves configuration requests with a valid session", async () => {
    const staticRoot = await createStaticRoot();
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(
      staticRoot,
      "/api/configuration/news-sources",
      environment,
      { headers: createSessionHeader() },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });


  it("rejects AI configuration requests without a valid session", async () => {
    const staticRoot = await createStaticRoot();
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(
      staticRoot,
      "/api/configuration/ai",
      environment,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects authenticated AI configuration mutations without an origin", async () => {
    const staticRoot = await createStaticRoot();
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(
      staticRoot,
      "/api/configuration/ai/active-selection",
      environment,
      {
        method: "PUT",
        headers: {
          ...createSessionHeader(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          providerId: "openai",
          modelId: "gpt-5.6-sol",
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });
  it("invalidates dependent feed cache after real AI model selection changes", async () => {
    const staticRoot = await createStaticRoot();
    const environment = await createValidEnvironment();
    const dataDirectory = environment.NEUTRALNEWS_DATA_DIR!;
    await mkdir(join(dataDirectory, "configuration"), { recursive: true });
    await writeFile(
      join(dataDirectory, "configuration", "ai-providers.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        configurationVersion: 1,
        activeSelection: { providerId: "openai", modelId: "gpt-5.6-terra" },
        credentialReferences: [],
        providerOverrides: [],
        modelOverrides: [],
        modelSynchronizations: [
          {
            providerId: "openai",
            syncedAt: "2026-08-22T00:00:00.000Z",
            remoteModels: [{ id: "gpt-5.6-terra" }, { id: "gpt-5.6-sol" }],
          },
        ],
      })}\n`,
    );

    const response = await fetchFromApp(
      staticRoot,
      "/api/configuration/ai/active-selection",
      environment,
      {
        method: "PUT",
        headers: {
          ...createSessionHeader(),
          origin: "http://127.0.0.1:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          providerId: "openai",
          modelId: "gpt-5.6-sol",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(
      JSON.parse(
        await readFile(
          join(dataDirectory, "cache", "feed-invalidation.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      schemaVersion: 1,
      version: 1,
      invalidatedAt: expect.any(String),
    });
  });
  it("returns an error when real AI feed invalidation cannot be persisted", async () => {
    const staticRoot = await createStaticRoot();
    const environment = await createValidEnvironment();
    const dataDirectory = environment.NEUTRALNEWS_DATA_DIR!;
    await mkdir(join(dataDirectory, "configuration"), { recursive: true });
    await writeFile(
      join(dataDirectory, "configuration", "ai-providers.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        configurationVersion: 1,
        activeSelection: { providerId: "openai", modelId: "gpt-5.6-terra" },
        credentialReferences: [],
        providerOverrides: [],
        modelOverrides: [],
        modelSynchronizations: [
          {
            providerId: "openai",
            syncedAt: "2026-08-22T00:00:00.000Z",
            remoteModels: [{ id: "gpt-5.6-terra" }, { id: "gpt-5.6-sol" }],
          },
        ],
      })}\n`,
    );
    await writeFile(join(dataDirectory, "cache"), "not a directory");

    const response = await fetchFromApp(
      staticRoot,
      "/api/configuration/ai/active-selection",
      environment,
      {
        method: "PUT",
        headers: {
          ...createSessionHeader(),
          origin: "http://127.0.0.1:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          providerId: "openai",
          modelId: "gpt-5.6-sol",
        }),
      },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "InternalServerError" });
    expect(
      JSON.parse(
        await readFile(
          join(dataDirectory, "configuration", "ai-providers.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      configurationVersion: 1,
      activeSelection: { providerId: "openai", modelId: "gpt-5.6-terra" },
    });
  });
  it("rejects authenticated mutations without an origin", async () => {
    const staticRoot = await createStaticRoot();
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(
      staticRoot,
      "/api/configuration/regional-preferences",
      environment,
      {
        method: "PUT",
        headers: {
          ...createSessionHeader(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          timeZone: { mode: "automatic" },
          feedDistribution: {
            argentina: 3,
            latin_america: 2,
            international: 1,
          },
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("rejects requests with tampered sessions", async () => {
    const staticRoot = await createStaticRoot();
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(
      staticRoot,
      "/api/configuration/news-sources",
      environment,
      { headers: { cookie: `${createSessionHeader().cookie}x` } },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects sessions when the seven day lifetime has elapsed", async () => {
    const staticRoot = await createStaticRoot();
    const environment = await createValidEnvironment();
    const issuedAt = new Date(Date.now() - sessionLifetimeSeconds * 1_000);
    const response = await fetchFromApp(
      staticRoot,
      "/api/configuration/news-sources",
      environment,
      { headers: createSessionHeader(validSessionSecret, issuedAt) },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns JSON not found responses for unknown API routes with a valid session", async () => {
    const staticRoot = await createStaticRoot();
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(staticRoot, "/api/desconocida", environment, {
      headers: createSessionHeader(),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "NotFound" });
  });

  it("aborts a request signal when the HTTP client aborts the connection", () => {
    const request = new EventTarget();
    const signal = createRequestAbortSignal(request);

    request.dispatchEvent(new Event("abort"));

    expect(signal.aborted).toBe(true);
  });

  it("does not abort a request signal when the request stream closes normally", () => {
    const request = new EventTarget();
    const signal = createRequestAbortSignal(request);

    request.dispatchEvent(new Event("close"));

    expect(signal.aborted).toBe(false);
  });

  it("aborts a request signal when the response connection closes before ending", () => {
    const request = new EventEmitter();
    const response = Object.assign(new EventEmitter(), { writableEnded: false });
    const signal = createRequestAbortSignal(request, response);

    response.emit("close");

    expect(signal.aborted).toBe(true);
  });

  it("does not abort a request signal when the response closes after ending", () => {
    const request = new EventEmitter();
    const response = Object.assign(new EventEmitter(), { writableEnded: true });
    const signal = createRequestAbortSignal(request, response);

    response.emit("close");

    expect(signal.aborted).toBe(false);
  });

  it("propagates HTTP client disconnects to request external operations", async () => {
    let resolveOperationStarted = () => undefined;
    const operationStarted = new Promise<void>((resolve) => {
      resolveOperationStarted = resolve;
    });
    let observedOperationSignal: AbortSignal | undefined;
    let observedCategory: string | undefined;
    const server = createApp({
      config: loadApiConfig(await createValidEnvironment()),
      healthResponseFactory: async ({ executeExternalOperation }) => {
        const result = await executeExternalOperation({
          operationName: "rss-feed",
          idempotent: true,
          run: ({ signal }) => {
            observedOperationSignal = signal;
            resolveOperationStarted();

            return new Promise<string>(() => undefined);
          },
        });

        observedCategory = result.ok ? "Ok" : result.error.category;

        return {
          app: "neutral-news",
          domain: result.ok ? "ready" : "error",
          aiProvider: "not_configured",
        };
      },
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address() as AddressInfo;
    const clientRequest = httpRequest({
      hostname: "127.0.0.1",
      port: address.port,
      path: "/api/health",
      method: "GET",
    });
    clientRequest.on("error", () => undefined);

    try {
      clientRequest.end();
      await operationStarted;
      clientRequest.destroy();

      await new Promise<void>((resolve) => {
        const check = () => {
          if (observedCategory !== undefined) {
            resolve();
            return;
          }

          setTimeout(check, 0);
        };

        check();
      });

      expect(observedOperationSignal?.aborted).toBe(true);
      expect(observedCategory).toBe("Cancelled");
    } finally {
      clientRequest.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  });

  it("rejects encoded path traversal attempts with a valid session", async () => {
    const staticRoot = await createStaticRoot();
    const environment = await createValidEnvironment();
    const response = await fetchFromApp(
      staticRoot,
      "/%2e%2e/package.json",
      environment,
      { headers: createSessionHeader() },
    );

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("\"neutralnews\"");
  });

  it("defines a root start command that builds before starting the API", async () => {
    const packageJsonPath = fileURLToPath(
      new URL("../../../package.json", import.meta.url),
    );
    const packageJson = JSON.parse(
      await readFile(packageJsonPath, "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.start).toBe(
      "yarn build && yarn workspace api start",
    );
  });
});
