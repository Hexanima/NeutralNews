import { describe, expect, it } from "vitest";

import {
  createSession,
  parseSession,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
  sessionLifetimeSeconds,
  verifyPassword,
} from "./authentication.js";

const password = "correct horse battery staple";
const passwordHash =
  "$argon2id$v=19$m=32,t=2,p=2$MDEyMzQ1Njc4OWFiY2RlZg==$DFYj7N4xFFUiI8oxwK/k/skRZiCNIGR5xOGTpdhlPKs=";
const sessionSecret = "0123456789abcdef0123456789abcdef";
const parallelismOnePassword = "parallelism one password";
const parallelismOnePasswordHash =
  "$argon2id$v=19$m=32,t=2,p=1$MDEyMzQ1Njc4OWFiY2RlZg==$3tvCwdd7MUuB81rsi89hLiVmvfk5BcFxVCAxjSr0ZgA=";
const now = new Date("2026-08-21T12:00:00.000Z");

describe("authentication", () => {
  it("verifies a correct Argon2id password", async () => {
    await expect(verifyPassword(password, passwordHash)).resolves.toBe(true);
  });

  it("verifies a valid Argon2id password with parallelism one", async () => {
    await expect(
      verifyPassword(parallelismOnePassword, parallelismOnePasswordHash),
    ).resolves.toBe(true);
    await expect(
      verifyPassword("incorrect password", parallelismOnePasswordHash),
    ).resolves.toBe(false);
  });

  it("rejects an incorrect password after Argon2id derivation", async () => {
    await expect(verifyPassword("incorrect password", passwordHash)).resolves.toBe(
      false,
    );
  });

  it("creates a signed session valid for seven days", () => {
    const token = createSession({ secret: sessionSecret, now });

    expect(parseSession({ token, secret: sessionSecret, now })).toEqual({
      issuedAt: Math.floor(now.getTime() / 1000),
      expiresAt: Math.floor(now.getTime() / 1000) + sessionLifetimeSeconds,
    });
  });

  it("rejects a tampered session", () => {
    const token = createSession({ secret: sessionSecret, now });

    expect(
      parseSession({ token: `${token}x`, secret: sessionSecret, now }),
    ).toBeNull();
  });

  it("rejects a session exactly when its seven-day lifetime expires", () => {
    const token = createSession({ secret: sessionSecret, now });
    const expiration = new Date(
      now.getTime() + sessionLifetimeSeconds * 1_000,
    );

    expect(
      parseSession({ token, secret: sessionSecret, now: expiration }),
    ).toBeNull();
  });

  it("serializes a secure session cookie only for HTTPS", () => {
    const token = createSession({ secret: sessionSecret, now });

    expect(serializeSessionCookie({ token, secure: false })).toBe(
      `neutralnews_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetimeSeconds}`,
    );
    expect(serializeSessionCookie({ token, secure: true })).toBe(
      `neutralnews_session=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${sessionLifetimeSeconds}`,
    );
  });

  it("expires the same cookie during logout", () => {
    expect(serializeExpiredSessionCookie({ secure: true })).toBe(
      "neutralnews_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0",
    );
  });
});
