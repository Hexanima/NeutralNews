import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createApp,
  createHealthResponse,
  resolveApiHost,
  resolveApiPort,
  startApp,
} from "./app.js";

const temporaryDirectories: string[] = [];

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

const fetchFromApp = async (
  staticRoot: string,
  path: string,
): Promise<Response> => {
  const server = createApp({ staticRoot });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;

  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`);
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

  it("starts the server with the resolved host and port", () => {
    const listen = vi.fn();
    const server = { listen };
    const createServer = vi.fn(() => server);

    startApp({
      createServer,
      environment: { API_HOST: "0.0.0.0", API_PORT: "4100" },
    });

    expect(listen).toHaveBeenCalledWith(4100, "0.0.0.0", expect.any(Function));
  });

  it("serves health from the root API route", async () => {
    const staticRoot = await createStaticRoot();
    const response = await fetchFromApp(staticRoot, "/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      app: "neutral-news",
      domain: "ready",
    });
  });

  it("serves health from the same-origin API prefix", async () => {
    const staticRoot = await createStaticRoot();
    const response = await fetchFromApp(staticRoot, "/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      app: "neutral-news",
      domain: "ready",
    });
  });

  it("serves the frontend index at the root route", async () => {
    const staticRoot = await createStaticRoot();
    const response = await fetchFromApp(staticRoot, "/");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("SPA shell");
  });

  it("serves static frontend assets", async () => {
    const staticRoot = await createStaticRoot();
    const response = await fetchFromApp(staticRoot, "/assets/app.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(await response.text()).toBe("console.log('asset');");
  });

  it("falls back to the frontend index for SPA reload routes", async () => {
    const staticRoot = await createStaticRoot();
    const response = await fetchFromApp(staticRoot, "/tema/argentina");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("SPA shell");
  });

  it("returns JSON not found responses for unknown API routes", async () => {
    const staticRoot = await createStaticRoot();
    const response = await fetchFromApp(staticRoot, "/api/desconocida");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "NotFound" });
  });

  it("rejects encoded path traversal attempts", async () => {
    const staticRoot = await createStaticRoot();
    const response = await fetchFromApp(staticRoot, "/%2e%2e/package.json");

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
