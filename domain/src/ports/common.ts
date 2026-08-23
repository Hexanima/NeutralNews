import { TaggedError } from "../types/error.js";
import type {
  AiCapabilityUnavailableError,
  AiModelIncompatibleError,
  AiModelNotFoundError,
  AiModelUnavailableError,
  AiProviderNotFoundError,
} from "../ai/index.js";

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

export class AiCredentialUnavailableError extends TaggedError<"AiCredentialUnavailable"> {
  public readonly type = "AiCredentialUnavailable";

  constructor(
    public readonly providerId: string,
    public readonly fieldId: string,
  ) {
    super("AiCredentialUnavailable");
    this.message = `${providerId}/${fieldId} credential is unavailable`;
  }
}

export class AiProviderUnsupportedError extends TaggedError<"AiProviderUnsupported"> {
  public readonly type = "AiProviderUnsupported";

  constructor(public readonly providerId: string) {
    super("AiProviderUnsupported");
    this.message = `AI provider is unsupported: ${providerId}`;
  }
}

export class AiProviderRejectedError extends TaggedError<"AiProviderRejected"> {
  public readonly type = "AiProviderRejected";

  constructor(
    public readonly providerId: string,
    public readonly operationName: string,
    public readonly statusCode?: number | undefined,
  ) {
    super("AiProviderRejected");
    this.message = `${providerId} rejected ${operationName}`;
  }
}

export class AiInvalidStructuredOutputError extends TaggedError<"AiInvalidStructuredOutput"> {
  public readonly type = "AiInvalidStructuredOutput";

  constructor(public readonly providerId: string) {
    super("AiInvalidStructuredOutput");
    this.message = `${providerId} returned invalid structured output`;
  }
}

export type PortError =
  | PortCancelledError
  | PortLimitExceededError
  | ExternalPortError
  | AiCapabilityUnavailableError
  | AiModelIncompatibleError
  | AiModelNotFoundError
  | AiModelUnavailableError
  | AiProviderNotFoundError
  | AiCredentialUnavailableError
  | AiProviderUnsupportedError
  | AiProviderRejectedError
  | AiInvalidStructuredOutputError;
