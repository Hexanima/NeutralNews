import {
  type AiGenerationPort,
  type PortError,
  type Result,
  type RewriteResult,
} from "app-domain";

import type { ApiConfig } from "./config.js";
import {
  createJsonAiProviderConfigurationRepository,
  type JsonAiProviderConfigurationRepository,
} from "./ai-provider-configuration-repository.js";
import {
  createLocalEncryptedCredentialVault,
  type CredentialVault,
} from "./credential-vault.js";
import { createLocalJsonFileRepository } from "./local-json-file-repository.js";
import { createOpenAiAiProviderAdapter } from "./openai-ai-provider-adapter.js";
import { createRewriteAnalyzer } from "./rewrite-analyzer.js";

export interface RewriteServiceInput {
  readonly config: ApiConfig;
  readonly text: string;
  readonly signal: AbortSignal;
  readonly aiConfigurationRepository?: Pick<
    JsonAiProviderConfigurationRepository,
    "getEffectiveConfiguration"
  > | undefined;
  readonly credentialVault?: CredentialVault | undefined;
  readonly aiProvider?: Pick<AiGenerationPort, "generateStructuredResponse"> | undefined;
}

export const rewriteConfiguredText = async ({
  config,
  text,
  signal,
  aiConfigurationRepository = createJsonAiProviderConfigurationRepository(config.dataDirectory),
  credentialVault = createLocalEncryptedCredentialVault({
    repository: createLocalJsonFileRepository(config.dataDirectory),
    key: config.credentialVaultKey,
  }),
  aiProvider = createOpenAiAiProviderAdapter({
    configurationRepository: aiConfigurationRepository,
    credentialVault,
    externalServicePolicy: config.externalServices,
  }),
}: RewriteServiceInput): Promise<Result<RewriteResult, PortError>> =>
  createRewriteAnalyzer({
    aiProvider,
    configurationRepository: aiConfigurationRepository,
  }).rewrite({ text, options: { signal } });
