import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ExternalPortError,
  isErr,
  isOk,
  ok,
  type AiCapability,
  type Article,
  type ArticleUrl,
  type ContextResult,
  type CountryCode,
  type EvidenceFragment,
  type FeedResult,
  type IsoDateTimeString,
  type LanguageCode,
  type NewsSource,
  type RewriteResult,
  type TriangulationResult,
  type UUID,
} from "../index.js";
import {
  createFakeAiGenerationPort,
  createFakeArticleExtractorPort,
  createFakeCachePort,
  createFakeEditorialGenerationPort,
  createFakeNewsSourceRepositoryPort,
  createFakeRssFeedReaderPort,
  createFakeWebSearchPort,
} from "../testing/index.js";

const sourceId = "11111111-1111-4111-8111-111111111111" as UUID;
const articleId = "22222222-2222-4222-8222-222222222222" as UUID;
const evidenceId = "33333333-3333-4333-8333-333333333333" as UUID;
const resultId = "44444444-4444-4444-8444-444444444444" as UUID;
const articleUrl = "https://example.com/noticia" as ArticleUrl;
const generatedAt = "2026-07-25T12:00:00.000Z" as IsoDateTimeString;

const source: NewsSource = {
  id: sourceId,
  name: "Agencia Publica",
  orientation: "sin_clasificar",
  type: "agency",
  region: "argentina",
  country: "AR" as CountryCode,
  language: "es-ar" as LanguageCode,
  active: true,
  approvalStatus: "approved",
  reviewedAt: generatedAt,
};

const article: Article = {
  id: articleId,
  sourceId,
  url: articleUrl,
  title: "Titulo de prueba",
  language: "es-ar" as LanguageCode,
  publishedAt: generatedAt,
};

const evidence: EvidenceFragment = {
  id: evidenceId,
  text: "Texto atribuido",
  provenance: {
    articleId,
    sourceId,
    url: articleUrl,
    contentKind: "rss_summary",
  },
  quality: {
    contentLevel: "partial",
  },
};

const triangulation: TriangulationResult = {
  summary: "Resumen neutral",
  matches: [],
  divergences: [],
  sources: [{ sourceId, evidenceFragmentIds: [evidenceId] }],
  warnings: [],
};

const rewrite: RewriteResult = {
  neutralText: "Texto neutral",
  changes: [],
  warnings: [],
};

const context: ContextResult = {
  factualContext: {
    summary: "Contexto factual",
    sources: [{ sourceId, evidenceFragmentIds: [evidenceId] }],
    points: [{ id: resultId, text: "Dato verificable", evidenceFragmentIds: [evidenceId] }],
  },
  mediaCoverage: triangulation,
  warnings: [],
};

const feed: FeedResult = {
  generatedAt,
  status: "fresh",
  topics: [],
  warnings: [],
};

describe("domain ports", () => {
  it("exposes repository and cache ports through reusable fakes that return Result", async () => {
    const signal = new AbortController().signal;
    const sources = createFakeNewsSourceRepositoryPort([source]);
    const cache = createFakeCachePort();

    const sourceResult = await sources.getById({ id: sourceId, options: { signal } });
    const listedSources = await sources.list({
      filters: { active: true, region: "argentina" },
      options: { signal, maxItems: 10 },
    });
    const writeResult = await cache.write({
      namespace: "feed",
      key: "home",
      value: { status: "fresh" },
      options: { signal, maxBytes: 128 },
    });
    const readResult = await cache.read<{ status: "fresh" }>({
      namespace: "feed",
      key: "home",
      options: { signal, maxBytes: 128 },
    });

    expect(isOk(sourceResult)).toBe(true);
    expect(isOk(listedSources)).toBe(true);
    expect(isOk(writeResult)).toBe(true);
    expect(isOk(readResult)).toBe(true);
    if (isOk(sourceResult) && isOk(listedSources) && isOk(readResult)) {
      expect(sourceResult.value).toEqual(source);
      expect(listedSources.value).toEqual([source]);
      expect(readResult.value).toEqual({ status: "fresh" });
    }
    expect(sources.calls.getById[0]?.options?.signal).toBe(signal);
    expect(cache.calls.write[0]?.options?.maxBytes).toBe(128);
  });

  it("exposes external discovery ports with cancellation and limit options", async () => {
    const signal = new AbortController().signal;
    const rss = createFakeRssFeedReaderPort({
      articles: [article],
      evidence: [evidence],
    });
    const extractor = createFakeArticleExtractorPort({ evidence: [evidence] });
    const search = createFakeWebSearchPort({
      results: [{ source, article, evidence }],
      consultedUrls: [articleUrl],
    });

    const feedResult = await rss.readFeed({
      source,
      feedUrl: "https://example.com/feed.xml" as ArticleUrl,
      options: { signal, timeoutMs: 1000, maxItems: 5, maxBytes: 4096 },
    });
    const extractionResult = await extractor.extractArticle({
      article,
      options: { signal, timeoutMs: 1000, maxBytes: 8192 },
    });
    const searchResult = await search.search({
      query: "presupuesto nacional",
      language: "es-ar" as LanguageCode,
      region: "argentina",
      allowedDomains: ["example.com"],
      options: { signal, timeoutMs: 1000, maxItems: 3 },
    });

    expect(isOk(feedResult)).toBe(true);
    expect(isOk(extractionResult)).toBe(true);
    expect(isOk(searchResult)).toBe(true);
    expect(rss.calls.readFeed[0]?.options?.maxItems).toBe(5);
    expect(extractor.calls.extractArticle[0]?.options?.maxBytes).toBe(8192);
    expect(search.calls.search[0]?.allowedDomains).toEqual(["example.com"]);
  });

  it("passes provider, model, and required capabilities to AI and editorial ports", async () => {
    const selection = { providerId: "openai", modelId: "gpt-5-mini" };
    const requiredCapabilities: readonly AiCapability[] = [
      "structured_outputs",
      "web_search",
    ];
    const ai = createFakeAiGenerationPort({
      output: { summary: "ok" },
      citations: [{ url: articleUrl, title: "Noticia" }],
    });
    const editorial = createFakeEditorialGenerationPort({
      triangulation,
      rewrite,
      context,
      feed,
    });

    const aiResult = await ai.generateStructuredResponse({
      selection,
      requiredCapabilities,
      prompt: "Generar resumen",
      outputSchema: { type: "object" },
      options: { timeoutMs: 1000 },
    });
    const triangulationResult = await editorial.generateTriangulation({
      selection,
      requiredCapabilities,
      evidence: [evidence],
      options: { timeoutMs: 1000 },
    });
    const rewriteResult = await editorial.generateRewrite({
      selection,
      requiredCapabilities,
      text: "Texto con carga valorativa",
      evidence: [evidence],
      options: { timeoutMs: 1000 },
    });
    const contextResult = await editorial.generateContext({
      selection,
      requiredCapabilities,
      articles: [article],
      evidence: [evidence],
      options: { timeoutMs: 1000 },
    });
    const feedResult = await editorial.generateFeed({
      selection,
      requiredCapabilities,
      articles: [article],
      evidence: [evidence],
      options: { timeoutMs: 1000 },
    });

    expect(isOk(aiResult)).toBe(true);
    expect(isOk(triangulationResult)).toBe(true);
    expect(isOk(rewriteResult)).toBe(true);
    expect(isOk(contextResult)).toBe(true);
    expect(isOk(feedResult)).toBe(true);
    expect(ai.calls.generateStructuredResponse[0]?.selection).toEqual(selection);
    expect(editorial.calls.generateTriangulation[0]?.requiredCapabilities).toEqual(
      requiredCapabilities,
    );
  });

  it("allows every fake port to be configured with a domain error Result", async () => {
    const failure = new ExternalPortError("rss", "PermanentFailure");
    const rss = createFakeRssFeedReaderPort({ result: { ok: false, error: failure } });

    const result = await rss.readFeed({
      source,
      feedUrl: "https://example.com/feed.xml" as ArticleUrl,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBe(failure);
    }
  });

  it("keeps production ports free of SDK, app, Node, and UI imports", () => {
    const portsDirectory = join(process.cwd(), "src", "ports");
    const files = collectTypeScriptFiles(portsDirectory).filter(
      (filePath) => !filePath.endsWith(".test.ts"),
    );
    const bannedPatterns = [
      /from\s+["'][^"']*apps\//,
      /from\s+["'](?:node:|fs|http|https|react|openai|@anthropic-ai|rss-parser)/,
    ];

    expect(files.length).toBeGreaterThan(0);
    for (const filePath of files) {
      const contents = readFileSync(filePath, "utf8");
      for (const pattern of bannedPatterns) {
        expect(contents).not.toMatch(pattern);
      }
    }
  });
});

const collectTypeScriptFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    return statSync(path).isDirectory()
      ? collectTypeScriptFiles(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
