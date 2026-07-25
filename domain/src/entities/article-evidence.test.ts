import { describe, expect, it } from "vitest";

import {
  createArticle,
  createArticleStatement,
  createEvidenceFragment,
  isErr,
  isOk,
  toArticleSnapshot,
  toEvidenceFragmentSnapshot,
} from "../index.js";
import type {
  ArticleSnapshot,
  ArticleStatementSnapshot,
  EvidenceContentKind,
  EvidenceFragment,
  EvidenceFragmentSnapshot,
} from "../index.js";

const validArticleInput: ArticleSnapshot = {
  id: "22222222-2222-4222-8222-222222222222",
  sourceId: "11111111-1111-4111-8111-111111111111",
  url: "https://example.com/politica/nota",
  title: "Titulo de la nota",
  language: "ES-AR",
  publishedAt: "2026-07-25T12:30:00.000Z",
};

const validEvidenceInput: EvidenceFragmentSnapshot = {
  id: "33333333-3333-4333-8333-333333333333",
  text: "El ministro declaro que la medida se aplicara desde agosto.",
  provenance: {
    articleId: validArticleInput.id,
    sourceId: validArticleInput.sourceId,
    url: validArticleInput.url,
    contentKind: "extracted_body",
  },
  quality: {
    contentLevel: "partial",
  },
};

const validStatementInput: ArticleStatementSnapshot = {
  id: "44444444-4444-4444-8444-444444444444",
  text: "La medida se aplicara desde agosto.",
  attribution: "Ministro de Economia",
  originReference: {
    evidenceFragmentId: validEvidenceInput.id,
  },
};

describe("Article and evidence contracts", () => {
  it("creates an article with source, url, title, language, and optional date", () => {
    const result = createArticle(validArticleInput);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({
        ...validArticleInput,
        language: "es-ar",
      });
    }

    const withoutDate = createArticle({
      ...validArticleInput,
      publishedAt: undefined,
    });

    expect(isOk(withoutDate)).toBe(true);
    if (isOk(withoutDate)) {
      expect(withoutDate.value.publishedAt).toBeUndefined();
    }
  });

  it.each([
    ["url", { url: "ftp://example.com/nota" }],
    ["title", { title: "  " }],
    ["language", { language: "spanish" }],
    ["publishedAt", { publishedAt: "25/07/2026" }],
  ])("rejects an article with invalid %s", (_field, override) => {
    const result = createArticle({
      ...validArticleInput,
      ...override,
    });

    expect(isErr(result)).toBe(true);
  });

  it("creates evidence fragments for every supported content kind", () => {
    const cases: Array<{
      contentKind: EvidenceContentKind;
      contentLevel: "complete" | "partial";
    }> = [
      { contentKind: "extracted_body", contentLevel: "complete" },
      { contentKind: "rss_summary", contentLevel: "partial" },
      { contentKind: "web_snippet", contentLevel: "partial" },
      { contentKind: "primary_document", contentLevel: "complete" },
    ];

    for (const { contentKind, contentLevel } of cases) {
      const result = createEvidenceFragment({
        ...validEvidenceInput,
        provenance: {
          ...validEvidenceInput.provenance,
          contentKind,
        },
        quality: {
          contentLevel,
        },
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.provenance.contentKind).toBe(contentKind);
        expect(result.value.quality.contentLevel).toBe(contentLevel);
      }
    }
  });

  it.each([
    ["rss_summary", "complete"],
    ["web_snippet", "complete"],
  ] as const)(
    "rejects non-extracted partial evidence marked as %s with %s content level",
    (contentKind, contentLevel) => {
      const result = createEvidenceFragment({
        ...validEvidenceInput,
        provenance: {
          ...validEvidenceInput.provenance,
          contentKind,
        },
        quality: {
          contentLevel,
        },
      });

      expect(isErr(result)).toBe(true);
    },
  );

  it.each([
    ["provenance", { provenance: undefined }],
    ["quality", { quality: undefined }],
  ])("rejects evidence without valid %s", (_field, override) => {
    const result = createEvidenceFragment({
      ...validEvidenceInput,
      ...override,
    } as unknown as EvidenceFragmentSnapshot);

    expect(isErr(result)).toBe(true);
  });

  it("serializes and rehydrates stable snapshots without full article bodies", () => {
    const article = createArticle(validArticleInput);
    const evidence = createEvidenceFragment(validEvidenceInput);

    expect(isOk(article)).toBe(true);
    expect(isOk(evidence)).toBe(true);
    if (!isOk(article) || !isOk(evidence)) {
      return;
    }

    const articleSnapshot = toArticleSnapshot(article.value);
    const evidenceSnapshot = toEvidenceFragmentSnapshot(evidence.value);

    expect(isOk(evidenceSnapshot)).toBe(true);
    if (!isOk(evidenceSnapshot)) {
      return;
    }

    expect(articleSnapshot).not.toHaveProperty("body");
    expect(articleSnapshot).not.toHaveProperty("extractedBody");
    expect(evidenceSnapshot.value).not.toHaveProperty("body");
    expect(evidenceSnapshot.value).not.toHaveProperty("extractedBody");
    expect(JSON.parse(JSON.stringify(articleSnapshot))).toEqual(articleSnapshot);
    expect(JSON.parse(JSON.stringify(evidenceSnapshot.value))).toEqual(
      evidenceSnapshot.value,
    );
    expect(isOk(createArticle(articleSnapshot))).toBe(true);
    expect(isOk(createEvidenceFragment(evidenceSnapshot.value))).toBe(true);
  });

  it("does not serialize complete extracted article bodies as persistible evidence snapshots", () => {
    const completeExtractedBody: EvidenceFragment = {
      id: "55555555-5555-4555-8555-555555555555",
      text: "Texto completo extraido del articulo que no debe persistirse.",
      provenance: {
        articleId: validArticleInput.id,
        sourceId: validArticleInput.sourceId,
        url: validArticleInput.url,
        contentKind: "extracted_body",
      },
      quality: {
        contentLevel: "complete",
      },
    } as EvidenceFragment;

    const result = toEvidenceFragmentSnapshot(completeExtractedBody);

    expect(isErr(result)).toBe(true);
  });

  it("creates statements with attribution and origin evidence reference", () => {
    const result = createArticleStatement(validStatementInput);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.attribution).toBe("Ministro de Economia");
      expect(result.value.originReference.evidenceFragmentId).toBe(
        validEvidenceInput.id,
      );
    }
  });

  it.each([
    ["text", { text: " " }],
    ["attribution", { attribution: "" }],
    ["originReference", { originReference: undefined }],
    [
      "originReference",
      { originReference: { evidenceFragmentId: "not-a-uuid" } },
    ],
  ])("rejects a statement without valid %s", (_field, override) => {
    const result = createArticleStatement({
      ...validStatementInput,
      ...override,
    } as unknown as ArticleStatementSnapshot);

    expect(isErr(result)).toBe(true);
  });
});

