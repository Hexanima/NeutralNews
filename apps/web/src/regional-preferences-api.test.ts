import { describe, expect, it } from "vitest";

import { saveRegionalPreferences } from "./regional-preferences-api.js";

describe("regional preferences API", () => {
  it("adds the browser IANA time zone when saving automatic preferences", async () => {
    let requestBody: unknown;
    const responseBody = { configurationVersion: 2 };

    await saveRegionalPreferences(
      {
        timeZone: { mode: "automatic" },
        feedDistribution: { argentina: 3, latin_america: 2, international: 1 },
      },
      {
        detectTimeZone: () => "America/Santiago",
        fetch: async (_url, init) => {
          requestBody = JSON.parse(String(init?.body));

          return new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    );

    expect(requestBody).toEqual({
      timeZone: { mode: "automatic", detectedTimeZone: "America/Santiago" },
      feedDistribution: { argentina: 3, latin_america: 2, international: 1 },
    });
  });
});
