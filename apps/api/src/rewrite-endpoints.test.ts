import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AiCredentialUnavailableError,
  AiProviderRejectedError,
  ExternalPortError,
  PortLimitExceededError,
  createFakeAiGenerationPort,
  createRewriteResult,
  err,
  initialAiProviderCatalogSnapshot,
  ok,
  type EffectiveAiProviderConfiguration,
  type Result,
  type RewriteResult,
  type TaggedError,
} from "app-domain";

import { createApp, loadApiConfig } from "./app.js";
import { createSession } from "./authentication.js";
import { createRewriteAnalyzer } from "./rewrite-analyzer.js";
import type { RewriteRequestOptions } from "./rewrite-endpoints.js";

const temporaryDirectories: string[] = [];
const validPasswordHash =
  "$argon2id$v=19$m=32,t=2,p=2$MDEyMzQ1Njc4OWFiY2RlZg==$DFYj7N4xFFUiI8oxwK/k/skRZiCNIGR5xOGTpdhlPKs=";
const validSessionSecret = "0123456789abcdef0123456789abcdef";
const rewrite = createRewriteResult({
  neutralText: "El bloque presentó el proyecto.",
  changes: [{
    id: "7cc5149b-a95f-470c-a880-8d93d10e3443",
    type: "evaluative_language",
    originalText: "el polémico proyecto",
    neutralText: "el proyecto",
    justification: "Se eliminó un calificativo valorativo.",
  }],
  warnings: [],
});

if (!rewrite.ok) {
  throw rewrite.error;
}

const aiConfiguration: EffectiveAiProviderConfiguration = {
  schemaVersion: 1,
  configurationVersion: 1,
  providers: initialAiProviderCatalogSnapshot.providers,
  models: initialAiProviderCatalogSnapshot.models,
  activeSelection: { providerId: "openai", modelId: "gpt-5.6-terra" },
  credentialReferences: [],
  providerOverrides: [],
  modelOverrides: [],
  modelSynchronizations: [],
};

interface RewriteRequestTestOptions {
  rewriteRequestOptions: RewriteRequestOptions;
}

const createEnvironment = async (): Promise<NodeJS.ProcessEnv> => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "neutralnews-rewrite-"));
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

const requestRewrite = async (
  environment: NodeJS.ProcessEnv,
  body: unknown,
  options: RewriteRequestTestOptions | undefined = undefined,
): Promise<Response> => {
  const server = createApp({
    config: loadApiConfig(environment),
    ...options,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  try {
    return await fetch(`http://127.0.0.1:${address.port}/api/rewrite`, {
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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("rewrite endpoint", () => {
  it("rejects empty text before starting a rewrite", async () => {
    const response = await requestRewrite(await createEnvironment(), { text: "   " });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "InvalidRewriteText" },
    });
  });

  it("rejects text larger than the endpoint limit before starting a rewrite", async () => {
    const calls: { text: string; signal: AbortSignal }[] = [];
    const response = await requestRewrite(
      await createEnvironment(),
      { text: "a".repeat(16 * 1024 + 1) },
      {
        rewriteRequestOptions: {
          rewrite: async (input) => {
            calls.push(input);
            return ok(rewrite.value);
          },
        },
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "InvalidRewriteText" },
    });
    expect(calls).toEqual([]);
  });

  it("returns a validation error when escaped text exceeds the prompt byte limit", async () => {
    const aiProvider = createFakeAiGenerationPort({ output: {} });
    const analyzer = createRewriteAnalyzer({
      aiProvider,
      configurationRepository: {
        getEffectiveConfiguration: async () => ok(aiConfiguration),
      },
    });
    const response = await requestRewrite(
      await createEnvironment(),
      { text: '"'.repeat(16 * 1024) },
      {
        rewriteRequestOptions: {
          rewrite: async ({ text, signal }) => analyzer.rewrite({ text, options: { signal } }),
        },
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "InvalidRewriteText" },
    });
    expect(aiProvider.calls.generateStructuredResponse).toEqual([]);
  });

  it("returns a valid rewrite result for accepted text", async () => {
    const calls: { text: string; signal: AbortSignal }[] = [];
    const response = await requestRewrite(
      await createEnvironment(),
      { text: " El bloque presentó el polémico proyecto. " },
      {
        rewriteRequestOptions: {
          rewrite: async (input) => {
            calls.push(input);
            return ok(rewrite.value);
          },
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(rewrite.value);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe("El bloque presentó el polémico proyecto.");
  });

  it.each([
    new PortLimitExceededError("openai.responses.create", "timeoutMs"),
    new ExternalPortError("openai.responses.create", "Timeout"),
  ])("returns a structured timeout for %s", async (failure) => {
    const response = await requestRewrite(
      await createEnvironment(),
      { text: "El bloque presentó el proyecto." },
      {
        rewriteRequestOptions: {
          rewrite: async (): Promise<Result<RewriteResult, TaggedError>> => err(failure),
        },
      },
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: { code: "RewriteTimeout" } });
  });

  it.each([
    new ExternalPortError("openai.responses.create", "PermanentFailure"),
    new AiProviderRejectedError("openai", "openai.responses.create", 401),
    new AiCredentialUnavailableError("openai", "api_key"),
    new PortLimitExceededError("openai.responses.create", "maxItems"),
  ])("returns a sanitized provider error for %s", async (failure) => {
    const pastedText = "texto privado que no debe aparecer en el error";
    const response = await requestRewrite(
      await createEnvironment(),
      { text: pastedText },
      {
        rewriteRequestOptions: {
          rewrite: async (): Promise<Result<RewriteResult, TaggedError>> => err(failure),
        },
      },
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { code: "RewriteProviderError" },
    });
  });

  it("does not allow an unauthenticated request to start a rewrite", async () => {
    const environment = await createEnvironment();
    const server = createApp({ config: loadApiConfig(environment) });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/rewrite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "El bloque presentó el proyecto." }),
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
    }
  });

  it("requires an allowed origin before starting a rewrite", async () => {
    const environment = await createEnvironment();
    const server = createApp({ config: loadApiConfig(environment) });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/rewrite`, {
        method: "POST",
        headers: {
          cookie: `neutralnews_session=${createSession({ secret: validSessionSecret })}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: "El bloque presentó el proyecto." }),
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Forbidden" });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
    }
  });

  it("does not log pasted text", async () => {
    const pastedText = "texto privado que no debe registrarse";
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await requestRewrite(
        await createEnvironment(),
        { text: pastedText },
        {
          rewriteRequestOptions: {
            rewrite: async () => ok(rewrite.value),
          },
        },
      );

      expect(response.status).toBe(200);
      const consoleOutput = [...log.mock.calls, ...warn.mock.calls, ...error.mock.calls]
        .flat()
        .map((value) => typeof value === "string" ? value : JSON.stringify(value))
        .join("\n");

      expect(consoleOutput).not.toContain(pastedText);
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
