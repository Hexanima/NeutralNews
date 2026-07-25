import { TaggedError } from "../types/error.js";
import { err, ok, type Result } from "../types/result.js";
import type { UUID } from "../types/uuid.js";
import { createIsoDateTimeString, createLanguageCode } from "./news-source.js";
import type { IsoDateTimeString, LanguageCode } from "./news-source.js";

declare const articleUrlBrand: unique symbol;

export type ArticleUrl = string & { readonly [articleUrlBrand]: true };

export type EvidenceContentKind =
  | "extracted_body"
  | "rss_summary"
  | "web_snippet"
  | "primary_document";

export type EvidenceContentLevel = "complete" | "partial";

export interface Article {
  id: UUID;
  sourceId: UUID;
  url: ArticleUrl;
  title: string;
  language: LanguageCode;
  publishedAt?: IsoDateTimeString | undefined;
}

export interface ArticleSnapshot {
  id: string;
  sourceId: string;
  url: string;
  title: string;
  language: string;
  publishedAt?: string | undefined;
}

export interface EvidenceQuality {
  contentLevel: EvidenceContentLevel;
}

export interface EvidenceQualitySnapshot {
  contentLevel: string;
}

export interface EvidenceProvenance {
  articleId: UUID;
  sourceId: UUID;
  url: ArticleUrl;
  contentKind: EvidenceContentKind;
}

export interface EvidenceProvenanceSnapshot {
  articleId: string;
  sourceId: string;
  url: string;
  contentKind: string;
}

export interface EvidenceFragment {
  id: UUID;
  text: string;
  provenance: EvidenceProvenance;
  quality: EvidenceQuality;
}

export interface EvidenceFragmentSnapshot {
  id: string;
  text: string;
  provenance: EvidenceProvenanceSnapshot;
  quality: EvidenceQualitySnapshot;
}

export interface EvidenceOriginReference {
  evidenceFragmentId: UUID;
}

export interface EvidenceOriginReferenceSnapshot {
  evidenceFragmentId: string;
}

export interface ArticleStatement {
  id: UUID;
  text: string;
  attribution: string;
  originReference: EvidenceOriginReference;
}

export interface ArticleStatementSnapshot {
  id: string;
  text: string;
  attribution: string;
  originReference: EvidenceOriginReferenceSnapshot;
}

export type ArticleEvidenceField =
  | "id"
  | "sourceId"
  | "articleId"
  | "evidenceFragmentId"
  | "url"
  | "title"
  | "language"
  | "publishedAt"
  | "text"
  | "contentKind"
  | "contentLevel"
  | "quality"
  | "attribution"
  | "originReference";

export class InvalidArticleEvidenceValueError extends TaggedError<"InvalidArticleEvidenceValue"> {
  public readonly type = "InvalidArticleEvidenceValue";

  constructor(
    public readonly field: ArticleEvidenceField,
    public readonly value: unknown,
  ) {
    super("InvalidArticleEvidenceValue");
    this.message = `Invalid article evidence ${field}`;
  }
}

export class InvalidArticleEvidenceError extends TaggedError<"InvalidArticleEvidence"> {
  public readonly type = "InvalidArticleEvidence";

  constructor(
    public readonly errors: readonly InvalidArticleEvidenceValueError[],
  ) {
    super("InvalidArticleEvidence");
    this.message = "Article evidence violates domain invariants";
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const contentKinds = new Set<string>([
  "extracted_body",
  "rss_summary",
  "web_snippet",
  "primary_document",
]);

const contentLevels = new Set<string>(["complete", "partial"]);

const isString = (value: unknown): value is string => typeof value === "string";

const invalidValue = (field: ArticleEvidenceField, value: unknown) =>
  new InvalidArticleEvidenceValueError(field, value);

const collectErrors = (
  results: readonly Result<unknown, InvalidArticleEvidenceValueError>[],
) => results.flatMap((result) => (result.ok ? [] : [result.error]));

const createUuid = (
  field: ArticleEvidenceField,
  value: unknown,
): Result<UUID, InvalidArticleEvidenceValueError> => {
  if (!isString(value) || !uuidPattern.test(value.trim())) {
    return err(invalidValue(field, value));
  }

  return ok(value.trim() as UUID);
};

const createNonEmptyText = (
  field: ArticleEvidenceField,
  value: unknown,
): Result<string, InvalidArticleEvidenceValueError> => {
  if (!isString(value) || value.trim() === "") {
    return err(invalidValue(field, value));
  }

  return ok(value.trim());
};

const createArticleUrl = (
  value: unknown,
): Result<ArticleUrl, InvalidArticleEvidenceValueError> => {
  if (!isString(value)) {
    return err(invalidValue("url", value));
  }

  const trimmed = value.trim();

  try {
    const url = new URL(trimmed);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return err(invalidValue("url", value));
    }

    return ok(trimmed as ArticleUrl);
  } catch {
    return err(invalidValue("url", value));
  }
};

const createArticleLanguage = (
  value: unknown,
): Result<LanguageCode, InvalidArticleEvidenceValueError> => {
  const result = createLanguageCode(value);

  return result.ok ? ok(result.value) : err(invalidValue("language", value));
};

const createPublishedAt = (
  value: unknown,
): Result<IsoDateTimeString | undefined, InvalidArticleEvidenceValueError> => {
  if (value === undefined) {
    return ok(undefined);
  }

  const result = createIsoDateTimeString(value);

  return result.ok ? ok(result.value) : err(invalidValue("publishedAt", value));
};

const createContentKind = (
  value: unknown,
): Result<EvidenceContentKind, InvalidArticleEvidenceValueError> => {
  if (!isString(value) || !contentKinds.has(value)) {
    return err(invalidValue("contentKind", value));
  }

  return ok(value as EvidenceContentKind);
};

const createContentLevel = (
  value: unknown,
): Result<EvidenceContentLevel, InvalidArticleEvidenceValueError> => {
  if (!isString(value) || !contentLevels.has(value)) {
    return err(invalidValue("contentLevel", value));
  }

  return ok(value as EvidenceContentLevel);
};

const evidenceLevelMatchesKind = (
  contentKind: EvidenceContentKind,
  contentLevel: EvidenceContentLevel,
) => {
  if (contentKind === "rss_summary" || contentKind === "web_snippet") {
    return contentLevel === "partial";
  }

  if (contentKind === "extracted_body") {
    return contentLevel === "complete";
  }

  return true;
};

export const createArticle = (
  snapshot: ArticleSnapshot,
): Result<Article, InvalidArticleEvidenceError> => {
  const id = createUuid("id", snapshot.id);
  const sourceId = createUuid("sourceId", snapshot.sourceId);
  const url = createArticleUrl(snapshot.url);
  const title = createNonEmptyText("title", snapshot.title);
  const language = createArticleLanguage(snapshot.language);
  const publishedAt = createPublishedAt(snapshot.publishedAt);

  if (
    !id.ok ||
    !sourceId.ok ||
    !url.ok ||
    !title.ok ||
    !language.ok ||
    !publishedAt.ok
  ) {
    return err(
      new InvalidArticleEvidenceError(
        collectErrors([id, sourceId, url, title, language, publishedAt]),
      ),
    );
  }

  return ok({
    id: id.value,
    sourceId: sourceId.value,
    url: url.value,
    title: title.value,
    language: language.value,
    publishedAt: publishedAt.value,
  });
};

export const toArticleSnapshot = (article: Article): ArticleSnapshot => ({
  id: article.id,
  sourceId: article.sourceId,
  url: article.url,
  title: article.title,
  language: article.language,
  publishedAt: article.publishedAt,
});

export const createEvidenceFragment = (
  snapshot: EvidenceFragmentSnapshot,
): Result<EvidenceFragment, InvalidArticleEvidenceError> => {
  const id = createUuid("id", snapshot.id);
  const text = createNonEmptyText("text", snapshot.text);
  const articleId = createUuid("articleId", snapshot.provenance.articleId);
  const sourceId = createUuid("sourceId", snapshot.provenance.sourceId);
  const url = createArticleUrl(snapshot.provenance.url);
  const contentKind = createContentKind(snapshot.provenance.contentKind);
  const contentLevel = createContentLevel(snapshot.quality.contentLevel);

  if (
    !id.ok ||
    !text.ok ||
    !articleId.ok ||
    !sourceId.ok ||
    !url.ok ||
    !contentKind.ok ||
    !contentLevel.ok
  ) {
    return err(
      new InvalidArticleEvidenceError(
        collectErrors([
          id,
          text,
          articleId,
          sourceId,
          url,
          contentKind,
          contentLevel,
        ]),
      ),
    );
  }

  if (!evidenceLevelMatchesKind(contentKind.value, contentLevel.value)) {
    return err(
      new InvalidArticleEvidenceError([
        invalidValue("quality", {
          contentKind: contentKind.value,
          contentLevel: contentLevel.value,
        }),
      ]),
    );
  }

  return ok({
    id: id.value,
    text: text.value,
    provenance: {
      articleId: articleId.value,
      sourceId: sourceId.value,
      url: url.value,
      contentKind: contentKind.value,
    },
    quality: {
      contentLevel: contentLevel.value,
    },
  });
};

export const toEvidenceFragmentSnapshot = (
  evidence: EvidenceFragment,
): EvidenceFragmentSnapshot => ({
  id: evidence.id,
  text: evidence.text,
  provenance: {
    articleId: evidence.provenance.articleId,
    sourceId: evidence.provenance.sourceId,
    url: evidence.provenance.url,
    contentKind: evidence.provenance.contentKind,
  },
  quality: {
    contentLevel: evidence.quality.contentLevel,
  },
});

export const createArticleStatement = (
  snapshot: ArticleStatementSnapshot,
): Result<ArticleStatement, InvalidArticleEvidenceError> => {
  const id = createUuid("id", snapshot.id);
  const text = createNonEmptyText("text", snapshot.text);
  const attribution = createNonEmptyText("attribution", snapshot.attribution);
  const evidenceFragmentId = createUuid(
    "evidenceFragmentId",
    snapshot.originReference.evidenceFragmentId,
  );

  if (!id.ok || !text.ok || !attribution.ok || !evidenceFragmentId.ok) {
    return err(
      new InvalidArticleEvidenceError(
        collectErrors([id, text, attribution, evidenceFragmentId]),
      ),
    );
  }

  return ok({
    id: id.value,
    text: text.value,
    attribution: attribution.value,
    originReference: {
      evidenceFragmentId: evidenceFragmentId.value,
    },
  });
};
