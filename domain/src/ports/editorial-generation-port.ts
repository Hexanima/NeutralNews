import type {
  Article,
  EvidenceFragment,
} from "../entities/article-evidence.js";
import type {
  ContextResult,
  FeedResult,
  RewriteResult,
  TriangulationResult,
} from "../entities/editorial-result.js";
import type { AiCapability, AiModelSelection } from "../ai/index.js";
import type { AsyncResult } from "../types/result.js";
import type {
  LimitedPortOperationOptions,
  PortError,
} from "./common.js";

export interface EditorialGenerationBaseInput {
  selection: AiModelSelection;
  requiredCapabilities: readonly AiCapability[];
  evidence: readonly EvidenceFragment[];
  options?: LimitedPortOperationOptions | undefined;
}

export interface EditorialGenerationPort {
  generateTriangulation: (
    input: EditorialGenerationBaseInput,
  ) => AsyncResult<TriangulationResult, PortError>;
  generateRewrite: (
    input: EditorialGenerationBaseInput & { text: string },
  ) => AsyncResult<RewriteResult, PortError>;
  generateContext: (
    input: EditorialGenerationBaseInput & { articles: readonly Article[] },
  ) => AsyncResult<ContextResult, PortError>;
  generateFeed: (
    input: EditorialGenerationBaseInput & { articles: readonly Article[] },
  ) => AsyncResult<FeedResult, PortError>;
}
