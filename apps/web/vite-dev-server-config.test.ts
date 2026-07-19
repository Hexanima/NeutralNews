import { describe, expect, it } from "vitest";
import type { ProxyOptions } from "vite";

import { createViteConfig } from "./vite.config.js";

const getApiProxy = (environment: NodeJS.ProcessEnv): ProxyOptions => {
  const config = createViteConfig(environment);
  const proxy = config.server?.proxy;

  expect(proxy).toBeDefined();
  expect(proxy).not.toBeInstanceOf(Array);

  const apiProxy = proxy?.["/api"];

  expect(typeof apiProxy).toBe("object");

  return apiProxy as ProxyOptions;
};

describe("vite dev server config", () => {
  it("loads the Tailwind Vite plugin", () => {
    const config = createViteConfig({});
    const plugins = (config.plugins ?? [])
      .flatMap((plugin) => (Array.isArray(plugin) ? plugin : [plugin]))
      .filter(Boolean);
    const pluginNames = plugins.map((plugin) =>
      typeof plugin === "object" && "name" in plugin
        ? String(plugin.name)
        : "",
    );

    expect(pluginNames.some((name) => name.includes("tailwindcss"))).toBe(true);
  });

  it("uses WEB_PORT when it is configured", () => {
    const config = createViteConfig({ WEB_PORT: "5174" });

    expect(config.server?.port).toBe(5174);
  });

  it("uses 5173 when no web port is configured", () => {
    const config = createViteConfig({});

    expect(config.server?.port).toBe(5173);
  });

  it("proxies API requests to the configured API port on loopback", () => {
    const apiProxy = getApiProxy({ API_PORT: "4000" });

    expect(apiProxy.target).toBe("http://127.0.0.1:4000");
    expect(apiProxy.changeOrigin).toBe(true);
  });

  it("rewrites API requests by removing the API prefix", () => {
    const apiProxy = getApiProxy({});

    expect(apiProxy.rewrite?.("/api/health")).toBe("/health");
  });
});
