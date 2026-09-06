import type { Article, ArticleUrl, EvidenceFragment } from "../entities/article-evidence.js";
import type {
  ContextResult,
  FeedResult,
  RewriteResult,
  TriangulationResult,
} from "../entities/editorial-result.js";
import type { NewsSource } from "../entities/news-source.js";
import type {
  AiAccessibleModel,
  AiCredentialTestResult,
  AiGenerationPort,
  AiGenerationResult,
  AiUsageMetrics,
  AiWebSearchResult,
  ArticleExtractionResult,
  ArticleExtractorPort,
  CacheKeyInput,
  CachePort,
  EditorialGenerationBaseInput,
  EditorialGenerationPort,
  JsonValue,
  NewsSourceRepositoryFilters,
  NewsSourceRepositoryPort,
  PortError,
  RssFeedReaderPort,
  RssFeedReadResult,
  WebSearchPort,
  WebSearchResponse,
} from "../ports/index.js";
import { ok, type Result } from "../types/result.js";
import type { UUID } from "../types/uuid.js";

type AsyncPortResult<TResult> = Promise<Result<TResult, PortError>>;

const cacheStorageKey = (namespace: string, key: string): string =>
  `${namespace}:${key}`;

const sourceMatchesFilters = (
  source: NewsSource,
  filters?: NewsSourceRepositoryFilters | undefined,
): boolean => {
  if (filters === undefined) {
    return true;
  }

  return (
    (filters.active === undefined || source.active === filters.active) &&
    (filters.orientation === undefined ||
      source.orientation === filters.orientation) &&
    (filters.type === undefined || source.type === filters.type) &&
    (filters.region === undefined || source.region === filters.region) &&
    (filters.country === undefined || source.country === filters.country) &&
    (filters.language === undefined || source.language === filters.language) &&
    (filters.approvalStatus === undefined ||
      source.approvalStatus === filters.approvalStatus)
  );
};

export interface FakeNewsSourceRepositoryPort
  extends NewsSourceRepositoryPort {
  calls: {
    getById: Parameters<NewsSourceRepositoryPort["getById"]>[0][];
    list: NonNullable<Parameters<NewsSourceRepositoryPort["list"]>[0]>[];
    save: Parameters<NewsSourceRepositoryPort["save"]>[0][];
    delete: Parameters<NewsSourceRepositoryPort["delete"]>[0][];
  };
}

export const createFakeNewsSourceRepositoryPort = (
  initialSources: readonly NewsSource[] = [],
): FakeNewsSourceRepositoryPort => {
  const sources = new Map<UUID, NewsSource>(
    initialSources.map((source) => [source.id, source]),
  );
  const calls: FakeNewsSourceRepositoryPort["calls"] = {
    getById: [],
    list: [],
    save: [],
    delete: [],
  };

  return {
    calls,
    getById: async (input) => {
      calls.getById.push(input);

      return ok(sources.get(input.id) ?? null);
    },
    list: async (input = {}) => {
      calls.list.push(input);
      const listedSources = [...sources.values()].filter((source) =>
        sourceMatchesFilters(source, input.filters),
      );

      return ok(
        input.options?.maxItems === undefined
          ? listedSources
          : listedSources.slice(0, input.options.maxItems),
      );
    },
    save: async (input) => {
      calls.save.push(input);
      sources.set(input.source.id, input.source);

      return ok(undefined);
    },
    delete: async (input) => {
      calls.delete.push(input);
      sources.delete(input.id);

      return ok(undefined);
    },
  };
};

export interface FakeCachePort extends CachePort {
  calls: {
    read: CacheKeyInput[];
    write: (CacheKeyInput & { value: JsonValue })[];
    delete: CacheKeyInput[];
    clearNamespace: { namespace: string }[];
  };
}

export const createFakeCachePort = (): FakeCachePort => {
  const storage = new Map<string, JsonValue>();
  const calls: FakeCachePort["calls"] = {
    read: [],
    write: [],
    delete: [],
    clearNamespace: [],
  };

  return {
    calls,
    read: async <TValue extends JsonValue = JsonValue>(
      input: CacheKeyInput,
    ): AsyncPortResult<TValue | null> => {
      calls.read.push(input);

      return ok(
        (storage.get(cacheStorageKey(input.namespace, input.key)) ?? null) as
          | TValue
          | null,
      );
    },
    write: async (input) => {
      calls.write.push(input);
      storage.set(cacheStorageKey(input.namespace, input.key), input.value);

      return ok(undefined);
    },
    delete: async (input) => {
      calls.delete.push(input);
      storage.delete(cacheStorageKey(input.namespace, input.key));

      return ok(undefined);
    },
    clearNamespace: async (input) => {
      calls.clearNamespace.push({ namespace: input.namespace });
      const prefix = `${input.namespace}:`;
      for (const key of storage.keys()) {
        if (key.startsWith(prefix)) {
          storage.delete(key);
        }
      }

      return ok(undefined);
    },
  };
};

export interface FakeRssFeedReaderPortOptions {
  result?: Result<RssFeedReadResult, PortError> | undefined;
  articles?: readonly Article[] | undefined;
  evidence?: readonly EvidenceFragment[] | undefined;
}

export interface FakeRssFeedReaderPort extends RssFeedReaderPort {
  calls: {
    readFeed: Parameters<RssFeedReaderPort["readFeed"]>[0][];
  };
}

export const createFakeRssFeedReaderPort = (
  options: FakeRssFeedReaderPortOptions = {},
): FakeRssFeedReaderPort => {
  const calls: FakeRssFeedReaderPort["calls"] = { readFeed: [] };

  return {
    calls,
    readFeed: async (input) => {
      calls.readFeed.push(input);

      return (
        options.result ??
        ok({
          sourceId: input.source.id,
          feedUrl: input.feedUrl,
          articles: options.articles ?? [],
          evidence: options.evidence ?? [],
        })
      );
    },
  };
};

export interface FakeArticleExtractorPortOptions {
  result?: Result<ArticleExtractionResult, PortError> | undefined;
  resultForInput?: (
    input: Parameters<ArticleExtractorPort["extractArticle"]>[0],
  ) => Result<ArticleExtractionResult, PortError>;
  evidence?: readonly EvidenceFragment[] | undefined;
}

export interface FakeArticleExtractorPort extends ArticleExtractorPort {
  calls: {
    extractArticle: Parameters<ArticleExtractorPort["extractArticle"]>[0][];
  };
}

export const createFakeArticleExtractorPort = (
  options: FakeArticleExtractorPortOptions = {},
): FakeArticleExtractorPort => {
  const calls: FakeArticleExtractorPort["calls"] = { extractArticle: [] };

  return {
    calls,
    extractArticle: async (input) => {
      calls.extractArticle.push(input);

      return (
        options.resultForInput?.(input) ??
        options.result ??
        ok({
          article: input.article,
          evidence: options.evidence ?? [],
          extractionStatus: "partial",
        })
      );
    },
  };
};

export interface FakeWebSearchPortOptions {
  result?: Result<WebSearchResponse, PortError> | undefined;
  results?: WebSearchResponse["results"] | undefined;
  consultedUrls?: readonly ArticleUrl[] | undefined;
  failedExtractions?: WebSearchResponse["failedExtractions"] | undefined;
}

export interface FakeWebSearchPort extends WebSearchPort {
  calls: {
    search: Parameters<WebSearchPort["search"]>[0][];
  };
}

export const createFakeWebSearchPort = (
  options: FakeWebSearchPortOptions = {},
): FakeWebSearchPort => {
  const calls: FakeWebSearchPort["calls"] = { search: [] };

  return {
    calls,
    search: async (input) => {
      calls.search.push(input);

      return (
        options.result ??
        ok({
          results: options.results ?? [],
          consultedUrls: options.consultedUrls ?? [],
          ...(options.failedExtractions === undefined
            ? {}
            : { failedExtractions: options.failedExtractions }),
        })
      );
    },
  };
};

export interface FakeAiGenerationPortOptions {
  result?: Result<AiGenerationResult, PortError> | undefined;
  output?: JsonValue | undefined;
  citations?: AiGenerationResult["citations"] | undefined;
  usage?: AiUsageMetrics | undefined;
  webSearchText?: string | undefined;
  webSearchResult?: Result<AiWebSearchResult, PortError> | undefined;
  remoteModels?: readonly AiAccessibleModel[] | undefined;
  listAccessibleModelsResult?: Result<readonly AiAccessibleModel[], PortError> | undefined;
  credentialTestResult?: Result<AiCredentialTestResult, PortError> | undefined;
}

export interface FakeAiGenerationPort extends AiGenerationPort {
  calls: {
    generateStructuredResponse: Parameters<
      AiGenerationPort["generateStructuredResponse"]
    >[0][];
    searchWeb: Parameters<AiGenerationPort["searchWeb"]>[0][];
    listAccessibleModels: Parameters<
      AiGenerationPort["listAccessibleModels"]
    >[0][];
    testCredential: Parameters<AiGenerationPort["testCredential"]>[0][];
  };
}

export const createFakeAiGenerationPort = (
  options: FakeAiGenerationPortOptions = {},
): FakeAiGenerationPort => {
  const calls: FakeAiGenerationPort["calls"] = {
    generateStructuredResponse: [],
    searchWeb: [],
    listAccessibleModels: [],
    testCredential: [],
  };

  return {
    calls,
    generateStructuredResponse: async (input) => {
      calls.generateStructuredResponse.push(input);

      return (
        options.result ??
        ok({
          output: options.output ?? {},
          citations: options.citations ?? [],
          usage: options.usage ?? {},
        })
      );
    },
    searchWeb: async (input) => {
      calls.searchWeb.push(input);

      return (
        options.webSearchResult ??
        ok({
          text: options.webSearchText ?? "",
          citations: options.citations ?? [],
          usage: options.usage ?? {},
        })
      );
    },
    listAccessibleModels: async (input) => {
      calls.listAccessibleModels.push(input);

      return options.listAccessibleModelsResult ?? ok(options.remoteModels ?? []);
    },
    testCredential: async (input) => {
      calls.testCredential.push(input);

      return (
        options.credentialTestResult ??
        ok({
          providerId: input.providerId,
          accessibleModelCount: options.remoteModels?.length ?? 0,
        })
      );
    },
  };
};
export interface FakeEditorialGenerationPortOptions {
  triangulation: TriangulationResult;
  rewrite: RewriteResult;
  context: ContextResult;
  feed: FeedResult;
  triangulationResult?: Result<TriangulationResult, PortError> | undefined;
  rewriteResult?: Result<RewriteResult, PortError> | undefined;
  contextResult?: Result<ContextResult, PortError> | undefined;
  feedResult?: Result<FeedResult, PortError> | undefined;
}

export interface FakeEditorialGenerationPort extends EditorialGenerationPort {
  calls: {
    generateTriangulation: EditorialGenerationBaseInput[];
    generateRewrite: Parameters<EditorialGenerationPort["generateRewrite"]>[0][];
    generateContext: Parameters<EditorialGenerationPort["generateContext"]>[0][];
    generateFeed: Parameters<EditorialGenerationPort["generateFeed"]>[0][];
  };
}

export const createFakeEditorialGenerationPort = (
  options: FakeEditorialGenerationPortOptions,
): FakeEditorialGenerationPort => {
  const calls: FakeEditorialGenerationPort["calls"] = {
    generateTriangulation: [],
    generateRewrite: [],
    generateContext: [],
    generateFeed: [],
  };

  return {
    calls,
    generateTriangulation: async (input) => {
      calls.generateTriangulation.push(input);

      return options.triangulationResult ?? ok(options.triangulation);
    },
    generateRewrite: async (input) => {
      calls.generateRewrite.push(input);

      return options.rewriteResult ?? ok(options.rewrite);
    },
    generateContext: async (input) => {
      calls.generateContext.push(input);

      return options.contextResult ?? ok(options.context);
    },
    generateFeed: async (input) => {
      calls.generateFeed.push(input);

      return options.feedResult ?? ok(options.feed);
    },
  };
};
