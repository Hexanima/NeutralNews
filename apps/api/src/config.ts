import { existsSync, readFileSync, statSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type AiProviderStatus = "not_configured";

export interface ConfigurationIssue {
  variable: string;
  message: string;
}

export interface ApiConfig {
  host: string;
  port: number;
  timeZone: string;
  dataDirectory: string;
  accessPasswordHash: string;
  sessionSecret: string;
  credentialVaultKey?: string;
  aiProviderStatus: AiProviderStatus;
  externalServices: ExternalServiceConfig;
  trustedProxyAddresses: string[];
}

export interface ExternalServiceConfig {
  timeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
}

export class ConfigurationError extends Error {
  constructor(public readonly issues: ConfigurationIssue[]) {
    super(
      `Invalid configuration: ${issues
        .map((issue) => `${issue.variable} ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "ConfigurationError";
  }
}

const defaultHost = "127.0.0.1";
const defaultPort = 3000;
const defaultTimeZone = "America/Argentina/Buenos_Aires";
const defaultExternalTimeoutMs = 15_000;
const defaultExternalMaxAttempts = 3;
const defaultExternalRetryDelayMs = 250;
const argon2HashPattern =
  /^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$/;
const minimumSessionSecretLength = 32;
const defaultEnvironmentFilePath = fileURLToPath(
  new URL("../../../.env", import.meta.url),
);
const environmentVariablePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const stripInlineComment = (rawValue: string): string => {
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < rawValue.length; index += 1) {
    const character = rawValue.charAt(index);

    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (
      character === "#" &&
      (index === 0 || /\s/.test(rawValue.charAt(index - 1)))
    ) {
      return rawValue.slice(0, index);
    }
  }

  return rawValue;
};

const parseEnvironmentFile = (contents: string): NodeJS.ProcessEnv =>
  contents.split(/\r?\n/).reduce<NodeJS.ProcessEnv>((environment, rawLine) => {
    const line = rawLine.trim();

    if (line === "" || line.startsWith("#")) {
      return environment;
    }

    const assignment = line.startsWith("export ")
      ? line.slice("export ".length).trimStart()
      : line;
    const separatorIndex = assignment.indexOf("=");

    if (separatorIndex <= 0) {
      return environment;
    }

    const variable = assignment.slice(0, separatorIndex).trim();

    if (!environmentVariablePattern.test(variable)) {
      return environment;
    }

    let value = stripInlineComment(assignment.slice(separatorIndex + 1)).trim();

    if (
      value.length >= 2 &&
      ((value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    environment[variable] = value;

    return environment;
  }, {});

export const loadEnvironmentFile = (
  baseEnvironment: NodeJS.ProcessEnv,
  environmentFilePath: string,
): NodeJS.ProcessEnv => {
  if (!existsSync(environmentFilePath)) {
    return { ...baseEnvironment };
  }

  const fileEnvironment = parseEnvironmentFile(
    readFileSync(environmentFilePath, "utf8"),
  );
  const environment = { ...fileEnvironment };

  for (const [variable, value] of Object.entries(baseEnvironment)) {
    if (value !== undefined) {
      environment[variable] = value;
    }
  }

  return environment;
};

export const loadRuntimeEnvironment = (
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv =>
  loadEnvironmentFile(baseEnvironment, defaultEnvironmentFilePath);

const readRequired = (
  environment: NodeJS.ProcessEnv,
  variable: string,
  issues: ConfigurationIssue[],
): string | null => {
  const value = environment[variable]?.trim();

  if (value === undefined || value === "") {
    issues.push({ variable, message: "is required" });
    return null;
  }

  return value;
};

const parsePort = (
  environment: NodeJS.ProcessEnv,
  issues: ConfigurationIssue[],
): number => {
  const variable = environment.API_PORT !== undefined ? "API_PORT" : "PORT";
  const rawPort = environment.API_PORT ?? environment.PORT;

  if (rawPort === undefined || rawPort.trim() === "") {
    return defaultPort;
  }

  if (!/^\d+$/.test(rawPort)) {
    issues.push({ variable, message: "must be an integer from 1 to 65535" });
    return defaultPort;
  }

  const port = Number(rawPort);

  if (port < 1 || port > 65535) {
    issues.push({ variable, message: "must be an integer from 1 to 65535" });
    return defaultPort;
  }

  return port;
};

const parseIntegerSetting = (
  environment: NodeJS.ProcessEnv,
  variable: string,
  defaultValue: number,
  minimumValue: number,
  issues: ConfigurationIssue[],
): number => {
  const rawValue = environment[variable];

  if (rawValue === undefined || rawValue.trim() === "") {
    return defaultValue;
  }

  if (!/^\d+$/.test(rawValue)) {
    issues.push({
      variable,
      message: `must be an integer greater than or equal to ${minimumValue}`,
    });
    return defaultValue;
  }

  const value = Number(rawValue);

  if (value < minimumValue) {
    issues.push({
      variable,
      message: `must be an integer greater than or equal to ${minimumValue}`,
    });
    return defaultValue;
  }

  return value;
};

const resolveTimeZone = (
  environment: NodeJS.ProcessEnv,
  issues: ConfigurationIssue[],
): string => {
  const timeZone = environment.NEUTRALNEWS_TIME_ZONE?.trim() || defaultTimeZone;

  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    issues.push({ variable: "NEUTRALNEWS_TIME_ZONE", message: "must be valid" });
  }

  return timeZone;
};

const resolveDataDirectory = (
  environment: NodeJS.ProcessEnv,
  issues: ConfigurationIssue[],
): string => {
  const dataDirectory = readRequired(
    environment,
    "NEUTRALNEWS_DATA_DIR",
    issues,
  );

  if (dataDirectory === null) {
    return "";
  }

  const resolvedDataDirectory = resolve(dataDirectory);

  try {
    const stats = statSync(resolvedDataDirectory);

    if (!stats.isDirectory()) {
      issues.push({
        variable: "NEUTRALNEWS_DATA_DIR",
        message: "must point to a directory",
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      issues.push({
        variable: "NEUTRALNEWS_DATA_DIR",
        message: "could not be inspected",
      });
    }
  }

  return resolvedDataDirectory;
};

const resolveAccessPasswordHash = (
  environment: NodeJS.ProcessEnv,
  issues: ConfigurationIssue[],
): string => {
  const accessPasswordHash = readRequired(
    environment,
    "NEUTRALNEWS_ACCESS_PASSWORD_HASH",
    issues,
  );

  if (accessPasswordHash === null) {
    return "";
  }

  if (!argon2HashPattern.test(accessPasswordHash)) {
    issues.push({
      variable: "NEUTRALNEWS_ACCESS_PASSWORD_HASH",
      message: "must be an Argon2id hash",
    });
  }

  return accessPasswordHash;
};

const resolveSessionSecret = (
  environment: NodeJS.ProcessEnv,
  issues: ConfigurationIssue[],
): string => {
  const sessionSecret = readRequired(
    environment,
    "NEUTRALNEWS_SESSION_SECRET",
    issues,
  );

  if (sessionSecret === null) {
    return "";
  }

  if (sessionSecret.length < minimumSessionSecretLength) {
    issues.push({
      variable: "NEUTRALNEWS_SESSION_SECRET",
      message: `must be at least ${minimumSessionSecretLength} characters`,
    });
  }

  return sessionSecret;
};

const resolveExternalServiceConfig = (
  environment: NodeJS.ProcessEnv,
  issues: ConfigurationIssue[],
): ExternalServiceConfig => ({
  timeoutMs: parseIntegerSetting(
    environment,
    "NEUTRALNEWS_EXTERNAL_TIMEOUT_MS",
    defaultExternalTimeoutMs,
    1,
    issues,
  ),
  maxAttempts: parseIntegerSetting(
    environment,
    "NEUTRALNEWS_EXTERNAL_MAX_ATTEMPTS",
    defaultExternalMaxAttempts,
    1,
    issues,
  ),
  retryDelayMs: parseIntegerSetting(
    environment,
    "NEUTRALNEWS_EXTERNAL_RETRY_DELAY_MS",
    defaultExternalRetryDelayMs,
    0,
    issues,
  ),
});

const resolveTrustedProxyAddresses = (
  environment: NodeJS.ProcessEnv,
  issues: ConfigurationIssue[],
): string[] => {
  const rawAddresses = environment.NEUTRALNEWS_TRUSTED_PROXY_ADDRESSES?.trim();

  if (rawAddresses === undefined || rawAddresses === "") {
    return [];
  }

  const addresses = rawAddresses
    .split(",")
    .map((address) => address.trim())
    .filter((address) => address !== "");

  if (addresses.some((address) => isIP(address) === 0)) {
    issues.push({
      variable: "NEUTRALNEWS_TRUSTED_PROXY_ADDRESSES",
      message: "must contain only IP addresses",
    });
  }

  return addresses;
};

export const loadApiConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): ApiConfig => {
  const issues: ConfigurationIssue[] = [];
  const host = environment.API_HOST?.trim() || defaultHost;
  const port = parsePort(environment, issues);
  const timeZone = resolveTimeZone(environment, issues);
  const dataDirectory = resolveDataDirectory(environment, issues);
  const accessPasswordHash = resolveAccessPasswordHash(environment, issues);
  const sessionSecret = resolveSessionSecret(environment, issues);
  const credentialVaultKey =
    environment.NEUTRALNEWS_CREDENTIAL_VAULT_KEY?.trim() || undefined;
  const externalServices = resolveExternalServiceConfig(environment, issues);
  const trustedProxyAddresses = resolveTrustedProxyAddresses(
    environment,
    issues,
  );

  if (issues.length > 0) {
    throw new ConfigurationError(issues);
  }

  return {
    host,
    port,
    timeZone,
    dataDirectory,
    accessPasswordHash,
    sessionSecret,
    credentialVaultKey,
    aiProviderStatus: "not_configured",
    externalServices,
    trustedProxyAddresses,
  };
};
