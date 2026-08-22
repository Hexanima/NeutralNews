import type { AiCapability, AiModelSelection } from "../ai/index.js";
import type { ArticleUrl } from "../entities/article-evidence.js";
import type { IsoDateTimeString } from "../entities/news-source.js";
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

export interface AiUsageMetrics {
  inputUnits?: number | undefined;
  outputUnits?: number | undefined;
  cachedInputUnits?: number | undefined;
  totalUnits?: number | undefined;
  webSearchCalls?: number | undefined;
}

export interface AiGenerationResult {
  output: JsonValue;
  citations: readonly AiCitation[];
  usage: AiUsageMetrics;
}

export interface AiWebSearchResult {
  text: string;
  citations: readonly AiCitation[];
  usage: AiUsageMetrics;
}

export interface AiAccessibleModel {
  id: string;
  createdAt?: IsoDateTimeString | undefined;
  ownedBy?: string | undefined;
}

export interface AiCredentialFieldValue {
  fieldId: string;
  value: string;
}

export interface AiCredentialTestResult {
  providerId: string;
  accessibleModelCount: number;
}

export interface AiGenerationPort {
  generateStructuredResponse: (input: {
    selection: AiModelSelection;
    requiredCapabilities: readonly AiCapability[];
    prompt: string;
    outputSchema?: JsonValue | undefined;
    options?: LimitedPortOperationOptions | undefined;
  }) => AsyncResult<AiGenerationResult, PortError>;

  searchWeb: (input: {
    selection: AiModelSelection;
    requiredCapabilities: readonly AiCapability[];
    query: string;
    allowedDomains?: readonly string[] | undefined;
    blockedDomains?: readonly string[] | undefined;
    options?: LimitedPortOperationOptions | undefined;
  }) => AsyncResult<AiWebSearchResult, PortError>;

  listAccessibleModels: (input: {
    providerId: string;
    options?: LimitedPortOperationOptions | undefined;
  }) => AsyncResult<readonly AiAccessibleModel[], PortError>;

  testCredential: (input: {
    providerId: string;
    credentialValues: readonly AiCredentialFieldValue[];
    options?: LimitedPortOperationOptions | undefined;
  }) => AsyncResult<AiCredentialTestResult, PortError>;
}