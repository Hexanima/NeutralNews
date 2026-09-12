import { describe, expect, it } from "vitest";

import {
  createNewsSourceCandidate,
  isOk,
  toNewsSourceCandidateSnapshot,
} from "../index.js";

describe("NewsSourceCandidate", () => {
  it("normalizes a newly discovered domain as an inactive unclassified candidate", () => {
    const candidate = createNewsSourceCandidate({
      domain: "  Noticias.Example.  ",
      orientation: "sin_clasificar",
      active: false,
      approvalStatus: "pending_review",
      firstSeenAt: "2026-09-06T12:00:00.000Z",
      lastSeenAt: "2026-09-06T12:00:00.000Z",
    });

    expect(isOk(candidate)).toBe(true);
    if (isOk(candidate)) {
      expect(toNewsSourceCandidateSnapshot(candidate.value)).toEqual({
        domain: "noticias.example",
        orientation: "sin_clasificar",
        active: false,
        approvalStatus: "pending_review",
        firstSeenAt: "2026-09-06T12:00:00.000Z",
        lastSeenAt: "2026-09-06T12:00:00.000Z",
      });
    }
  });
});
