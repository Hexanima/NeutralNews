import type { IncomingMessage, ServerResponse } from "node:http";

import type { ApiConfig } from "./config.js";
import {
  createSession,
  hasValidSessionCookie,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
  verifyPassword,
} from "./authentication.js";
import {
  createLoginAttemptLimiter,
  type LoginAttemptLimiter,
} from "./login-attempt-limiter.js";

const loginPath = "/api/auth/login";
const logoutPath = "/api/auth/logout";
const maxJsonBodyBytes = 64 * 1024;

export interface AuthenticationRequestOptions {
  loginAttemptLimiter?: LoginAttemptLimiter;
}

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
) => {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
};

const readPassword = async (request: IncomingMessage): Promise<string | null> => {
  let size = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;

    if (size > maxJsonBodyBytes) {
      return null;
    }

    chunks.push(buffer);
  }

  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    return (
      typeof value === "object" &&
      value !== null &&
      "password" in value &&
      typeof value.password === "string"
        ? value.password
        : null
    );
  } catch {
    return null;
  }
};

const firstHeaderValue = (
  value: string | string[] | undefined,
): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const normalizeIpAddress = (address: string): string =>
  address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;

const isTrustedProxyRequest = (
  request: IncomingMessage,
  config: ApiConfig | undefined,
): boolean => {
  const remoteAddress = request.socket.remoteAddress;

  if (remoteAddress === undefined || config === undefined) {
    return false;
  }

  const normalizedRemoteAddress = normalizeIpAddress(remoteAddress);

  return config.trustedProxyAddresses
    .map(normalizeIpAddress)
    .includes(normalizedRemoteAddress);
};

const isSecureRequest = (
  request: IncomingMessage,
  config: ApiConfig | undefined,
): boolean => {
  if ("encrypted" in request.socket && request.socket.encrypted === true) {
    return true;
  }

  if (!isTrustedProxyRequest(request, config)) {
    return false;
  }

  const forwardedProtocol = firstHeaderValue(
    request.headers["x-forwarded-proto"],
  )
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();

  return forwardedProtocol === "https";
};

export const handleAuthenticationRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  config?: ApiConfig,
  options: AuthenticationRequestOptions = {},
): Promise<boolean> => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const secure = isSecureRequest(request, config);
  const loginAttemptLimiter = options.loginAttemptLimiter ?? createLoginAttemptLimiter();


  if (pathname !== loginPath || request.method !== "POST") {
    return false;
  }

  if (config === undefined) {
    sendJson(response, 500, { error: "InternalServerError" });
    return true;
  }
  const retryAfterSeconds = loginAttemptLimiter.getRetryAfterSeconds();

  if (retryAfterSeconds !== null) {
    response.writeHead(429, {
      "content-type": "application/json",
      "retry-after": String(retryAfterSeconds),
    });
    response.end(JSON.stringify({ error: "TooManyRequests" }));
    return true;
  }


  const password = await readPassword(request);
  const authenticated =
    password !== null &&
    (await verifyPassword(password, config.accessPasswordHash));

  if (!authenticated) {
    loginAttemptLimiter.recordFailure();
    sendJson(response, 401, { error: "Unauthorized" });
    return true;
  }

  const token = createSession({ secret: config.sessionSecret });
  loginAttemptLimiter.reset();
  response.writeHead(204, {
    "set-cookie": serializeSessionCookie({ token, secure }),
  });
  response.end();
  return true;
};


export const handleLogoutRequest = (
  request: IncomingMessage,
  response: ServerResponse,
  config?: ApiConfig,
): boolean => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

  if (pathname !== logoutPath || request.method !== "POST") {
    return false;
  }

  response.writeHead(204, {
    "set-cookie": serializeExpiredSessionCookie({
      secure: isSecureRequest(request, config),
    }),
  });
  response.end();
  return true;
};

export const handleSessionGuard = (
  request: IncomingMessage,
  response: ServerResponse,
  config?: ApiConfig,
): boolean => {
  if (config === undefined) {
    sendJson(response, 500, { error: "InternalServerError" });
    return true;
  }

  if (
    hasValidSessionCookie({
      cookieHeader: request.headers.cookie,
      secret: config.sessionSecret,
    })
  ) {
    return false;
  }

  sendJson(response, 401, { error: "Unauthorized" });
  return true;
};
