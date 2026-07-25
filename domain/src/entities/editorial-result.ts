import { TaggedError } from "../types/error.js";
import { err, ok, type Result } from "../types/result.js";
import type { UUID } from "../types/uuid.js";
import { createIsoDateTimeString } from "./news-source.js";
import type { IsoDateTimeString } from "./news-source.js";

export type EditorialWarningKind =
  | "insufficient_evidence"
  | "partial_coverage"
  | "asymmetric_coverage";

export type FeedResultStatus =
  | "fresh"
  | "stale"
  | "generating"
  | "partial"
  | "failed";

export interface EditorialWarning {
  kind: EditorialWarningKind;
  message: string;
  sourceIds?: readonly UUID[] | undefined;
  evidenceFragmentIds?: readonly UUID[] | undefined;
}

export interface EditorialWarningSnapshot {
  kind: string;
  message: string;
  sourceIds?: readonly string[] | undefined;
  evidenceFragmentIds?: readonly string[] | undefined;
}

export interface EditorialSourceReference {
  sourceId: UUID;
  evidenceFragmentIds: readonly UUID[];
}

export interface EditorialSourceReferenceSnapshot {
  sourceId: string;
  evidenceFragmentIds: readonly string[];
}

export interface EditorialClaim {
  id: UUID;
  text: string;
  sourceIds: readonly UUID[];
  evidenceFragmentIds: readonly UUID[];
}

export interface EditorialClaimSnapshot {
  id: string;
  text: string;
  sourceIds: readonly string[];
  evidenceFragmentIds: readonly string[];
}

export interface TriangulationResult {
  summary: string;
  matches: readonly EditorialClaim[];
  divergences: readonly EditorialClaim[];
  sources: readonly EditorialSourceReference[];
  warnings: readonly EditorialWarning[];
}

export interface TriangulationResultSnapshot {
  summary: string;
  matches: readonly EditorialClaimSnapshot[];
  divergences: readonly EditorialClaimSnapshot[];
  sources: readonly EditorialSourceReferenceSnapshot[];
  warnings: readonly EditorialWarningSnapshot[];
}

export interface RewriteChange {
  id: UUID;
  originalText: string;
  neutralText: string;
  justification: string;
}

export interface RewriteChangeSnapshot {
  id: string;
  originalText: string;
  neutralText: string;
  justification: string;
}

export interface RewriteResult {
  neutralText: string;
  changes: readonly RewriteChange[];
  warnings: readonly EditorialWarning[];
}

export interface RewriteResultSnapshot {
  neutralText: string;
  changes: readonly RewriteChangeSnapshot[];
  warnings: readonly EditorialWarningSnapshot[];
}

export interface FactualContextPoint {
  id: UUID;
  text: string;
  evidenceFragmentIds: readonly UUID[];
}

export interface FactualContextPointSnapshot {
  id: string;
  text: string;
  evidenceFragmentIds: readonly string[];
}

export interface FactualContext {
  summary: string;
  points: readonly FactualContextPoint[];
}

export interface FactualContextSnapshot {
  summary: string;
  points: readonly FactualContextPointSnapshot[];
}

export interface ContextResult {
  factualContext: FactualContext;
  mediaCoverage: TriangulationResult;
  warnings: readonly EditorialWarning[];
}

export interface ContextResultSnapshot {
  factualContext: FactualContextSnapshot;
  mediaCoverage: TriangulationResultSnapshot;
  warnings: readonly EditorialWarningSnapshot[];
}

export interface FeedTopicResult {
  id: UUID;
  title: string;
  summary: string;
  result?: TriangulationResult | undefined;
  warnings: readonly EditorialWarning[];
}

export interface FeedTopicResultSnapshot {
  id: string;
  title: string;
  summary: string;
  result?: TriangulationResultSnapshot | undefined;
  warnings: readonly EditorialWarningSnapshot[];
}

export interface FeedResult {
  generatedAt: IsoDateTimeString;
  status: FeedResultStatus;
  topics: readonly FeedTopicResult[];
  warnings: readonly EditorialWarning[];
}

export interface FeedResultSnapshot {
  generatedAt: string;
  status: string;
  topics: readonly FeedTopicResultSnapshot[];
  warnings: readonly EditorialWarningSnapshot[];
}

export type EditorialResultField =
  | "id"
  | "summary"
  | "matches"
  | "divergences"
  | "sources"
  | "warnings"
  | "kind"
  | "message"
  | "sourceIds"
  | "sourceId"
  | "evidenceFragmentIds"
  | "text"
  | "neutralText"
  | "originalText"
  | "justification"
  | "changes"
  | "factualContext"
  | "mediaCoverage"
  | "points"
  | "generatedAt"
  | "status"
  | "topics"
  | "title"
  | "result";

export class InvalidEditorialResultValueError extends TaggedError<"InvalidEditorialResultValue"> {
  public readonly type = "InvalidEditorialResultValue";

  constructor(
    public readonly field: EditorialResultField,
    public readonly value: unknown,
  ) {
    super("InvalidEditorialResultValue");
    this.message = `Invalid editorial result ${field}`;
  }
}

export class InvalidEditorialResultError extends TaggedError<"InvalidEditorialResult"> {
  public readonly type = "InvalidEditorialResult";

  constructor(public readonly errors: readonly InvalidEditorialResultValueError[]) {
    super("InvalidEditorialResult");
    this.message = "Editorial result violates domain invariants";
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const warningKinds = new Set<string>([
  "insufficient_evidence",
  "partial_coverage",
  "asymmetric_coverage",
]);

const feedStatuses = new Set<string>([
  "fresh",
  "stale",
  "generating",
  "partial",
  "failed",
]);

type UnknownRecord = Record<string, unknown>;

interface ValidationOk<TResult> {
  ok: true;
  value: TResult;
}

interface ValidationErr {
  ok: false;
  errors: readonly InvalidEditorialResultValueError[];
}

type Validation<TResult> = ValidationOk<TResult> | ValidationErr;

const isString = (value: unknown): value is string => typeof value === "string";

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const invalidValue = (field: EditorialResultField, value: unknown) =>
  new InvalidEditorialResultValueError(field, value);

const collectErrors = (
  results: readonly Result<unknown, InvalidEditorialResultValueError>[],
) => results.flatMap((result) => (result.ok ? [] : [result.error]));

const valid = <TResult>(value: TResult): ValidationOk<TResult> => ({
  ok: true,
  value,
});

const invalid = (
  errors: readonly InvalidEditorialResultValueError[],
): ValidationErr => ({
  ok: false,
  errors,
});

const resultValue = <TResult, TError extends TaggedError>(
  result: Result<TResult, TError>,
): TResult => {
  if (!result.ok) {
    throw new Error("Tried to read an invalid Result value");
  }

  return result.value;
};

const validationValue = <TResult>(result: Validation<TResult>): TResult => {
  if (!result.ok) {
    throw new Error("Tried to read an invalid validation value");
  }

  return result.value;
};

const createUuid = (
  field: EditorialResultField,
  value: unknown,
): Result<UUID, InvalidEditorialResultValueError> => {
  if (!isString(value) || !uuidPattern.test(value.trim())) {
    return err(invalidValue(field, value));
  }

  return ok(value.trim() as UUID);
};

const createNonEmptyText = (
  field: EditorialResultField,
  value: unknown,
): Result<string, InvalidEditorialResultValueError> => {
  if (!isString(value) || value.trim() === "") {
    return err(invalidValue(field, value));
  }

  return ok(value.trim());
};

const createArray = (
  field: EditorialResultField,
  value: unknown,
): Result<readonly unknown[], InvalidEditorialResultValueError> =>
  Array.isArray(value) ? ok(value) : err(invalidValue(field, value));

const createRecord = (
  field: EditorialResultField,
  value: unknown,
): Result<UnknownRecord, InvalidEditorialResultValueError> =>
  isRecord(value) ? ok(value) : err(invalidValue(field, value));

const createIsoDateTime = (
  value: unknown,
): Result<IsoDateTimeString, InvalidEditorialResultValueError> => {
  const result = createIsoDateTimeString(value);

  return result.ok ? ok(resultValue(result)) : err(invalidValue("generatedAt", value));
};

const createWarningKind = (
  value: unknown,
): Result<EditorialWarningKind, InvalidEditorialResultValueError> => {
  if (!isString(value) || !warningKinds.has(value)) {
    return err(invalidValue("kind", value));
  }

  return ok(value as EditorialWarningKind);
};

const createFeedStatus = (
  value: unknown,
): Result<FeedResultStatus, InvalidEditorialResultValueError> => {
  if (!isString(value) || !feedStatuses.has(value)) {
    return err(invalidValue("status", value));
  }

  return ok(value as FeedResultStatus);
};

const createUuidArray = (
  field: "sourceIds" | "evidenceFragmentIds",
  value: unknown,
): Validation<readonly UUID[]> => {
  const source = createArray(field, value);

  if (!source.ok) {
    return invalid([source.error]);
  }

  const ids = source.value.map((candidate) => createUuid(field, candidate));
  const errors = collectErrors(ids);

  if (errors.length > 0) {
    return invalid(errors);
  }

  return valid(ids.map((id) => resultValue(id)));
};

const validateKnownIds = (
  field: "sourceIds" | "evidenceFragmentIds",
  ids: readonly UUID[] | undefined,
  knownIds?: ReadonlySet<string>,
): readonly InvalidEditorialResultValueError[] => {
  if (ids === undefined || knownIds === undefined) {
    return [];
  }

  return ids.flatMap((id) => (knownIds.has(id) ? [] : [invalidValue(field, id)]));
};

const createOptionalUuidArray = (
  field: "sourceIds" | "evidenceFragmentIds",
  value: unknown,
): Validation<readonly UUID[] | undefined> => {
  if (value === undefined) {
    return valid(undefined);
  }

  return createUuidArray(field, value);
};

const createEditorialWarning = (
  snapshot: EditorialWarningSnapshot,
  knownSourceIds?: ReadonlySet<string>,
  knownEvidenceFragmentIds?: ReadonlySet<string>,
): Result<EditorialWarning, InvalidEditorialResultError> => {
  const record = createRecord("warnings", snapshot);

  if (!record.ok) {
    return err(new InvalidEditorialResultError([record.error]));
  }

  const warningValue = record.value;
  const kind = createWarningKind(warningValue.kind);
  const message = createNonEmptyText("message", warningValue.message);
  const sourceIds = createOptionalUuidArray("sourceIds", warningValue.sourceIds);
  const evidenceFragmentIds = createOptionalUuidArray(
    "evidenceFragmentIds",
    warningValue.evidenceFragmentIds,
  );

  const valueErrors = [
    ...collectErrors([kind, message]),
    ...(sourceIds.ok ? [] : sourceIds.errors),
    ...(evidenceFragmentIds.ok ? [] : evidenceFragmentIds.errors),
  ];

  if (valueErrors.length > 0) {
    return err(new InvalidEditorialResultError(valueErrors));
  }

  const referenceErrors = [
    ...validateKnownIds("sourceIds", validationValue(sourceIds), knownSourceIds),
    ...validateKnownIds(
      "evidenceFragmentIds",
      validationValue(evidenceFragmentIds),
      knownEvidenceFragmentIds,
    ),
  ];

  if (referenceErrors.length > 0) {
    return err(new InvalidEditorialResultError(referenceErrors));
  }

  return ok({
    kind: resultValue(kind),
    message: resultValue(message),
    sourceIds: validationValue(sourceIds),
    evidenceFragmentIds: validationValue(evidenceFragmentIds),
  });
};

const createEditorialWarnings = (
  value: unknown,
  knownSourceIds?: ReadonlySet<string>,
  knownEvidenceFragmentIds?: ReadonlySet<string>,
): Result<readonly EditorialWarning[], InvalidEditorialResultError> => {
  const warnings = createArray("warnings", value);

  if (!warnings.ok) {
    return err(new InvalidEditorialResultError([warnings.error]));
  }

  const created = resultValue(warnings).map((warning) =>
    createEditorialWarning(
      warning as EditorialWarningSnapshot,
      knownSourceIds,
      knownEvidenceFragmentIds,
    ),
  );
  const errors = created.flatMap((result) =>
    result.ok ? [] : result.error.errors,
  );

  if (errors.length > 0) {
    return err(new InvalidEditorialResultError(errors));
  }

  return ok(created.map((result) => resultValue(result)));
};

const createSourceReference = (
  snapshot: EditorialSourceReferenceSnapshot,
): Result<EditorialSourceReference, InvalidEditorialResultError> => {
  const record = createRecord("sources", snapshot);

  if (!record.ok) {
    return err(new InvalidEditorialResultError([record.error]));
  }

  const sourceValue = record.value;
  const sourceId = createUuid("sourceId", sourceValue.sourceId);
  const evidenceFragmentIds = createUuidArray(
    "evidenceFragmentIds",
    sourceValue.evidenceFragmentIds,
  );
  const errors = [
    ...collectErrors([sourceId]),
    ...(evidenceFragmentIds.ok ? [] : evidenceFragmentIds.errors),
  ];

  if (errors.length > 0) {
    return err(new InvalidEditorialResultError(errors));
  }

  return ok({
    sourceId: resultValue(sourceId),
    evidenceFragmentIds: validationValue(evidenceFragmentIds),
  });
};

const createSourceReferences = (
  value: unknown,
): Result<readonly EditorialSourceReference[], InvalidEditorialResultError> => {
  const sources = createArray("sources", value);

  if (!sources.ok) {
    return err(new InvalidEditorialResultError([sources.error]));
  }

  const created = resultValue(sources).map((source) =>
    createSourceReference(source as EditorialSourceReferenceSnapshot),
  );
  const errors = created.flatMap((result) =>
    result.ok ? [] : result.error.errors,
  );

  if (errors.length > 0) {
    return err(new InvalidEditorialResultError(errors));
  }

  return ok(created.map((result) => resultValue(result)));
};

const createEditorialClaim = (
  snapshot: EditorialClaimSnapshot,
  knownSourceIds: ReadonlySet<string>,
  knownEvidenceFragmentIds: ReadonlySet<string>,
): Result<EditorialClaim, InvalidEditorialResultError> => {
  const record = createRecord("result", snapshot);

  if (!record.ok) {
    return err(new InvalidEditorialResultError([record.error]));
  }

  const claimValue = record.value;
  const id = createUuid("id", claimValue.id);
  const text = createNonEmptyText("text", claimValue.text);
  const sourceIds = createUuidArray("sourceIds", claimValue.sourceIds);
  const evidenceFragmentIds = createUuidArray(
    "evidenceFragmentIds",
    claimValue.evidenceFragmentIds,
  );
  const valueErrors = [
    ...collectErrors([id, text]),
    ...(sourceIds.ok ? [] : sourceIds.errors),
    ...(evidenceFragmentIds.ok ? [] : evidenceFragmentIds.errors),
  ];

  if (valueErrors.length > 0) {
    return err(new InvalidEditorialResultError(valueErrors));
  }

  const referenceErrors = [
    ...validateKnownIds("sourceIds", validationValue(sourceIds), knownSourceIds),
    ...validateKnownIds(
      "evidenceFragmentIds",
      validationValue(evidenceFragmentIds),
      knownEvidenceFragmentIds,
    ),
  ];

  if (validationValue(sourceIds).length === 0) {
    referenceErrors.push(invalidValue("sourceIds", validationValue(sourceIds)));
  }

  if (validationValue(evidenceFragmentIds).length === 0) {
    referenceErrors.push(
      invalidValue("evidenceFragmentIds", validationValue(evidenceFragmentIds)),
    );
  }

  if (referenceErrors.length > 0) {
    return err(new InvalidEditorialResultError(referenceErrors));
  }

  return ok({
    id: resultValue(id),
    text: resultValue(text),
    sourceIds: validationValue(sourceIds),
    evidenceFragmentIds: validationValue(evidenceFragmentIds),
  });
};

const createEditorialClaims = (
  field: "matches" | "divergences",
  value: unknown,
  knownSourceIds: ReadonlySet<string>,
  knownEvidenceFragmentIds: ReadonlySet<string>,
): Result<readonly EditorialClaim[], InvalidEditorialResultError> => {
  const claims = createArray(field, value);

  if (!claims.ok) {
    return err(new InvalidEditorialResultError([claims.error]));
  }

  const created = claims.value.map((claim) =>
    createEditorialClaim(
      claim as EditorialClaimSnapshot,
      knownSourceIds,
      knownEvidenceFragmentIds,
    ),
  );
  const errors = created.flatMap((result) =>
    result.ok ? [] : result.error.errors,
  );

  if (errors.length > 0) {
    return err(new InvalidEditorialResultError(errors));
  }

  return ok(created.map((result) => resultValue(result)));
};

const hasPartialTriangulationWarning = (
  warnings: readonly EditorialWarning[],
): boolean =>
  warnings.some(
    (warning) =>
      warning.kind === "insufficient_evidence" ||
      warning.kind === "partial_coverage",
  );

export const createTriangulationResult = (
  snapshot: TriangulationResultSnapshot,
): Result<TriangulationResult, InvalidEditorialResultError> => {
  const summary = createNonEmptyText("summary", snapshot.summary);
  const sources = createSourceReferences(snapshot.sources);
  const sourceValues = sources.ok ? resultValue(sources) : [];
  const knownSourceIds = new Set(sourceValues.map((source) => source.sourceId));
  const knownEvidenceFragmentIds = new Set(
    sourceValues.flatMap((source) => source.evidenceFragmentIds),
  );
  const matches = createEditorialClaims(
    "matches",
    snapshot.matches,
    knownSourceIds,
    knownEvidenceFragmentIds,
  );
  const divergences = createEditorialClaims(
    "divergences",
    snapshot.divergences,
    knownSourceIds,
    knownEvidenceFragmentIds,
  );
  const warnings = createEditorialWarnings(
    snapshot.warnings,
    knownSourceIds,
    knownEvidenceFragmentIds,
  );
  const valueErrors = [
    ...collectErrors([summary]),
    ...(sources.ok ? [] : sources.error.errors),
    ...(matches.ok ? [] : matches.error.errors),
    ...(divergences.ok ? [] : divergences.error.errors),
    ...(warnings.ok ? [] : warnings.error.errors),
  ];

  if (valueErrors.length > 0) {
    return err(new InvalidEditorialResultError(valueErrors));
  }

  const emptyResult =
    resultValue(matches).length === 0 &&
    resultValue(divergences).length === 0 &&
    resultValue(sources).length === 0;

  if (emptyResult && !hasPartialTriangulationWarning(resultValue(warnings))) {
    return err(
      new InvalidEditorialResultError([
        invalidValue("warnings", snapshot.warnings),
      ]),
    );
  }

  return ok({
    summary: resultValue(summary),
    matches: resultValue(matches),
    divergences: resultValue(divergences),
    sources: resultValue(sources),
    warnings: resultValue(warnings),
  });
};

export const toTriangulationResultSnapshot = (
  result: TriangulationResult,
): TriangulationResultSnapshot => ({
  summary: result.summary,
  matches: result.matches.map(toEditorialClaimSnapshot),
  divergences: result.divergences.map(toEditorialClaimSnapshot),
  sources: result.sources.map(toEditorialSourceReferenceSnapshot),
  warnings: result.warnings.map(toEditorialWarningSnapshot),
});

const createRewriteChange = (
  snapshot: RewriteChangeSnapshot,
): Result<RewriteChange, InvalidEditorialResultError> => {
  const record = createRecord("changes", snapshot);

  if (!record.ok) {
    return err(new InvalidEditorialResultError([record.error]));
  }

  const changeValue = record.value;
  const id = createUuid("id", changeValue.id);
  const originalText = createNonEmptyText("originalText", changeValue.originalText);
  const neutralText = createNonEmptyText("neutralText", changeValue.neutralText);
  const justification = createNonEmptyText(
    "justification",
    changeValue.justification,
  );
  const errors = collectErrors([id, originalText, neutralText, justification]);

  if (errors.length > 0) {
    return err(new InvalidEditorialResultError(errors));
  }

  return ok({
    id: resultValue(id),
    originalText: resultValue(originalText),
    neutralText: resultValue(neutralText),
    justification: resultValue(justification),
  });
};

const createRewriteChanges = (
  value: unknown,
): Result<readonly RewriteChange[], InvalidEditorialResultError> => {
  const changes = createArray("changes", value);

  if (!changes.ok) {
    return err(new InvalidEditorialResultError([changes.error]));
  }

  const created = resultValue(changes).map((change) =>
    createRewriteChange(change as RewriteChangeSnapshot),
  );
  const errors = created.flatMap((result) =>
    result.ok ? [] : result.error.errors,
  );

  if (errors.length > 0) {
    return err(new InvalidEditorialResultError(errors));
  }

  return ok(created.map((result) => resultValue(result)));
};

export const createRewriteResult = (
  snapshot: RewriteResultSnapshot,
): Result<RewriteResult, InvalidEditorialResultError> => {
  const neutralText = createNonEmptyText("neutralText", snapshot.neutralText);
  const changes = createRewriteChanges(snapshot.changes);
  const warnings = createEditorialWarnings(snapshot.warnings);
  const errors = [
    ...collectErrors([neutralText]),
    ...(changes.ok ? [] : changes.error.errors),
    ...(warnings.ok ? [] : warnings.error.errors),
  ];

  if (errors.length > 0) {
    return err(new InvalidEditorialResultError(errors));
  }

  return ok({
    neutralText: resultValue(neutralText),
    changes: resultValue(changes),
    warnings: resultValue(warnings),
  });
};

export const toRewriteResultSnapshot = (
  result: RewriteResult,
): RewriteResultSnapshot => ({
  neutralText: result.neutralText,
  changes: result.changes.map((change) => ({
    id: change.id,
    originalText: change.originalText,
    neutralText: change.neutralText,
    justification: change.justification,
  })),
  warnings: result.warnings.map(toEditorialWarningSnapshot),
});

const createFactualContextPoint = (
  snapshot: FactualContextPointSnapshot,
  knownEvidenceFragmentIds: ReadonlySet<string>,
): Result<FactualContextPoint, InvalidEditorialResultError> => {
  const record = createRecord("points", snapshot);

  if (!record.ok) {
    return err(new InvalidEditorialResultError([record.error]));
  }

  const pointValue = record.value;
  const id = createUuid("id", pointValue.id);
  const text = createNonEmptyText("text", pointValue.text);
  const evidenceFragmentIds = createUuidArray(
    "evidenceFragmentIds",
    pointValue.evidenceFragmentIds,
  );
  const errors = [
    ...collectErrors([id, text]),
    ...(evidenceFragmentIds.ok ? [] : evidenceFragmentIds.errors),
    ...(evidenceFragmentIds.ok && validationValue(evidenceFragmentIds).length === 0
      ? [invalidValue("evidenceFragmentIds", validationValue(evidenceFragmentIds))]
      : []),
    ...(evidenceFragmentIds.ok
      ? validateKnownIds(
          "evidenceFragmentIds",
          validationValue(evidenceFragmentIds),
          knownEvidenceFragmentIds,
        )
      : []),
  ];

  if (errors.length > 0) {
    return err(new InvalidEditorialResultError(errors));
  }

  return ok({
    id: resultValue(id),
    text: resultValue(text),
    evidenceFragmentIds: validationValue(evidenceFragmentIds),
  });
};

const createFactualContext = (
  snapshot: FactualContextSnapshot,
  knownEvidenceFragmentIds: ReadonlySet<string>,
): Result<FactualContext, InvalidEditorialResultError> => {
  const record = createRecord("factualContext", snapshot);

  if (!record.ok) {
    return err(new InvalidEditorialResultError([record.error]));
  }

  if ("mediaCoverage" in record.value) {
    return err(
      new InvalidEditorialResultError([
        invalidValue("factualContext", snapshot),
      ]),
    );
  }

  const summary = createNonEmptyText("summary", snapshot.summary);
  const points = createArray("points", snapshot.points);

  if (!points.ok) {
    return err(
      new InvalidEditorialResultError([
        ...collectErrors([summary]),
        points.error,
      ]),
    );
  }

  const createdPoints = points.value.map((point) =>
    createFactualContextPoint(
      point as FactualContextPointSnapshot,
      knownEvidenceFragmentIds,
    ),
  );
  const errors = [
    ...collectErrors([summary]),
    ...createdPoints.flatMap((result) =>
      result.ok ? [] : result.error.errors,
    ),
  ];

  if (errors.length > 0) {
    return err(new InvalidEditorialResultError(errors));
  }

  return ok({
    summary: resultValue(summary),
    points: createdPoints.map((result) => resultValue(result)),
  });
};

export const createContextResult = (
  snapshot: ContextResultSnapshot,
): Result<ContextResult, InvalidEditorialResultError> => {
  const mediaCoverage = createTriangulationResult(snapshot.mediaCoverage);
  const knownEvidenceFragmentIds = mediaCoverage.ok
    ? new Set(
        resultValue(mediaCoverage).sources.flatMap(
          (source) => source.evidenceFragmentIds,
        ),
      )
    : new Set<string>();
  const factualContext = createFactualContext(
    snapshot.factualContext,
    knownEvidenceFragmentIds,
  );
  const warnings = createEditorialWarnings(snapshot.warnings);
  const errors = [
    ...(factualContext.ok ? [] : factualContext.error.errors),
    ...(mediaCoverage.ok ? [] : mediaCoverage.error.errors),
    ...(warnings.ok ? [] : warnings.error.errors),
  ];

  if (errors.length > 0) {
    return err(new InvalidEditorialResultError(errors));
  }

  return ok({
    factualContext: resultValue(factualContext),
    mediaCoverage: resultValue(mediaCoverage),
    warnings: resultValue(warnings),
  });
};

export const toContextResultSnapshot = (
  result: ContextResult,
): ContextResultSnapshot => ({
  factualContext: {
    summary: result.factualContext.summary,
    points: result.factualContext.points.map((point) => ({
      id: point.id,
      text: point.text,
      evidenceFragmentIds: point.evidenceFragmentIds,
    })),
  },
  mediaCoverage: toTriangulationResultSnapshot(result.mediaCoverage),
  warnings: result.warnings.map(toEditorialWarningSnapshot),
});

const createFeedTopicResult = (
  snapshot: FeedTopicResultSnapshot,
): Result<FeedTopicResult, InvalidEditorialResultError> => {
  const record = createRecord("topics", snapshot);

  if (!record.ok) {
    return err(new InvalidEditorialResultError([record.error]));
  }

  const topicValue = record.value;
  const id = createUuid("id", topicValue.id);
  const title = createNonEmptyText("title", topicValue.title);
  const summary = createNonEmptyText("summary", topicValue.summary);
  const warnings = createEditorialWarnings(topicValue.warnings);
  const result =
    topicValue.result === undefined
      ? ok(undefined)
      : createTriangulationResult(topicValue.result as TriangulationResultSnapshot);
  const errors = [
    ...collectErrors([id, title, summary]),
    ...(warnings.ok ? [] : warnings.error.errors),
    ...(result.ok ? [] : result.error.errors),
  ];

  if (errors.length > 0) {
    return err(new InvalidEditorialResultError(errors));
  }

  return ok({
    id: resultValue(id),
    title: resultValue(title),
    summary: resultValue(summary),
    result: resultValue(result),
    warnings: resultValue(warnings),
  });
};

const createFeedTopicResults = (
  value: unknown,
): Result<readonly FeedTopicResult[], InvalidEditorialResultError> => {
  const topics = createArray("topics", value);

  if (!topics.ok) {
    return err(new InvalidEditorialResultError([topics.error]));
  }

  const created = resultValue(topics).map((topic) =>
    createFeedTopicResult(topic as FeedTopicResultSnapshot),
  );
  const errors = created.flatMap((result) =>
    result.ok ? [] : result.error.errors,
  );

  if (errors.length > 0) {
    return err(new InvalidEditorialResultError(errors));
  }

  return ok(created.map((result) => resultValue(result)));
};

export const createFeedResult = (
  snapshot: FeedResultSnapshot,
): Result<FeedResult, InvalidEditorialResultError> => {
  const generatedAt = createIsoDateTime(snapshot.generatedAt);
  const status = createFeedStatus(snapshot.status);
  const topics = createFeedTopicResults(snapshot.topics);
  const warnings = createEditorialWarnings(snapshot.warnings);
  const errors = [
    ...collectErrors([generatedAt, status]),
    ...(topics.ok ? [] : topics.error.errors),
    ...(warnings.ok ? [] : warnings.error.errors),
  ];

  if (errors.length > 0) {
    return err(new InvalidEditorialResultError(errors));
  }

  return ok({
    generatedAt: resultValue(generatedAt),
    status: resultValue(status),
    topics: resultValue(topics),
    warnings: resultValue(warnings),
  });
};

export const toFeedResultSnapshot = (result: FeedResult): FeedResultSnapshot => ({
  generatedAt: result.generatedAt,
  status: result.status,
  topics: result.topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    summary: topic.summary,
    result:
      topic.result === undefined
        ? undefined
        : toTriangulationResultSnapshot(topic.result),
    warnings: topic.warnings.map(toEditorialWarningSnapshot),
  })),
  warnings: result.warnings.map(toEditorialWarningSnapshot),
});

const toEditorialClaimSnapshot = (
  claim: EditorialClaim,
): EditorialClaimSnapshot => ({
  id: claim.id,
  text: claim.text,
  sourceIds: claim.sourceIds,
  evidenceFragmentIds: claim.evidenceFragmentIds,
});

const toEditorialSourceReferenceSnapshot = (
  source: EditorialSourceReference,
): EditorialSourceReferenceSnapshot => ({
  sourceId: source.sourceId,
  evidenceFragmentIds: source.evidenceFragmentIds,
});

const toEditorialWarningSnapshot = (
  warning: EditorialWarning,
): EditorialWarningSnapshot => ({
  kind: warning.kind,
  message: warning.message,
  sourceIds: warning.sourceIds,
  evidenceFragmentIds: warning.evidenceFragmentIds,
});
