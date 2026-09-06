import {
  discoverHybridEvidenceUseCase,
  type AiGenerationPort,
  type ArticleExtractorPort,
  type ArticleTopicMatchingPreferences,
  type HybridDiscoveryResult,
  type NewsSourceRegion,
  type PortCancelledError,
  type Result,
  type RssFeedReaderPort,
  type WebSearchPort,
} from "app-domain";

import type { ApiConfig } from "./config.js";
import {
  createJsonNewsSourceConfigurationRepository,
  type JsonNewsSourceConfigurationRepository,
  type JsonNewsSourceConfigurationRepositoryError,
} from "./news-source-configuration-repository.js";
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
import { createArticleExtractorAdapter } from "./article-extractor-adapter.js";
import { createAiWebSearchAdapter } from "./ai-web-search-adapter.js";
import { createRssFeedReaderAdapter } from "./rss-feed-reader-adapter.js";

export type HybridDiscoveryServiceError =
  | JsonNewsSourceConfigurationRepositoryError
  | PortCancelledError;

export interface HybridDiscoveryServiceInput {
  readonly config: ApiConfig;
  readonly query: string;
  readonly signal?: AbortSignal | undefined;
  readonly language?: Parameters<WebSearchPort["search"]>[0]["language"] | undefined;
  readonly region?: NewsSourceRegion | undefined;
  readonly allowedDomains?: readonly string[] | undefined;
  readonly blockedDomains?: readonly string[] | undefined;
  readonly topicMatchingPreferences?: Partial<ArticleTopicMatchingPreferences> | undefined;
  readonly repository?: Pick<JsonNewsSourceConfigurationRepository, "getEffectiveConfiguration"> | undefined;
  readonly aiConfigurationRepository?: Pick<JsonAiProviderConfigurationRepository, "getEffectiveConfiguration"> | undefined;
  readonly credentialVault?: CredentialVault | undefined;
  readonly aiProvider?: AiGenerationPort | undefined;
  readonly rssFeedReader?: RssFeedReaderPort | undefined;
  readonly articleExtractor?: ArticleExtractorPort | undefined;
  readonly webSearch?: WebSearchPort | undefined;
}

export const discoverConfiguredHybridEvidence = async ({
  config,
  query,
  signal,
  language,
  region,
  allowedDomains,
  blockedDomains,
  topicMatchingPreferences,
  repository = createJsonNewsSourceConfigurationRepository(config.dataDirectory),
  aiConfigurationRepository = createJsonAiProviderConfigurationRepository(config.dataDirectory),
  credentialVault = createLocalEncryptedCredentialVault({
    repository: createLocalJsonFileRepository(config.dataDirectory),
    key: config.credentialVaultKey,
  }),
  aiProvider,
  rssFeedReader = createRssFeedReaderAdapter({ externalServicePolicy: config.externalServices }),
  articleExtractor = createArticleExtractorAdapter({ externalServicePolicy: config.externalServices }),
  webSearch,
}: HybridDiscoveryServiceInput): Promise<
  Result<HybridDiscoveryResult, HybridDiscoveryServiceError>
> => {
  const configuration = await repository.getEffectiveConfiguration();

  if (!configuration.ok) {
    return configuration;
  }

  const resolvedAiProvider = aiProvider ?? createOpenAiAiProviderAdapter({
    configurationRepository: aiConfigurationRepository,
    credentialVault,
    externalServicePolicy: config.externalServices,
  });
  const resolvedWebSearch = webSearch ?? createAiWebSearchAdapter({
    aiProvider: resolvedAiProvider,
    articleExtractor,
    configurationRepository: aiConfigurationRepository,
  });

  return discoverHybridEvidenceUseCase.execute(
    {
      rssFeedReader,
      articleExtractor,
      webSearch: resolvedWebSearch,
    },
    {
      sources: configuration.value.sources,
      query,
      language,
      region,
      allowedDomains,
      blockedDomains,
      options: {
        signal,
        maxConcurrency: config.rssFeeds.maxConcurrency,
      },
      deduplication: {
        trackingParameters: config.rssFeeds.trackingParameters,
      },
      topicMatchingPreferences,
    },
  );
};
