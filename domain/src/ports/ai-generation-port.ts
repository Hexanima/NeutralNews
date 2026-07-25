import type { AiCapability, AiModelSelection } from "../ai/index.js";
import type { ArticleUrl } from "../entities/article-evidence.js";
import type { AsyncResult } from "../types/result.js";
import type {
  JsonValue,
  LimitedPortOperationOptions,
  PortError,
} from "./common.js";

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
