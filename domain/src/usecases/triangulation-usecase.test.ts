import {
  ExternalPortError,
  InvalidTriangulationAttributionError,
  PortLimitExceededError,
  createFakeArticleExtractorPort,
  createFakeRssFeedReaderPort,
  createFakeWebSearchPort,
  createTriangulationResult,
  err,
  isOk,
  ok,
  type AiModelSelection,
  type Article,
  type ArticleUrl,
  type CountryCode,
  type EditorialGenerationBaseInput,
  type EditorialGenerationPort,
  type EvidenceFragment,
  type IsoDateTimeString,
  type LanguageCode,
  type NewsSource,
  type NewsSourceCatalogEntry,
  type TriangulationResult,
  type UUID,
} from "../index.js";
import { describe, expect, it } from "vitest";

import { triangulateTopicUseCase } from "./triangulation-usecase.js";

const reviewedAt = "2026-09-12T00:00:00.000Z" as IsoDateTimeString;
const selection: AiModelSelection = { providerId: "openai", modelId: "gpt-5.6-terra" };

const createEntry = (
  suffix: string,
  orientation: NewsSource["orientation"],
): NewsSourceCatalogEntry => ({
  source: {
    id: `11111111-1111-4111-8111-11111111111${suffix}` as UUID,
    name: `Medio ${suffix}`,
    orientation,
    type: "media",
    region: "argentina",
    country: "AR" as CountryCode,
    language: "es-ar" as LanguageCode,
    active: true,
    approvalStatus: "approved",
    reviewedAt,
  },
  discovery: {
    mode: "rss",
    feedUrl: `https://medio-${suffix}.example/feed.xml` as ArticleUrl,
    domains: [`medio-${suffix}.example`],
  },
});

const createArticle = (suffix: string, sourceId: UUID): Article => ({
  id: `22222222-2222-4222-8222-22222222222${suffix}` as UUID,
  sourceId,
  url: `https://medio-${suffix}.example/reforma-laboral` as ArticleUrl,
  title: `Reforma laboral ${suffix}`,
  language: "es-ar" as LanguageCode,
  publishedAt: reviewedAt,
});

const createEvidence = (suffix: string, article: Article): EvidenceFragment => ({
  id: `33333333-3333-4333-8333-33333333333${suffix}` as UUID,
  text: `Resumen de reforma laboral ${suffix}`,
  provenance: {
    articleId: article.id,
    sourceId: article.sourceId,
    url: article.url,
    contentKind: "rss_summary",
  },
  quality: { contentLevel: "partial" },
});

const resultValue = <TValue>(result: { readonly ok: true; readonly value: TValue } | { readonly ok: false }): TValue => {
  if (!result.ok) {
    throw new Error("Expected a valid triangulation fixture");
  }

  return result.value;
};

const triangulationFor = (input: {
  readonly evidence: readonly EvidenceFragment[];
  readonly sourceIds: readonly UUID[];
  readonly warnings?: TriangulationResult["warnings"];
}): TriangulationResult => {
  const [firstEvidence, secondEvidence] = input.evidence;
  const [firstSourceId, secondSourceId] = input.sourceIds;
  const hasComparison =
    firstEvidence !== undefined &&
    secondEvidence !== undefined &&
    firstSourceId !== undefined &&
    secondSourceId !== undefined &&
    firstSourceId !== secondSourceId;

  return resultValue(createTriangulationResult({
    summary: hasComparison
      ? "Las fuentes describen el tratamiento legislativo de la reforma."
      : "La cobertura disponible describe el tratamiento legislativo de la reforma.",
    matches: hasComparison
      ? [{
          id: "44444444-4444-4444-8444-444444444444",
          text: "La reforma tiene tratamiento legislativo.",
          sourceIds: [firstSourceId, secondSourceId],
          evidenceFragmentIds: [firstEvidence.id, secondEvidence.id],
        }]
      : [],
    divergences: [],
    sources: [...new Map(
      input.evidence.map((evidence) => [
        evidence.provenance.sourceId,
        {
          sourceId: evidence.provenance.sourceId,
          evidenceFragmentIds: [evidence.id],
        },
      ]),
    ).values()],
    warnings: input.warnings ?? (hasComparison
      ? []
      : [{
          kind: "partial_coverage",
          message: "La cobertura disponible no permite comparar varios medios.",
        }]),
  }));
};

const createEditorialPort = (triangulation: TriangulationResult): EditorialGenerationPort & {
  readonly calls: readonly EditorialGenerationBaseInput[];
} => {
  const calls: EditorialGenerationBaseInput[] = [];

  return {
    calls,
    generateTriangulation: async (input) => {
      calls.push(input);
      return ok(triangulation);
    },
    generateRewrite: async () => {
      throw new Error("Not used by triangulation");
    },
    generateContext: async () => {
      throw new Error("Not used by triangulation");
    },
    generateFeed: async () => {
      throw new Error("Not used by triangulation");
    },
  };
};

const fallbackExtractor = () => createFakeArticleExtractorPort({
  resultForInput: (input) => ok({
    article: input.article,
    evidence: input.fallbackEvidence,
    extractionStatus: "partial",
  }),
});

const fullExtractor = () => createFakeArticleExtractorPort({
  resultForInput: (input) => ok({
    article: input.article,
    evidence: input.fallbackEvidence,
    extractionStatus: "full_text",
  }),
});

describe("triangulation use case", () => {
  it("orchestrates hybrid discovery and verified editorial generation", async () => {
    const entries = [
      createEntry("1", "izquierda"),
      createEntry("2", "centro"),
      createEntry("3", "derecha"),
    ];
    const articles = entries.map((entry, index) => createArticle(String(index + 1), entry.source.id));
    const evidence = articles.map((article, index) => createEvidence(String(index + 1), article));
    const rssFeedReader = createFakeRssFeedReaderPort();
    rssFeedReader.readFeed = async (input) => {
      const index = entries.findIndex((entry) => entry.source.id === input.source.id);
      return ok({
        sourceId: input.source.id,
        feedUrl: input.feedUrl,
        articles: [articles[index]!],
        evidence: [evidence[index]!],
      });
    };
    const articleExtractor = fullExtractor();
    const webSearch = createFakeWebSearchPort();
    const editorialGeneration = createEditorialPort(triangulationFor({
      evidence,
      sourceIds: entries.map((entry) => entry.source.id),
    }));

    const result = await triangulateTopicUseCase.execute(
      { rssFeedReader, articleExtractor, webSearch, editorialGeneration },
      {
        sources: entries,
        query: "reforma laboral",
        selection,
        options: { timeoutMs: 1_000, maxItems: 4 },
      },
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.summary).toContain("tratamiento legislativo");
      expect(result.value.matches).toHaveLength(1);
      expect(result.value.divergences).toEqual([]);
      expect(result.value.sources).toHaveLength(3);
      expect(result.value.warnings).toEqual([]);
    }
    expect(articleExtractor.calls.extractArticle).toHaveLength(3);
    expect(webSearch.calls.search).toEqual([]);
    expect(editorialGeneration.calls).toEqual([expect.objectContaining({
      selection,
      requiredCapabilities: ["structured_outputs", "reasoning_medium"],
      evidence,
      options: { timeoutMs: 1_000, maxItems: 4 },
    })]);
  });

  it("returns an insufficient-evidence result without calling editorial generation", async () => {
    const entries = [createEntry("1", "izquierda")];
    const editorialGeneration = createEditorialPort(triangulationFor({
      evidence: [],
      sourceIds: [],
    }));

    const result = await triangulateTopicUseCase.execute(
      {
        rssFeedReader: createFakeRssFeedReaderPort(),
        articleExtractor: fallbackExtractor(),
        webSearch: createFakeWebSearchPort(),
        editorialGeneration,
      },
      { sources: entries, query: "reforma laboral", selection },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        matches: [],
        divergences: [],
        sources: [],
        warnings: [expect.objectContaining({ kind: "insufficient_evidence" })],
      },
    });
    expect(editorialGeneration.calls).toEqual([]);
  });

  it("warns when the available evidence comes from one editorial orientation", async () => {
    const entries = [
      createEntry("1", "centro"),
      createEntry("2", "centro"),
      createEntry("3", "centro"),
    ];
    const articles = entries.map((entry, index) => createArticle(String(index + 1), entry.source.id));
    const evidence = articles.map((article, index) => createEvidence(String(index + 1), article));
    const rssFeedReader = createFakeRssFeedReaderPort();
    rssFeedReader.readFeed = async (input) => {
      const index = entries.findIndex((entry) => entry.source.id === input.source.id);
      return ok({ sourceId: input.source.id, feedUrl: input.feedUrl, articles: [articles[index]!], evidence: [evidence[index]!] });
    };
    const editorialGeneration = createEditorialPort(triangulationFor({
      evidence,
      sourceIds: entries.map((entry) => entry.source.id),
    }));

    const result = await triangulateTopicUseCase.execute(
      {
        rssFeedReader,
        articleExtractor: fallbackExtractor(),
        webSearch: createFakeWebSearchPort(),
        editorialGeneration,
      },
      { sources: entries, query: "reforma laboral", selection },
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "asymmetric_coverage" }),
      ]));
    }
    expect(editorialGeneration.calls).toHaveLength(1);
  });

  it("identifies coverage concentrated in one media outlet", async () => {
    const entries = [
      createEntry("1", "izquierda"),
      {
        ...createEntry("2", "centro"),
        source: { ...createEntry("2", "centro").source, type: "agency" as const },
      },
      {
        ...createEntry("3", "derecha"),
        source: { ...createEntry("3", "derecha").source, type: "agency" as const },
      },
    ];
    const articles = entries.map((entry, index) => createArticle(String(index + 1), entry.source.id));
    const evidence = articles.map((article, index) => createEvidence(String(index + 1), article));
    const rssFeedReader = createFakeRssFeedReaderPort();
    rssFeedReader.readFeed = async (input) => {
      const index = entries.findIndex((entry) => entry.source.id === input.source.id);
      return ok({ sourceId: input.source.id, feedUrl: input.feedUrl, articles: [articles[index]!], evidence: [evidence[index]!] });
    };
    const editorialGeneration = createEditorialPort(triangulationFor({
      evidence,
      sourceIds: entries.map((entry) => entry.source.id),
    }));

    const result = await triangulateTopicUseCase.execute(
      {
        rssFeedReader,
        articleExtractor: fullExtractor(),
        webSearch: createFakeWebSearchPort(),
        editorialGeneration,
      },
      { sources: entries, query: "reforma laboral", selection },
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.warnings).toEqual([expect.objectContaining({
        kind: "asymmetric_coverage",
        message: "La cobertura disponible se concentra en un único medio.",
        sourceIds: [entries[0]!.source.id],
      })]);
    }
  });

  it("preserves valid evidence and analysis after partial source failures", async () => {
    const entries = [createEntry("1", "izquierda"), createEntry("2", "centro")];
    const article = createArticle("1", entries[0]!.source.id);
    const evidence = createEvidence("1", article);
    const rssFeedReader = createFakeRssFeedReaderPort();
    rssFeedReader.readFeed = async (input) => input.source.id === entries[0]!.source.id
      ? ok({ sourceId: input.source.id, feedUrl: input.feedUrl, articles: [article], evidence: [evidence] })
      : err(new ExternalPortError("rss.feed.read", "TransientFailure"));
    const articleExtractor = createFakeArticleExtractorPort({
      result: err(new ExternalPortError("article.extract", "Timeout")),
    });
    const webSearch = createFakeWebSearchPort({
      result: err(new ExternalPortError("ai.web_search", "TransientFailure")),
    });
    const editorialGeneration = createEditorialPort(triangulationFor({
      evidence: [evidence],
      sourceIds: [entries[0]!.source.id],
    }));

    const result = await triangulateTopicUseCase.execute(
      { rssFeedReader, articleExtractor, webSearch, editorialGeneration },
      { sources: entries, query: "reforma laboral", selection },
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.summary).toContain("cobertura disponible");
      expect(result.value.sources).toEqual([{ sourceId: entries[0]!.source.id, evidenceFragmentIds: [evidence.id] }]);
      expect(result.value.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "partial_coverage" }),
      ]));
    }
    expect(editorialGeneration.calls).toHaveLength(1);
  });

  it("propagates an editorial generation failure after discovery succeeds", async () => {
    const entry = createEntry("1", "izquierda");
    const article = createArticle("1", entry.source.id);
    const evidence = createEvidence("1", article);
    const failure = new PortLimitExceededError("triangulation.analyze", "timeoutMs");
    const rssFeedReader = createFakeRssFeedReaderPort({ articles: [article], evidence: [evidence] });

    const result = await triangulateTopicUseCase.execute(
      {
        rssFeedReader,
        articleExtractor: fallbackExtractor(),
        webSearch: createFakeWebSearchPort(),
        editorialGeneration: {
          generateTriangulation: async () => err(failure),
        },
      },
      { sources: [entry], query: "reforma laboral", selection },
    );

    expect(result).toEqual({ ok: false, error: failure });
  });

  it("propagates a discovery failure when no evidence is available", async () => {
    const entry = createEntry("1", "izquierda");
    const failure = new PortLimitExceededError("rss.feed.read", "timeoutMs");
    const editorialGeneration = createEditorialPort(triangulationFor({
      evidence: [],
      sourceIds: [],
    }));

    const result = await triangulateTopicUseCase.execute(
      {
        rssFeedReader: createFakeRssFeedReaderPort({ result: err(failure) }),
        articleExtractor: createFakeArticleExtractorPort(),
        webSearch: createFakeWebSearchPort(),
        editorialGeneration,
      },
      { sources: [entry], query: "reforma laboral", selection },
    );

    expect(result).toEqual({ ok: false, error: failure });
    expect(editorialGeneration.calls).toEqual([]);
  });

  it("rejects editorial references that are absent from discovered evidence", async () => {
    const entry = createEntry("1", "izquierda");
    const article = createArticle("1", entry.source.id);
    const evidence = createEvidence("1", article);
    const unverified = resultValue(createTriangulationResult({
      summary: "Una fuente ajena describe la reforma.",
      matches: [],
      divergences: [],
      sources: [{
        sourceId: "99999999-9999-4999-8999-999999999999" as UUID,
        evidenceFragmentIds: ["88888888-8888-4888-8888-888888888888" as UUID],
      }],
      warnings: [{
        kind: "partial_coverage",
        message: "La cobertura no permite una comparación completa.",
      }],
    }));

    const result = await triangulateTopicUseCase.execute(
      {
        rssFeedReader: createFakeRssFeedReaderPort({ articles: [article], evidence: [evidence] }),
        articleExtractor: fallbackExtractor(),
        webSearch: createFakeWebSearchPort(),
        editorialGeneration: {
          generateTriangulation: async () => ok(unverified),
        },
      },
      { sources: [entry], query: "reforma laboral", selection },
    );

    expect(result).toEqual({
      ok: false,
      error: expect.any(InvalidTriangulationAttributionError),
    });
  });
});
