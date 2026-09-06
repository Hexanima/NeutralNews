import { describe, expect, it } from "vitest";

import { normalizeTopicMatchText } from "./article-topic-matching.js";

describe("article topic matching", () => {
  it("normalizes case, accents and punctuation", () => {
    expect(normalizeTopicMatchText("  MILEÍ: reforma—laboral!  ")).toBe(
      "milei reforma laboral",
    );
  });
});
