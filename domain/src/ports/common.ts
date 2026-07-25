import { TaggedError } from "../types/error.js";
import type { AiCapabilityUnavailableError } from "../ai/index.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface PortOperationOptions {
  signal?: AbortSignal | undefined;
}

export interface PortLimitOptions {
  timeoutMs?: number | undefined;
  maxItems?: number | undefined;
  maxBytes?: number | undefined;
  maxConcurrency?: number | undefined;
  maxRedirects?: number | undefined;
}

export type LimitedPortOperationOptions = PortOperationOptions &
  PortLimitOptions;

export class PortCancelledError extends TaggedError<"PortCancelled"> {
  public readonly type = "PortCancelled";

  constructor(public readonly operationName: string) {
    super("PortCancelled");
    this.message = `${operationName} was cancelled`;
  }
}

export class PortLimitExceededError extends TaggedError<"PortLimitExceeded"> {
  public readonly type = "PortLimitExceeded";

  constructor(
    public readonly operationName: string,
    public readonly limitName:
      | "timeoutMs"
      | "maxItems"
      | "maxBytes"
      | "maxConcurrency"
      | "maxRedirects",
  ) {
    super("PortLimitExceeded");
    this.message = `${operationName} exceeded ${limitName}`;
  }
}

export type ExternalPortFailureCategory =
  | "Timeout"
  | "Cancelled"
  | "TransientFailure"
  | "PermanentFailure";

export class ExternalPortError extends TaggedError<"ExternalPortError"> {
  public readonly type = "ExternalPortError";

  constructor(
    public readonly operationName: string,
    public readonly category: ExternalPortFailureCategory,
    public readonly statusCode?: number | undefined,
  ) {
    super("ExternalPortError");
    this.message = `${operationName} failed: ${category}`;
  }
}

export type PortError =
  | PortCancelledError
  | PortLimitExceededError
  | ExternalPortError
  | AiCapabilityUnavailableError;
