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

const titleForCitation = (citation: { readonly url: string; readonly title?: string }) => {
  const title = citation.title?.trim();

  return title === undefined || title === "" ? new URL(citation.url).hostname : title;
};

const toWebSearchResult = (input: {
  readonly source: Parameters<WebSearchPort["search"]>[0]["source"];
  readonly text: string;
  readonly citation: { readonly url: string; readonly title?: string };
}): WebSearchResult | null => {
  const article = createArticle({
    id: deterministicUuid(`${input.source.id}:${input.citation.url}`),
    sourceId: input.source.id,
    url: input.citation.url,
    title: titleForCitation(input.citation),
    language: input.source.language,
  });

  if (!article.ok) {
    return null;
  }

  const evidence = createRuntimeEvidenceFragment({
    id: deterministicUuid(`${article.value.id}:web_snippet`),
    text: input.text,
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

    const text = search.value.text.trim();

    if (text === "" && search.value.citations.length > 0) {
      return err(new ExternalPortError(operationName, "PermanentFailure"));
    }

    const results = text === ""
      ? []
      : search.value.citations.flatMap((citation) => {
          const result = toWebSearchResult({ source: input.source, text, citation });

          return result === null ? [] : [result];
        });

    return ok({
      results,
      consultedUrls: search.value.citations.map((citation) => citation.url),
    });
  },
});
