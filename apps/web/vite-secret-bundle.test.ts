import { build, type RollupOutput } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const previousAccessHash = process.env.NEUTRALNEWS_ACCESS_PASSWORD_HASH;
const previousSessionSecret = process.env.NEUTRALNEWS_SESSION_SECRET;
const previousCredentialVaultKey = process.env.NEUTRALNEWS_CREDENTIAL_VAULT_KEY;

const getGeneratedText = (output: RollupOutput | RollupOutput[]): string => {
  const outputs = Array.isArray(output) ? output : [output];

  return outputs
    .flatMap((rollupOutput) => rollupOutput.output)
    .map((asset) =>
      asset.type === "asset" ? String(asset.source) : asset.code,
    )
    .join("\n");
};

afterEach(() => {
  process.env.NEUTRALNEWS_ACCESS_PASSWORD_HASH = previousAccessHash;
  process.env.NEUTRALNEWS_SESSION_SECRET = previousSessionSecret;
  process.env.NEUTRALNEWS_CREDENTIAL_VAULT_KEY = previousCredentialVaultKey;
});

describe("web production bundle secrets", () => {
  it("does not include backend runtime secrets", async () => {
    const accessHash = "bundle-test-access-hash";
    const sessionSecret = "bundle-test-session-secret";
    const credentialVaultKey = "bundle-test-credential-vault-key";
    process.env.NEUTRALNEWS_ACCESS_PASSWORD_HASH = accessHash;
    process.env.NEUTRALNEWS_SESSION_SECRET = sessionSecret;
    process.env.NEUTRALNEWS_CREDENTIAL_VAULT_KEY = credentialVaultKey;

    const configFile = fileURLToPath(new URL("./vite.config.ts", import.meta.url));
    const root = fileURLToPath(new URL(".", import.meta.url));
    const result = await build({
      configFile,
      root,
      build: {
        write: false,
      },
      logLevel: "silent",
    });
    const generatedText = getGeneratedText(result as RollupOutput | RollupOutput[]);

    expect(generatedText).not.toContain(accessHash);
    expect(generatedText).not.toContain(sessionSecret);
    expect(generatedText).not.toContain(credentialVaultKey);
  });
});
