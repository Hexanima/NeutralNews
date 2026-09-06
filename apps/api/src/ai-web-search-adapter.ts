import { createHash } from "node:crypto";

import {
  AiConfigurationUnavailableError,
  ExternalPortError,
  PortCancelledError,
  createArticle,
  createRuntimeEvidenceFragment,
  err,
  ok,
  validateAiModelSelection,
  type AiGenerationPort,
  type Article,
  type ArticleExtractionResult,
  type ArticleExtractorPort,
  type ArticleUrl,
  type NewsSource,
  type UUID,
  type WebSearchPort,
  type WebSearchExtractionFailure,
  type WebSearchResult,
} from "app-domain";

import type { JsonAiProviderConfigurationRepository } from "./ai-provider-configuration-repository.js";

export interface AiWebSearchAdapterOptions {
  readonly aiProvider: AiGenerationPort;
  readonly articleExtractor: ArticleExtractorPort;
  readonly configurationRepository: Pick<
    JsonAiProviderConfigurationRepository,
    "getEffectiveConfiguration"
  >;
}

const operationName = "ai.web_search";

const deterministicUuid = (seed: string): UUID => {
  const hex = createHash("sha256").update(seed).digest("hex");
  const variant = ((Number.parseInt(hex[16] ?? "8", 16) & 0x3) | 0x8).toString(16);

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}` as UUID;
};

const titleForCitation = (input: {
  readonly citation: { readonly title?: string };
  readonly url: ArticleUrl;
}): string => {
  const title = input.citation.title?.trim();

  return title === undefined || title === ""
    ? hostnameForUrl(input.url)
    : title;
};

const createArticleForCitation = (input: {
  readonly source: NewsSource;
  readonly url: ArticleUrl;
  readonly title: string;
}): Article | null => {
  const article = createArticle({
    id: deterministicUuid(input.source.id + ":" + input.url),
    sourceId: input.source.id,
    url: input.url,
    title: input.title,
    language: input.source.language,
  });

  return article.ok ? article.value : null;
};

const toWebSearchResult = (input: {
  readonly source: NewsSource;
  readonly requestedArticle: Article;
  readonly extraction: ArticleExtractionResult;
}): WebSearchResult | null => {
  if (
    input.extraction.extractionStatus !== "full_text" ||
    input.extraction.article.id !== input.requestedArticle.id ||
    input.extraction.article.sourceId !== input.source.id ||
    input.extraction.article.url !== input.requestedArticle.url
  ) {
    return null;
  }

  const evidence = input.extraction.evidence.find((item) =>
    item.provenance.articleId === input.extraction.article.id &&
    item.provenance.sourceId === input.source.id &&
    item.provenance.url === input.extraction.article.url &&
    item.provenance.contentKind === "extracted_body",
  );

  if (evidence === undefined) {
    return null;
  }

  const webSearchEvidence = createRuntimeEvidenceFragment({
    id: deterministicUuid(
      input.extraction.article.id + ":web_search:" + evidence.provenance.contentKind,
    ),
    text: evidence.text,
    provenance: {
      ...evidence.provenance,
      discoveryKind: "web_search",
    },
    quality: evidence.quality,
  });

  return webSearchEvidence.ok
    ? {
      source: input.source,
      article: input.extraction.article,
      evidence: webSearchEvidence.value,
    }
    : null;
};

const toArticleUrl = (value: string): ArticleUrl | null => {
  const url = value.trim();

  try {
    const parsed = new URL(url);

    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? (url as ArticleUrl)
      : null;
  } catch {
    return null;
  }
};

const normalizeDomain = (domain: string): string =>
  domain.trim().toLowerCase().replace(/\.$/, "");

const hostnameForUrl = (url: ArticleUrl): string =>
  new URL(url).hostname.toLowerCase().replace(/[.]$/, "");

const matchesDomain = (hostname: string, domain: string): boolean => {
  const normalizedDomain = normalizeDomain(domain);

  return normalizedDomain !== "" && (
    hostname === normalizedDomain || hostname.endsWith("." + normalizedDomain)
  );
};

const respectsDomainLimits = (input: {
  readonly url: ArticleUrl;
  readonly allowedDomains?: readonly string[] | undefined;
  readonly blockedDomains?: readonly string[] | undefined;
}): boolean => {
  const hostname = hostnameForUrl(input.url);
  const isAllowed = input.allowedDomains === undefined ||
    input.allowedDomains.some((domain) => matchesDomain(hostname, domain));
  const isBlocked = input.blockedDomains?.some((domain) => matchesDomain(hostname, domain)) ??
    false;

  return isAllowed && !isBlocked;
};

const sourceForUrl = (
  url: ArticleUrl,
  sourceScopes: Parameters<WebSearchPort["search"]>[0]["sourceScopes"],
): NewsSource | null => {
  const hostname = hostnameForUrl(url);
  const matches = new Map<string, NewsSource>();

  for (const scope of sourceScopes) {
    if (
      scope.domains.some((domain) => matchesDomain(hostname, domain))
    ) {
      matches.set(scope.source.id, scope.source);
    }
  }

  return matches.size === 1 ? [...matches.values()][0] ?? null : null;
};

export const createAiWebSearchAdapter = ({
  aiProvider,
  articleExtractor,
  configurationRepository,
}: AiWebSearchAdapterOptions): WebSearchPort => ({
  search: async (input) => {
    if (input.options?.signal?.aborted) {
      return err(new PortCancelledError(operationName));
    }

    const configuration = await configurationRepository.getEffectiveConfiguration();

    if (!configuration.ok) {
      return err(new AiConfigurationUnavailableError());
    }

    const selection = validateAiModelSelection({
      providers: configuration.value.providers,
      models: configuration.value.models,
      selection: configuration.value.activeSelection,
      requiredCapabilities: ["web_search"],
    });

    if (!selection.ok) {
      return selection;
    }

    if (input.options?.signal?.aborted) {
      return err(new PortCancelledError(operationName));
    }

    const search = await aiProvider.searchWeb({
      selection: configuration.value.activeSelection,
      requiredCapabilities: ["web_search"],
      query: input.query,
      allowedDomains: input.allowedDomains,
      blockedDomains: input.blockedDomains,
      options: input.options,
    });

    if (!search.ok) {
      return search;
    }

    const citations = search.value.citations.map((citation) => ({
      citation,
      url: toArticleUrl(citation.url),
    }));

    if (citations.some(({ url }) => url === null)) {
      return err(new ExternalPortError(operationName, "PermanentFailure"));
    }

    const results: WebSearchResult[] = [];
    const maxResults = input.options?.maxItems === undefined
      ? Infinity
      : Math.max(0, Math.floor(input.options.maxItems));
    const failedExtractions: WebSearchExtractionFailure[] = [];

    for (const { citation, url } of citations) {
      if (url === null) {
        continue;
      }

      if (!respectsDomainLimits({
        url,
        allowedDomains: input.allowedDomains,
        blockedDomains: input.blockedDomains,
      })) {
        continue;
      }

      const source = sourceForUrl(url, input.sourceScopes);
      const title = titleForCitation({ citation, url });

      if (source === null) {
        continue;
      }

      const article = createArticleForCitation({ source, url, title });
      if (article === null) {
        continue;
      }

      if (results.length >= maxResults) {
        break;
      }

      if (input.options?.signal?.aborted) {
        return err(new PortCancelledError(operationName));
      }

      const extraction = await articleExtractor.extractArticle({
        article,
        fallbackEvidence: [],
        options: input.options,
      });
      if (!extraction.ok) {
        if (extraction.error instanceof PortCancelledError) {
          return extraction;
        }

        failedExtractions.push({
          sourceId: source.id,
          kind: "error",
          error: extraction.error,
        });
        continue;
      }

      if (extraction.value.extractionStatus === "partial") {
        failedExtractions.push({ sourceId: source.id, kind: "partial" });
        continue;
      }

      const result = toWebSearchResult({
        source,
        requestedArticle: article,
        extraction: extraction.value,
      });
      if (result !== null) {
        results.push(result);
      }
    }

    return ok({
      results,
      consultedUrls: citations.flatMap(({ url }) => url === null ? [] : [url]),
      ...(failedExtractions.length === 0
        ? {}
        : { failedExtractions }),
    });
  },
});
