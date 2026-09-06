import {
  aggregateRssFeedsUseCase,
  type AggregateRssFeedsResult,
  type ArticleTopicMatchingPreferences,
  type PortCancelledError,
  type Result,
  type RssFeedReaderPort,
} from "app-domain";

import type { ApiConfig } from "./config.js";
import { createJsonNewsSourceConfigurationRepository } from "./news-source-configuration-repository.js";
import type {
  JsonNewsSourceConfigurationRepository,
  JsonNewsSourceConfigurationRepositoryError,
} from "./news-source-configuration-repository.js";
import { createRssFeedReaderAdapter } from "./rss-feed-reader-adapter.js";

export type RssFeedAggregationServiceError =
  | JsonNewsSourceConfigurationRepositoryError
  | PortCancelledError;

export interface RssFeedAggregationServiceInput {
  readonly config: ApiConfig;
  readonly signal?: AbortSignal | undefined;
  readonly topicMatching?: {
    readonly query: string;
    readonly preferences?: Partial<ArticleTopicMatchingPreferences> | undefined;
  } | undefined;
  readonly repository?:
    | Pick<JsonNewsSourceConfigurationRepository, "getEffectiveConfiguration">
    | undefined;
  readonly rssFeedReader?: RssFeedReaderPort | undefined;
}

export const aggregateConfiguredRssFeeds = async ({
  config,
  signal,
  topicMatching,
  repository = createJsonNewsSourceConfigurationRepository(config.dataDirectory),
  rssFeedReader = createRssFeedReaderAdapter({
    externalServicePolicy: config.externalServices,
  }),
}: RssFeedAggregationServiceInput): Promise<
  Result<AggregateRssFeedsResult, RssFeedAggregationServiceError>
> => {
  const configuration = await repository.getEffectiveConfiguration();

  if (!configuration.ok) {
    return configuration;
  }

  return aggregateRssFeedsUseCase.execute(
    { rssFeedReader },
    {
      sources: configuration.value.sources,
      options: {
        signal,
        maxConcurrency: config.rssFeeds.maxConcurrency,
      },
      deduplication: {
        trackingParameters: config.rssFeeds.trackingParameters,
      },
      topicMatching,
    },
  );
};
