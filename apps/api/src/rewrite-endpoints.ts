import type { IncomingMessage, ServerResponse } from "node:http";

import {
  AiCapabilityUnavailableError,
  AiConfigurationUnavailableError,
  AiCredentialUnavailableError,
  AiInvalidStructuredOutputError,
  AiModelIncompatibleError,
  AiModelNotFoundError,
  AiModelUnavailableError,
  AiProviderNotFoundError,
  AiProviderRejectedError,
  AiProviderUnsupportedError,
  ExternalPortError,
  PortLimitExceededError,
  type Result,
  type RewriteResult,
  type TaggedError,
} from "app-domain";

import type { ApiConfig } from "./config.js";
import { rewriteConfiguredText } from "./rewrite-service.js";

const rewritePath = "/api/rewrite";
const maxJsonBodyBytes = 64 * 1024;
const maxRewriteTextBytes = 16 * 1024;

class RequestBodyError extends Error {
  constructor() {
    super("Invalid rewrite text");
  }
}

export interface RewriteRequestOptions {
  rewrite?: ((input: {
    text: string;
    signal: AbortSignal;
  }) => Promise<Result<RewriteResult, TaggedError>>) | undefined;
}

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
) => {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  let size = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;

    if (size > maxJsonBodyBytes) {
      throw new RequestBodyError();
    }

    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new RequestBodyError();
  }
};

const textFrom = (body: unknown): string | null => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const text = (body as Record<string, unknown>).text;

  if (typeof text !== "string") {
    return null;
  }

  const normalized = text.trim();

  return normalized !== "" && Buffer.byteLength(normalized, "utf8") <= maxRewriteTextBytes
    ? normalized
    : null;
};

const sendInvalidText = (response: ServerResponse) => {
  sendJson(response, 400, { error: { code: "InvalidRewriteText" } });
};

const sendRewriteError = (response: ServerResponse, error: unknown) => {
  if (
    (error instanceof PortLimitExceededError && error.limitName === "timeoutMs") ||
    (error instanceof ExternalPortError && error.category === "Timeout")
  ) {
    sendJson(response, 504, { error: { code: "RewriteTimeout" } });
    return;
  }

  if (error instanceof PortLimitExceededError) {
    sendInvalidText(response);
    return;
  }

  if (
    error instanceof ExternalPortError ||
    error instanceof AiProviderRejectedError ||
    error instanceof AiCredentialUnavailableError ||
    error instanceof AiConfigurationUnavailableError ||
    error instanceof AiProviderUnsupportedError ||
    error instanceof AiProviderNotFoundError ||
    error instanceof AiModelNotFoundError ||
    error instanceof AiModelIncompatibleError ||
    error instanceof AiModelUnavailableError ||
    error instanceof AiCapabilityUnavailableError ||
    error instanceof AiInvalidStructuredOutputError
  ) {
    sendJson(response, 502, { error: { code: "RewriteProviderError" } });
    return;
  }

  sendJson(response, 500, { error: { code: "InternalServerError" } });
};

export const handleRewriteRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  signal: AbortSignal,
  config: ApiConfig | undefined,
  options: RewriteRequestOptions = {},
): Promise<boolean> => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

  if (pathname !== rewritePath || request.method !== "POST") {
    return false;
  }

  let text: string | null;

  try {
    text = textFrom(await readJsonBody(request));

    if (text === null) {
      sendInvalidText(response);
      return true;
    }
  } catch (error) {
    if (error instanceof RequestBodyError) {
      sendInvalidText(response);
      return true;
    }

    throw error;
  }

  const rewrite = options.rewrite ??
    (config === undefined
      ? undefined
      : (input: { text: string; signal: AbortSignal }) =>
        rewriteConfiguredText({ config, ...input }));

  if (rewrite === undefined) {
    sendJson(response, 500, { error: { code: "InternalServerError" } });
    return true;
  }

  const result = await rewrite({ text, signal });

  if (!result.ok) {
    sendRewriteError(response, result.error);
    return true;
  }

  sendJson(response, 200, result.value);
  return true;
};
