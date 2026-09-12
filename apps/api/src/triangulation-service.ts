import {
  err,
  ok,
  triangulateTopicUseCase,
  type AiGenerationPort,
  type ArticleExtractorPort,
  type EditorialGenerationPort,
  type Result,
  type RssFeedReaderPort,
  type TriangulateTopicError,
  type TriangulationResult,
  type WebSearchPort,
} from "app-domain";

import type { ApiConfig } from "./config.js";
import {
  createJsonAiProviderConfigurationRepository,
  type JsonAiProviderConfigurationRepository,
  type JsonAiProviderConfigurationRepositoryError,
} from "./ai-provider-configuration-repository.js";
import {
  createJsonNewsSourceConfigurationRepository,
  type JsonNewsSourceConfigurationRepository,
  type JsonNewsSourceConfigurationRepositoryError,
} from "./news-source-configuration-repository.js";
import {
  createLocalEncryptedCredentialVault,
  type CredentialVault,
} from "./credential-vault.js";
import { createLocalJsonFileRepository } from "./local-json-file-repository.js";
import { createOpenAiAiProviderAdapter } from "./openai-ai-provider-adapter.js";
import { createArticleExtractorAdapter } from "./article-extractor-adapter.js";
import { createAiWebSearchAdapter } from "./ai-web-search-adapter.js";
import { createRssFeedReaderAdapter } from "./rss-feed-reader-adapter.js";
import { createTriangulationAnalyzer } from "./triangulation-analyzer.js";

export type TriangulationServiceError =
  | JsonNewsSourceConfigurationRepositoryError
  | JsonAiProviderConfigurationRepositoryError
  | TriangulateTopicError;

export interface TriangulationServiceInput {
  readonly config: ApiConfig;
  readonly query: string;
  readonly signal: AbortSignal;
  readonly newsSourceRepository?: Pick<
    JsonNewsSourceConfigurationRepository,
    "getEffectiveConfiguration"
  > | undefined;
  readonly aiConfigurationRepository?: Pick<
    JsonAiProviderConfigurationRepository,
    "getEffectiveConfiguration"
  > | undefined;
  readonly credentialVault?: CredentialVault | undefined;
  readonly aiProvider?: AiGenerationPort | undefined;
  readonly rssFeedReader?: RssFeedReaderPort | undefined;
  readonly articleExtractor?: ArticleExtractorPort | undefined;
  readonly webSearch?: WebSearchPort | undefined;
  readonly editorialGeneration?: Pick<
    EditorialGenerationPort,
    "generateTriangulation"
  > | undefined;
}

export const triangulateConfiguredTopic = async ({
  config,
  query,
  signal,
  newsSourceRepository = createJsonNewsSourceConfigurationRepository(config.dataDirectory),
  aiConfigurationRepository = createJsonAiProviderConfigurationRepository(config.dataDirectory),
  credentialVault = createLocalEncryptedCredentialVault({
    repository: createLocalJsonFileRepository(config.dataDirectory),
    key: config.credentialVaultKey,
  }),
  aiProvider,
  rssFeedReader = createRssFeedReaderAdapter({ externalServicePolicy: config.externalServices }),
  articleExtractor = createArticleExtractorAdapter({ externalServicePolicy: config.externalServices }),
  webSearch,
  editorialGeneration,
}: TriangulationServiceInput): Promise<
  Result<TriangulationResult, TriangulationServiceError>
> => {
  const sourceConfiguration = await newsSourceRepository.getEffectiveConfiguration();

  if (!sourceConfiguration.ok) {
    return sourceConfiguration;
  }

  const aiConfiguration = await aiConfigurationRepository.getEffectiveConfiguration();

  if (!aiConfiguration.ok) {
    return aiConfiguration;
  }

  const needsAiProvider = webSearch === undefined || editorialGeneration === undefined;
  const resolvedAiProvider = needsAiProvider
    ? aiProvider ?? createOpenAiAiProviderAdapter({
      configurationRepository: aiConfigurationRepository,
      credentialVault,
      externalServicePolicy: config.externalServices,
    })
    : undefined;
  const resolvedWebSearch = webSearch ?? createAiWebSearchAdapter({
    aiProvider: resolvedAiProvider!,
    articleExtractor,
    configurationRepository: aiConfigurationRepository,
  });
  const resolvedEditorialGeneration = editorialGeneration ?? {
    generateTriangulation: async (input: Parameters<EditorialGenerationPort["generateTriangulation"]>[0]) => {
      const analysis = await createTriangulationAnalyzer({
        aiProvider: resolvedAiProvider!,
        configurationRepository: aiConfigurationRepository,
      }).analyze({ evidence: input.evidence, options: input.options });

      return analysis.ok ? ok(analysis.value.triangulation) : err(analysis.error);
    },
  };

  return triangulateTopicUseCase.execute(
    {
      rssFeedReader,
      articleExtractor,
      webSearch: resolvedWebSearch,
      editorialGeneration: resolvedEditorialGeneration,
    },
    {
      sources: sourceConfiguration.value.sources,
      query,
      selection: aiConfiguration.value.activeSelection,
      options: {
        signal,
        maxConcurrency: config.rssFeeds.maxConcurrency,
      },
      deduplication: {
        trackingParameters: config.rssFeeds.trackingParameters,
      },
    },
  );
};
