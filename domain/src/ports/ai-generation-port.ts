import type { ArticleUrl } from "../entities/article-evidence.js";
import type { AsyncResult } from "../types/result.js";
import type {
  JsonValue,
  LimitedPortOperationOptions,
  PortError,
} from "./common.js";

export type AiCapability =
  | "structured_outputs"
  | "web_search"
  | "reasoning_low"
  | "reasoning_medium"
  | "reasoning_high";

export interface AiModelSelection {
  providerId: string;
  modelId: string;
}

export interface AiCitation {
  url: ArticleUrl;
  title?: string | undefined;
}

export interface AiGenerationResult {
  output: JsonValue;
  citations: readonly AiCitation[];
}

export interface AiGenerationPort {
  generateStructuredResponse: (input: {
    selection: AiModelSelection;
    requiredCapabilities: readonly AiCapability[];
    prompt: string;
    outputSchema?: JsonValue | undefined;
    options?: LimitedPortOperationOptions | undefined;
  }) => AsyncResult<AiGenerationResult, PortError>;
}
