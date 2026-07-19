import { statSync } from "node:fs";
import { resolve } from "node:path";

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
  aiProviderStatus: AiProviderStatus;
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
const bcryptHashPattern = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const argon2HashPattern = /^\$argon2(?:id|i)\$.+/;
const minimumSessionSecretLength = 32;

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

  if (
    !bcryptHashPattern.test(accessPasswordHash) &&
    !argon2HashPattern.test(accessPasswordHash)
  ) {
    issues.push({
      variable: "NEUTRALNEWS_ACCESS_PASSWORD_HASH",
      message: "must be a bcrypt or Argon2 hash",
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
    aiProviderStatus: "not_configured",
  };
};
