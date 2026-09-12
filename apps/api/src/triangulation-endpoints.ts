import type { IncomingMessage, ServerResponse } from "node:http";

import {
  AiConfigurationUnavailableError,
  AiCapabilityUnavailableError,
  AiCredentialUnavailableError,
  AiInvalidStructuredOutputError,
  AiModelUnavailableError,
  AiProviderRejectedError,
  AiProviderUnsupportedError,
  ExternalPortError,
  PortLimitExceededError,
  type Result,
  type TaggedError,
  type TriangulationResult,
} from "app-domain";

import type { ApiConfig } from "./config.js";
import { triangulateConfiguredTopic } from "./triangulation-service.js";

const triangulationPath = "/api/triangulation";
const maxJsonBodyBytes = 64 * 1024;
const maxQueryLength = 500;

class RequestBodyError extends Error {
  constructor() {
    super("Invalid triangulation query");
  }
}

export interface TriangulationRequestOptions {
  triangulate?: ((input: {
    query: string;
    signal: AbortSignal;
  }) => Promise<Result<TriangulationResult, TaggedError>>) | undefined;
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

const queryFrom = (body: unknown): string | null => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const query = (body as Record<string, unknown>).query;

  return typeof query === "string" &&
      query.trim() !== "" &&
      query.length <= maxQueryLength
    ? query.trim()
    : null;
};

const sendTriangulationError = (response: ServerResponse, error: unknown) => {
  if (error instanceof PortLimitExceededError && error.limitName === "timeoutMs") {
    sendJson(response, 504, { error: { code: "TriangulationTimeout" } });
    return;
  }

  if (
    error instanceof ExternalPortError ||
    error instanceof AiProviderRejectedError ||
    error instanceof AiCredentialUnavailableError ||
    error instanceof AiConfigurationUnavailableError ||
    error instanceof AiProviderUnsupportedError ||
    error instanceof AiModelUnavailableError ||
    error instanceof AiCapabilityUnavailableError ||
    error instanceof AiInvalidStructuredOutputError
  ) {
    sendJson(response, 502, { error: { code: "TriangulationProviderError" } });
    return;
  }

  sendJson(response, 500, { error: { code: "InternalServerError" } });
};

export const handleTriangulationRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  signal: AbortSignal,
  config: ApiConfig | undefined,
  options: TriangulationRequestOptions = {},
): Promise<boolean> => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

  if (pathname !== triangulationPath || request.method !== "POST") {
    return false;
  }

  let query: string | null;

  try {
    query = queryFrom(await readJsonBody(request));

    if (query === null) {
      sendJson(response, 400, { error: { code: "InvalidTriangulationQuery" } });
      return true;
    }
  } catch (error) {
    if (error instanceof RequestBodyError) {
      sendJson(response, 400, { error: { code: "InvalidTriangulationQuery" } });
      return true;
    }

    throw error;
  }

  const triangulate = options.triangulate ??
    (config === undefined
      ? undefined
      : (input: { query: string; signal: AbortSignal }) =>
        triangulateConfiguredTopic({ config, ...input }));

  if (triangulate === undefined) {
    sendJson(response, 500, { error: { code: "InternalServerError" } });
    return true;
  }

  const result = await triangulate({ query, signal });

  if (!result.ok) {
    sendTriangulationError(response, result.error);
    return true;
  }

  sendJson(response, 200, result.value);
  return true;
};
