import { describe, expect, it } from "vitest";

import {
  createLoginAttemptLimiter,
  loginAttemptLimit,
  loginAttemptWindowMs,
} from "./login-attempt-limiter.js";

describe("login attempt limiter", () => {
  it("releases the limit when its rolling window expires", () => {
    let currentTime = new Date("2026-08-22T00:00:00.000Z");
    const limiter = createLoginAttemptLimiter({ now: () => currentTime });

    for (let attempt = 0; attempt < loginAttemptLimit; attempt += 1) {
      limiter.recordFailure();
    }

    expect(limiter.getRetryAfterSeconds()).toBe(900);

    currentTime = new Date(currentTime.getTime() + loginAttemptWindowMs);

    expect(limiter.getRetryAfterSeconds()).toBeNull();
  });

  it("resets failures after a successful login", () => {
    const limiter = createLoginAttemptLimiter();

    for (let attempt = 0; attempt < loginAttemptLimit; attempt += 1) {
      limiter.recordFailure();
    }

    limiter.reset();

    expect(limiter.getRetryAfterSeconds()).toBeNull();
  });
});
