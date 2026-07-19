import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { createLocalJsonFileRepository } from "./local-json-file-repository.js";
import {
  createInMemoryCredentialVault,
  createLocalEncryptedCredentialVault,
  type CredentialVault,
} from "./credential-vault.js";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "neutralnews-vault-"));
  temporaryDirectories.push(directory);

  return directory;
};

const createVaultKey = () => randomBytes(32).toString("base64url");

const expectCredentialValueIsNotPresent = (
  payload: unknown,
  secret: string,
) => {
  expect(JSON.stringify(payload)).not.toContain(secret);
};

const runCredentialVaultContract = (
  name: string,
  createVault: () => Promise<CredentialVault>,
) => {
  describe(name, () => {
    it("creates provider secrets and returns metadata without the value", async () => {
      const vault = await createVault();
      const secret = "sk-provider-secret-value";

      const result = await vault.saveSecret("openai", secret);

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.value).toMatchObject({
          providerId: "openai",
        });
        expect(result.value.reference).toMatch(/^cred_v1_[A-Za-z0-9_-]+$/);
        expect(result.value.createdAt).toEqual(expect.any(String));
        expect(result.value.updatedAt).toEqual(expect.any(String));
        expectCredentialValueIsNotPresent(result.value, secret);
      }
    });

    it("reads provider secrets internally by provider and current reference", async () => {
      const vault = await createVault();
      const secret = "sk-provider-secret-value";
      const saved = await vault.saveSecret("openai", secret);

      expect(saved.ok).toBe(true);

      if (!saved.ok) {
        return;
      }

      const read = await vault.readSecret("openai", saved.value.reference);

      expect(read).toEqual({ ok: true, value: secret });
    });

    it("replaces provider secrets with a new opaque reference", async () => {
      const vault = await createVault();
      const firstSecret = "first-provider-secret";
      const secondSecret = "second-provider-secret";
      const first = await vault.saveSecret("openai", firstSecret);
      const second = await vault.saveSecret("openai", secondSecret);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);

      if (!first.ok || !second.ok) {
        return;
      }

      expect(second.value.reference).not.toBe(first.value.reference);
      expect(second.value.createdAt).toBe(first.value.createdAt);

      const staleRead = await vault.readSecret("openai", first.value.reference);
      const currentRead = await vault.readSecret("openai", second.value.reference);

      expect(staleRead.ok).toBe(false);
      expect(currentRead).toEqual({ ok: true, value: secondSecret });

      if (!staleRead.ok) {
        expect(staleRead.error.type).toBe("CredentialReferenceMismatch");
        expectCredentialValueIsNotPresent(staleRead.error, firstSecret);
      }
    });

    it("describes provider credential state without exposing the secret", async () => {
      const vault = await createVault();
      const secret = "sk-provider-secret-value";
      const missing = await vault.describeSecret("openai");
      const saved = await vault.saveSecret("openai", secret);

      expect(missing).toEqual({
        ok: true,
        value: { configured: false, providerId: "openai" },
      });
      expect(saved.ok).toBe(true);

      if (!saved.ok) {
        return;
      }

      const description = await vault.describeSecret("openai");

      expect(description).toEqual({
        ok: true,
        value: {
          configured: true,
          providerId: "openai",
          reference: saved.value.reference,
          createdAt: saved.value.createdAt,
          updatedAt: saved.value.updatedAt,
        },
      });
      expectCredentialValueIsNotPresent(description, secret);
    });

    it("deletes provider secrets idempotently", async () => {
      const vault = await createVault();
      const saved = await vault.saveSecret("openai", "sk-provider-secret-value");

      expect(saved.ok).toBe(true);

      if (!saved.ok) {
        return;
      }

      const firstDelete = await vault.deleteSecret("openai");
      const secondDelete = await vault.deleteSecret("openai");
      const read = await vault.readSecret("openai", saved.value.reference);
      const description = await vault.describeSecret("openai");

      expect(firstDelete).toEqual({ ok: true, value: undefined });
      expect(secondDelete).toEqual({ ok: true, value: undefined });
      expect(read.ok).toBe(false);
      expect(description).toEqual({
        ok: true,
        value: { configured: false, providerId: "openai" },
      });

      if (!read.ok) {
        expect(read.error.type).toBe("CredentialNotFound");
      }
    });

    it("keeps provider secrets isolated", async () => {
      const vault = await createVault();
      const openAiSecret = "sk-openai-secret";
      const otherSecret = "other-provider-secret";
      const openAi = await vault.saveSecret("openai", openAiSecret);
      const other = await vault.saveSecret("anthropic", otherSecret);

      expect(openAi.ok).toBe(true);
      expect(other.ok).toBe(true);

      if (!openAi.ok || !other.ok) {
        return;
      }

      expect(await vault.readSecret("openai", openAi.value.reference)).toEqual({
        ok: true,
        value: openAiSecret,
      });
      expect(await vault.readSecret("anthropic", other.value.reference)).toEqual({
        ok: true,
        value: otherSecret,
      });

      const crossProviderRead = await vault.readSecret(
        "openai",
        other.value.reference,
      );

      expect(crossProviderRead.ok).toBe(false);

      if (!crossProviderRead.ok) {
        expect(crossProviderRead.error.type).toBe(
          "CredentialReferenceMismatch",
        );
      }
    });

    it.each(["", " ", "../openai", "open ai", "OPENAI"])(
      "rejects invalid provider ids: %s",
      async (providerId) => {
        const vault = await createVault();
        const result = await vault.saveSecret(providerId, "secret");

        expect(result.ok).toBe(false);

        if (!result.ok) {
          expect(result.error.type).toBe("InvalidCredentialProvider");
        }
      },
    );
  });
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("credential vault", () => {
  runCredentialVaultContract("in-memory credential vault", async () =>
    createInMemoryCredentialVault(),
  );

  runCredentialVaultContract("local encrypted credential vault", async () => {
    const dataDirectory = await createTemporaryDirectory();

    return createLocalEncryptedCredentialVault({
      repository: createLocalJsonFileRepository(dataDirectory),
      key: createVaultKey(),
    });
  });

  it("persists encrypted secret material without plaintext values", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const secret = "plaintext-value-that-must-not-be-written";
    const vault = createLocalEncryptedCredentialVault({
      repository: createLocalJsonFileRepository(dataDirectory),
      key: createVaultKey(),
    });

    const saved = await vault.saveSecret("openai", secret);

    expect(saved.ok).toBe(true);
    expect(
      await readFile(join(dataDirectory, "credentials", "vault.json"), "utf8"),
    ).not.toContain(secret);
  });

  it("reads persisted secrets after recreating the encrypted vault with the same key", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const key = createVaultKey();
    const secret = "persisted-secret-value";
    const repository = createLocalJsonFileRepository(dataDirectory);
    const firstVault = createLocalEncryptedCredentialVault({ repository, key });
    const saved = await firstVault.saveSecret("openai", secret);

    expect(saved.ok).toBe(true);

    if (!saved.ok) {
      return;
    }

    const secondVault = createLocalEncryptedCredentialVault({ repository, key });
    const read = await secondVault.readSecret("openai", saved.value.reference);

    expect(read).toEqual({ ok: true, value: secret });
  });

  it("returns an unavailable error when the encrypted vault has no key", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const vault = createLocalEncryptedCredentialVault({
      repository: createLocalJsonFileRepository(dataDirectory),
      key: undefined,
    });

    const result = await vault.saveSecret("openai", "secret");

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.type).toBe("CredentialVaultUnavailable");
      expect(JSON.stringify(result.error)).not.toContain("secret");
    }
  });

  it("returns a storage error without exposing secrets when decrypting with the wrong key", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const secret = "secret-written-with-first-key";
    const repository = createLocalJsonFileRepository(dataDirectory);
    const firstVault = createLocalEncryptedCredentialVault({
      repository,
      key: createVaultKey(),
    });
    const saved = await firstVault.saveSecret("openai", secret);

    expect(saved.ok).toBe(true);

    if (!saved.ok) {
      return;
    }

    const secondVault = createLocalEncryptedCredentialVault({
      repository,
      key: createVaultKey(),
    });
    const read = await secondVault.readSecret("openai", saved.value.reference);

    expect(read.ok).toBe(false);

    if (!read.ok) {
      expect(read.error.type).toBe("CredentialVaultStorage");
      expectCredentialValueIsNotPresent(read.error, secret);
    }
  });

  it("returns a storage error when encrypted vault JSON is corrupt", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = createLocalJsonFileRepository(dataDirectory);
    const vault = createLocalEncryptedCredentialVault({
      repository,
      key: createVaultKey(),
    });

    await repository.writeJson("credentials/vault.json", {
      version: 1,
      providers: {
        openai: {
          reference: "cred_v1_corrupt",
          createdAt: "2026-07-19T00:00:00.000Z",
          updatedAt: "2026-07-19T00:00:00.000Z",
          algorithm: "aes-256-gcm",
          iv: "not-valid",
          tag: "not-valid",
          ciphertext: "not-valid",
        },
      },
    });

    const read = await vault.readSecret("openai", "cred_v1_corrupt");

    expect(read.ok).toBe(false);

    if (!read.ok) {
      expect(read.error.type).toBe("CredentialVaultStorage");
    }
  });

  it("returns a storage error when the vault file schema is invalid", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const vault = createLocalEncryptedCredentialVault({
      repository: createLocalJsonFileRepository(dataDirectory),
      key: createVaultKey(),
    });
    const repository = createLocalJsonFileRepository(dataDirectory);

    await repository.writeJson("credentials/vault.json", { providers: [] });

    const read = await vault.describeSecret("openai");

    expect(read.ok).toBe(false);

    if (!read.ok) {
      expect(read.error.type).toBe("CredentialVaultStorage");
    }
  });
});
