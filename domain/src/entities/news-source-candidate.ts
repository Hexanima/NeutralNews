import { TaggedError } from "../types/error.js";
import { err, ok, type Result } from "../types/result.js";
import type { IsoDateTimeString } from "./news-source.js";

export interface NewsSourceCandidate {
  readonly domain: string;
  readonly orientation: "sin_clasificar";
  readonly active: false;
  readonly approvalStatus: "pending_review";
  readonly firstSeenAt: IsoDateTimeString;
  readonly lastSeenAt: IsoDateTimeString;
}

export interface NewsSourceCandidateSnapshot {
  readonly domain: string;
  readonly orientation: string;
  readonly active: boolean;
  readonly approvalStatus: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

export type NewsSourceCandidateField = keyof NewsSourceCandidateSnapshot;

export class InvalidNewsSourceCandidateValueError extends TaggedError<"InvalidNewsSourceCandidateValue"> {
  public readonly type = "InvalidNewsSourceCandidateValue";

  constructor(
    public readonly field: NewsSourceCandidateField,
    public readonly value: unknown,
  ) {
    super("InvalidNewsSourceCandidateValue");
    this.message = `Invalid news source candidate ${field}`;
  }
}

export class InvalidNewsSourceCandidateError extends TaggedError<"InvalidNewsSourceCandidate"> {
  public readonly type = "InvalidNewsSourceCandidate";

  constructor(
    public readonly errors: readonly InvalidNewsSourceCandidateValueError[],
  ) {
    super("InvalidNewsSourceCandidate");
    this.message = "News source candidate violates domain invariants";
  }
}

const invalidValue = (field: NewsSourceCandidateField, value: unknown) =>
  new InvalidNewsSourceCandidateValueError(field, value);

const createDomain = (
  value: unknown,
): Result<string, InvalidNewsSourceCandidateValueError> => {
  if (typeof value !== "string") {
    return err(invalidValue("domain", value));
  }

  const domain = value.trim().toLowerCase().replace(/[.]$/, "");

  try {
    return domain !== "" && new URL(`https://${domain}`).hostname === domain
      ? ok(domain)
      : err(invalidValue("domain", value));
  } catch {
    return err(invalidValue("domain", value));
  }
};

const createDate = (
  field: "firstSeenAt" | "lastSeenAt",
  value: unknown,
): Result<IsoDateTimeString, InvalidNewsSourceCandidateValueError> => {
  if (typeof value !== "string") {
    return err(invalidValue(field, value));
  }

  const date = new Date(value.trim());

  return value.trim() !== "" && !Number.isNaN(date.getTime()) && date.toISOString() === value.trim()
    ? ok(value.trim() as IsoDateTimeString)
    : err(invalidValue(field, value));
};

export const createNewsSourceCandidate = (
  snapshot: NewsSourceCandidateSnapshot,
): Result<NewsSourceCandidate, InvalidNewsSourceCandidateError> => {
  const domain = createDomain(snapshot.domain);
  const firstSeenAt = createDate("firstSeenAt", snapshot.firstSeenAt);
  const lastSeenAt = createDate("lastSeenAt", snapshot.lastSeenAt);
  if (!domain.ok || !firstSeenAt.ok || !lastSeenAt.ok) {
    return err(new InvalidNewsSourceCandidateError([
      ...(domain.ok ? [] : [domain.error]),
      ...(firstSeenAt.ok ? [] : [firstSeenAt.error]),
      ...(lastSeenAt.ok ? [] : [lastSeenAt.error]),
    ]));
  }

  const invariantErrors = [
    ...(snapshot.orientation === "sin_clasificar" ? [] : [invalidValue("orientation", snapshot.orientation)]),
    ...(snapshot.active === false ? [] : [invalidValue("active", snapshot.active)]),
    ...(snapshot.approvalStatus === "pending_review" ? [] : [invalidValue("approvalStatus", snapshot.approvalStatus)]),
  ];

  if (invariantErrors.length > 0) {
    return err(new InvalidNewsSourceCandidateError(invariantErrors));
  }

  if (firstSeenAt.value > lastSeenAt.value) {
    return err(new InvalidNewsSourceCandidateError([
      invalidValue("lastSeenAt", snapshot.lastSeenAt),
    ]));
  }

  return ok({
    domain: domain.value,
    orientation: "sin_clasificar",
    active: false,
    approvalStatus: "pending_review",
    firstSeenAt: firstSeenAt.value,
    lastSeenAt: lastSeenAt.value,
  });
};

export const toNewsSourceCandidateSnapshot = (
  candidate: NewsSourceCandidate,
): NewsSourceCandidateSnapshot => ({
  domain: candidate.domain,
  orientation: candidate.orientation,
  active: candidate.active,
  approvalStatus: candidate.approvalStatus,
  firstSeenAt: candidate.firstSeenAt,
  lastSeenAt: candidate.lastSeenAt,
});
