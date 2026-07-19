import { describe, expect, it } from "vitest";

import { createHealthResponse, resolveApiPort } from "./app.js";

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
});
