import { describe, expect, it } from "vitest";

import { createHealthResponse } from "./app.js";

describe("api app", () => {
  it("builds a health response from the domain layer", async () => {
    const response = await createHealthResponse();

    expect(response).toEqual({
      app: "neutral-news",
      domain: "ready",
    });
  });
});
