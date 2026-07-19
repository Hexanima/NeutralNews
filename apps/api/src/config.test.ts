import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { ConfigurationError, loadApiConfig } from "./config.js";

const temporaryDirectories: string[] = [];

const validPasswordHash =
  "$2b$12$C6UzMDM.H6dfI/f/IKcEeO7FDgWz8WUyZVJXl2DrT0S6QYzR2v9Da";
const validArgon2Hash =
  "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$MTIzNDU2Nzg5MGFiY2RlZg";
const validSessionSecret = "0123456789abcdef0123456789abcdef";

const createDataDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "neutralnews-data-"));
  temporaryDirectories.push(directory);

  return directory;
};

const createValidEnvironment = async (
  overrides: NodeJS.ProcessEnv = {},
): Promise<NodeJS.ProcessEnv> => ({
  NEUTRALNEWS_ACCESS_PASSWORD_HASH: validPasswordHash,
  NEUTRALNEWS_SESSION_SECRET: validSessionSecret,
  NEUTRALNEWS_DATA_DIR: await createDataDirectory(),
  ...overrides,
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("api configuration", () => {
  it("loads a valid configuration with defaults", async () => {
    const environment = await createValidEnvironment();

    expect(loadApiConfig(environment)).toEqual({
      host: "127.0.0.1",
      port: 3000,
      timeZone: "America/Argentina/Buenos_Aires",
      dataDirectory: environment.NEUTRALNEWS_DATA_DIR,
      accessPasswordHash: validPasswordHash,
      sessionSecret: validSessionSecret,
      aiProviderStatus: "not_configured",
    });
  });

  it("gives API_PORT priority over PORT", async () => {
    const environment = await createValidEnvironment({
      API_PORT: "4100",
      PORT: "3100",
    });

    expect(loadApiConfig(environment).port).toBe(4100);
  });

  it.each(["abc", "1.5", "0", "-1", "65536"])(
    "rejects invalid API_PORT %s",
    async (port) => {
      const environment = await createValidEnvironment({ API_PORT: port });

      expect(() => loadApiConfig(environment)).toThrow(ConfigurationError);
      expect(() => loadApiConfig(environment)).toThrow(/API_PORT/);
    },
  );

  it("rejects an invalid time zone", async () => {
    const environment = await createValidEnvironment({
      NEUTRALNEWS_TIME_ZONE: "Buenos Aires",
    });

    expect(() => loadApiConfig(environment)).toThrow(/NEUTRALNEWS_TIME_ZONE/);
  });

  it("rejects a missing data directory", () => {
    const environment = {
      NEUTRALNEWS_ACCESS_PASSWORD_HASH: validPasswordHash,
      NEUTRALNEWS_SESSION_SECRET: validSessionSecret,
    };

    expect(() => loadApiConfig(environment)).toThrow(/NEUTRALNEWS_DATA_DIR/);
  });

  it("rejects a data directory that points to a file", async () => {
    const directory = await createDataDirectory();
    const filePath = join(directory, "data.json");
    await writeFile(filePath, "{}");

    const environment = await createValidEnvironment({
      NEUTRALNEWS_DATA_DIR: filePath,
    });

    expect(() => loadApiConfig(environment)).toThrow(/NEUTRALNEWS_DATA_DIR/);
  });

  it("accepts a data directory that does not exist yet", async () => {
    const directory = await createDataDirectory();
    const missingDirectory = join(directory, "missing");
    const environment = await createValidEnvironment({
      NEUTRALNEWS_DATA_DIR: missingDirectory,
    });

    expect(loadApiConfig(environment).dataDirectory).toBe(missingDirectory);
  });

  it("rejects a missing access password hash", async () => {
    const environment = await createValidEnvironment({
      NEUTRALNEWS_ACCESS_PASSWORD_HASH: undefined,
    });

    expect(() => loadApiConfig(environment)).toThrow(
      /NEUTRALNEWS_ACCESS_PASSWORD_HASH/,
    );
  });

  it("rejects an unsupported access password hash format", async () => {
    const environment = await createValidEnvironment({
      NEUTRALNEWS_ACCESS_PASSWORD_HASH: "plain-text-password",
    });

    expect(() => loadApiConfig(environment)).toThrow(
      /NEUTRALNEWS_ACCESS_PASSWORD_HASH/,
    );
  });

  it("accepts a valid Argon2 access password hash", async () => {
    const environment = await createValidEnvironment({
      NEUTRALNEWS_ACCESS_PASSWORD_HASH: validArgon2Hash,
    });

    expect(loadApiConfig(environment).accessPasswordHash).toBe(validArgon2Hash);
  });

  it.each(["$argon2id$", "$argon2i$", "$argon2id$not-enough"])(
    "rejects malformed Argon2 access password hash %s",
    async (accessPasswordHash) => {
      const environment = await createValidEnvironment({
        NEUTRALNEWS_ACCESS_PASSWORD_HASH: accessPasswordHash,
      });

      expect(() => loadApiConfig(environment)).toThrow(
        /NEUTRALNEWS_ACCESS_PASSWORD_HASH/,
      );
    },
  );

  it("rejects a missing session secret", async () => {
    const environment = await createValidEnvironment({
      NEUTRALNEWS_SESSION_SECRET: undefined,
    });

    expect(() => loadApiConfig(environment)).toThrow(
      /NEUTRALNEWS_SESSION_SECRET/,
    );
  });

  it("rejects a short session secret", async () => {
    const environment = await createValidEnvironment({
      NEUTRALNEWS_SESSION_SECRET: "short",
    });

    expect(() => loadApiConfig(environment)).toThrow(
      /NEUTRALNEWS_SESSION_SECRET/,
    );
  });

  it("does not require AI provider credentials at process startup", async () => {
    const environment = await createValidEnvironment({
      OPENAI_API_KEY: undefined,
    });

    expect(loadApiConfig(environment).aiProviderStatus).toBe("not_configured");
  });

  it("reports every invalid variable in the configuration error", async () => {
    const environment = await createValidEnvironment({
      API_PORT: "invalid",
      NEUTRALNEWS_ACCESS_PASSWORD_HASH: "plain",
      NEUTRALNEWS_SESSION_SECRET: "short",
      NEUTRALNEWS_DATA_DIR: "",
    });

    try {
      loadApiConfig(environment);
      throw new Error("Expected configuration to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).issues.map((issue) => issue.variable))
        .toEqual([
          "API_PORT",
          "NEUTRALNEWS_DATA_DIR",
          "NEUTRALNEWS_ACCESS_PASSWORD_HASH",
          "NEUTRALNEWS_SESSION_SECRET",
        ]);
    }
  });

  it("documents runtime variables without provider credentials or real secrets", async () => {
    const envExamplePath = fileURLToPath(
      new URL("../../../.env.example", import.meta.url),
    );
    const envExample = await readFile(envExamplePath, "utf8");

    expect(envExample).toContain("API_HOST=");
    expect(envExample).toContain("API_PORT=");
    expect(envExample).toContain("PORT=");
    expect(envExample).toContain("WEB_PORT=");
    expect(envExample).toContain("NEUTRALNEWS_TIME_ZONE=");
    expect(envExample).toContain("NEUTRALNEWS_DATA_DIR=");
    expect(envExample).toContain("NEUTRALNEWS_ACCESS_PASSWORD_HASH=");
    expect(envExample).toContain("NEUTRALNEWS_SESSION_SECRET=");
    expect(envExample).not.toContain("OPENAI_API_KEY");
    expect(envExample).not.toContain(validPasswordHash);
    expect(envExample).not.toContain(validSessionSecret);
  });
});
