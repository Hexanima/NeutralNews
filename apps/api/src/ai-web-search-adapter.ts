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
  type ArticleUrl,
  type NewsSource,
  type UUID,
  type WebSearchPort,
  type WebSearchResult,
} from "app-domain";

import type { JsonAiProviderConfigurationRepository } from "./ai-provider-configuration-repository.js";

export interface AiWebSearchAdapterOptions {
  readonly aiProvider: AiGenerationPort;
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

const toWebSearchResult = (input: {
  readonly source: NewsSource;
  readonly url: ArticleUrl;
  readonly title: string;
}): WebSearchResult | null => {
  const article = createArticle({
    id: deterministicUuid(`${input.source.id}:${input.url}`),
    sourceId: input.source.id,
    url: input.url,
    title: input.title,
    language: input.source.language,
  });

  if (!article.ok) {
    return null;
  }

  const evidence = createRuntimeEvidenceFragment({
    id: deterministicUuid(`${article.value.id}:web_snippet`),
    text: input.title,
    provenance: {
      articleId: article.value.id,
      sourceId: input.source.id,
      url: article.value.url,
      contentKind: "web_snippet",
    },
    quality: { contentLevel: "partial" },
  });

  return evidence.ok
    ? { source: input.source, article: article.value, evidence: evidence.value }
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

    const results = citations.flatMap(({ citation, url }) => {
      if (url === null) {
        return [];
      }

      if (!respectsDomainLimits({
        url,
        allowedDomains: input.allowedDomains,
        blockedDomains: input.blockedDomains,
      })) {
        return [];
      }

      const source = sourceForUrl(url, input.sourceScopes);
      const title = titleForCitation({ citation, url });

      if (source === null) {
        return [];
      }

      const result = toWebSearchResult({ source, url, title });

      return result === null ? [] : [result];
    });

    return ok({
      results,
      consultedUrls: citations.flatMap(({ url }) => url === null ? [] : [url]),
    });
  },
});
