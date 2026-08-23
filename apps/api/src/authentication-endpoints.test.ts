import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { loadApiConfig } from "./config.js";
import { createSession } from "./authentication.js";

const password = "correct horse battery staple";
const passwordHash =
  "$argon2id$v=19$m=32,t=2,p=2$MDEyMzQ1Njc4OWFiY2RlZg==$DFYj7N4xFFUiI8oxwK/k/skRZiCNIGR5xOGTpdhlPKs=";
const sessionSecret = "0123456789abcdef0123456789abcdef";
const temporaryDirectories: string[] = [];

const createEnvironment = async (
  overrides: NodeJS.ProcessEnv = {},
): Promise<NodeJS.ProcessEnv> => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "neutralnews-auth-"));
  temporaryDirectories.push(dataDirectory);

  return {
    NEUTRALNEWS_ACCESS_PASSWORD_HASH: passwordHash,
    NEUTRALNEWS_SESSION_SECRET: sessionSecret,
    NEUTRALNEWS_DATA_DIR: dataDirectory,
    ...overrides,
  };
};

const fetchFromApp = async (
  path: string,
  init?: RequestInit,
  environmentOverrides?: NodeJS.ProcessEnv,
): Promise<Response> => {
  const server = createApp({
    config: loadApiConfig(await createEnvironment(environmentOverrides)),
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;

  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
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

describe("authentication HTTP endpoints", () => {
  it("limits a sixth failed login attempt in the same app instance", async () => {
    const server = createApp({
      config: loadApiConfig(await createEnvironment()),
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address() as AddressInfo;

    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await fetch(
          `http://127.0.0.1:${address.port}/api/auth/login`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password: "incorrect password" }),
          },
        );

        expect(response.status).toBe(401);
      }

      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/auth/login`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: "incorrect password" }),
        },
      );

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("900");
      expect(await response.json()).toEqual({ error: "TooManyRequests" });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
  it("logs in and issues the required session cookie", async () => {
    const response = await fetchFromApp("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toMatch(
      /^neutralnews_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800$/,
    );
  });

  it("ignores forwarded HTTPS when the proxy is not trusted", async () => {
    const response = await fetchFromApp("/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ password }),
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toMatch(
      /^neutralnews_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800$/,
    );
  });

  it("sets Secure when forwarded HTTPS comes from a trusted proxy", async () => {
    const response = await fetchFromApp(
      "/api/auth/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-proto": "https",
        },
        body: JSON.stringify({ password }),
      },
      { NEUTRALNEWS_TRUSTED_PROXY_ADDRESSES: "127.0.0.1" },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toMatch(
      /^neutralnews_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Secure; Max-Age=604800$/,
    );
  });

  it("uses the first forwarded protocol value from a trusted proxy", async () => {
    const response = await fetchFromApp(
      "/api/auth/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-proto": "https,http",
        },
        body: JSON.stringify({ password }),
      },
      { NEUTRALNEWS_TRUSTED_PROXY_ADDRESSES: "127.0.0.1" },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("; Secure;");
  });

  it("does not set Secure when trusted forwarded protocol is HTTP", async () => {
    const response = await fetchFromApp(
      "/api/auth/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-proto": "http",
        },
        body: JSON.stringify({ password }),
      },
      { NEUTRALNEWS_TRUSTED_PROXY_ADDRESSES: "127.0.0.1" },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toMatch(
      /^neutralnews_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800$/,
    );
  });

  it("expires logout cookies as Secure when forwarded HTTPS comes from a trusted proxy", async () => {
    const response = await fetchFromApp(
      "/api/auth/logout",
      {
        method: "POST",
        headers: {
          "x-forwarded-proto": "https",
          cookie: `neutralnews_session=${createSession({ secret: sessionSecret })}`,
          origin: "http://127.0.0.1:3000",
        },
      },
      { NEUTRALNEWS_TRUSTED_PROXY_ADDRESSES: "127.0.0.1" },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toBe(
      "neutralnews_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0",
    );
  });

  it("returns the same generic response for invalid credentials", async () => {
    const response = await fetchFromApp("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "incorrect password" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("requires a valid session for logout", async () => {
    const response = await fetchFromApp("/api/auth/logout", { method: "POST" });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});
