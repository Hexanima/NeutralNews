import { TaggedError } from "../types/error.js";
import { err, ok, type Result } from "../types/result.js";
import type { UUID } from "../types/uuid.js";

declare const countryCodeBrand: unique symbol;
declare const languageCodeBrand: unique symbol;
declare const isoDateTimeStringBrand: unique symbol;

export type CountryCode = string & { readonly [countryCodeBrand]: true };
export type LanguageCode = string & { readonly [languageCodeBrand]: true };
export type IsoDateTimeString = string & {
  readonly [isoDateTimeStringBrand]: true;
};

export type NewsSourceOrientation =
  | "izquierda"
  | "centroizquierda"
  | "center"
  | "centroderecha"
  | "derecha"
  | "sin_clasificar";

export type NewsSourceType = "media" | "agency" | "primary_source";

export type NewsSourceRegion =
  | "argentina"
  | "latin_america"
  | "international";

export type NewsSourceApprovalStatus =
  | "pending_review"
  | "approved"
  | "rejected";

export interface NewsSource {
  id: UUID;
  name: string;
  orientation: NewsSourceOrientation;
  type: NewsSourceType;
  region: NewsSourceRegion;
  country: CountryCode;
  language: LanguageCode;
  active: boolean;
  approvalStatus: NewsSourceApprovalStatus;
  reviewedAt: IsoDateTimeString;
}

export interface NewsSourceSnapshot {
  id: string;
  name: string;
  orientation: string;
  type: string;
  region: string;
  country: string;
  language: string;
  active: boolean;
  approvalStatus: string;
  reviewedAt: string;
}

export type NewsSourceField = keyof NewsSourceSnapshot;

export class InvalidSourceValueError extends TaggedError<"InvalidSourceValue"> {
  public readonly type = "InvalidSourceValue";

  constructor(
    public readonly field: NewsSourceField,
    public readonly value: unknown,
  ) {
    super("InvalidSourceValue");
    this.message = `Invalid news source ${field}`;
  }
}

export class InvalidNewsSourceError extends TaggedError<"InvalidNewsSource"> {
  public readonly type = "InvalidNewsSource";

  constructor(public readonly errors: readonly InvalidSourceValueError[]) {
    super("InvalidNewsSource");
    this.message = "News source violates domain invariants";
  }
}

const orientations = new Set<string>([
  "izquierda",
  "centroizquierda",
  "center",
  "centroderecha",
  "derecha",
  "sin_clasificar",
]);

const sourceTypes = new Set<string>(["media", "agency", "primary_source"]);

const regions = new Set<string>([
  "argentina",
  "latin_america",
  "international",
]);

const approvalStatuses = new Set<string>([
  "pending_review",
  "approved",
  "rejected",
]);

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const countryCodePattern = /^[A-Z]{2}$/;
const languageCodePattern = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;

const invalidValue = (field: NewsSourceField, value: unknown) =>
  new InvalidSourceValueError(field, value);

const isString = (value: unknown): value is string => typeof value === "string";

export const createCountryCode = (
  value: unknown,
): Result<CountryCode, InvalidSourceValueError> => {
  if (!isString(value)) {
    return err(invalidValue("country", value));
  }

  const normalized = value.trim().toUpperCase();

  if (!countryCodePattern.test(normalized)) {
    return err(invalidValue("country", value));
  }

  return ok(normalized as CountryCode);
};

export const createLanguageCode = (
  value: unknown,
): Result<LanguageCode, InvalidSourceValueError> => {
  if (!isString(value)) {
    return err(invalidValue("language", value));
  }

  const normalized = value.trim().toLowerCase();

  if (!languageCodePattern.test(normalized)) {
    return err(invalidValue("language", value));
  }

  return ok(normalized as LanguageCode);
};

export const createIsoDateTimeString = (
  value: unknown,
): Result<IsoDateTimeString, InvalidSourceValueError> => {
  if (!isString(value)) {
    return err(invalidValue("reviewedAt", value));
  }

  const trimmed = value.trim();
  const parsed = Date.parse(trimmed);

  if (
    trimmed === "" ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString() !== trimmed
  ) {
    return err(invalidValue("reviewedAt", value));
  }

  return ok(trimmed as IsoDateTimeString);
};

const createUuid = (value: unknown): Result<UUID, InvalidSourceValueError> => {
  if (!isString(value) || !uuidPattern.test(value.trim())) {
    return err(invalidValue("id", value));
  }

  return ok(value.trim() as UUID);
};

const createName = (
  value: unknown,
): Result<string, InvalidSourceValueError> => {
  if (!isString(value) || value.trim() === "") {
    return err(invalidValue("name", value));
  }

  return ok(value.trim());
};

const createOrientation = (
  value: unknown,
): Result<NewsSourceOrientation, InvalidSourceValueError> => {
  if (!isString(value) || !orientations.has(value)) {
    return err(invalidValue("orientation", value));
  }

  return ok(value as NewsSourceOrientation);
};

const createType = (
  value: unknown,
): Result<NewsSourceType, InvalidSourceValueError> => {
  if (!isString(value) || !sourceTypes.has(value)) {
    return err(invalidValue("type", value));
  }

  return ok(value as NewsSourceType);
};

const createRegion = (
  value: unknown,
): Result<NewsSourceRegion, InvalidSourceValueError> => {
  if (!isString(value) || !regions.has(value)) {
    return err(invalidValue("region", value));
  }

  return ok(value as NewsSourceRegion);
};

const createActive = (
  value: unknown,
): Result<boolean, InvalidSourceValueError> => {
  if (typeof value !== "boolean") {
    return err(invalidValue("active", value));
  }

  return ok(value);
};

const createApprovalStatus = (
  value: unknown,
): Result<NewsSourceApprovalStatus, InvalidSourceValueError> => {
  if (!isString(value) || !approvalStatuses.has(value)) {
    return err(invalidValue("approvalStatus", value));
  }

  return ok(value as NewsSourceApprovalStatus);
};

export const createNewsSource = (
  snapshot: NewsSourceSnapshot,
): Result<NewsSource, InvalidNewsSourceError> => {
  const id = createUuid(snapshot.id);
  const name = createName(snapshot.name);
  const orientation = createOrientation(snapshot.orientation);
  const type = createType(snapshot.type);
  const region = createRegion(snapshot.region);
  const country = createCountryCode(snapshot.country);
  const language = createLanguageCode(snapshot.language);
  const active = createActive(snapshot.active);
  const approvalStatus = createApprovalStatus(snapshot.approvalStatus);
  const reviewedAt = createIsoDateTimeString(snapshot.reviewedAt);

  if (
    !id.ok ||
    !name.ok ||
    !orientation.ok ||
    !type.ok ||
    !region.ok ||
    !country.ok ||
    !language.ok ||
    !active.ok ||
    !approvalStatus.ok ||
    !reviewedAt.ok
  ) {
    const errors = [
      id,
      name,
      orientation,
      type,
      region,
      country,
      language,
      active,
      approvalStatus,
      reviewedAt,
    ].flatMap((result) => (result.ok ? [] : [result.error]));

    return err(new InvalidNewsSourceError(errors));
  }

  return ok({
    id: id.value,
    name: name.value,
    orientation: orientation.value,
    type: type.value,
    region: region.value,
    country: country.value,
    language: language.value,
    active: active.value,
    approvalStatus: approvalStatus.value,
    reviewedAt: reviewedAt.value,
  });
};

export const toNewsSourceSnapshot = (
  source: NewsSource,
): NewsSourceSnapshot => ({
  id: source.id,
  name: source.name,
  orientation: source.orientation,
  type: source.type,
  region: source.region,
  country: source.country,
  language: source.language,
  active: source.active,
  approvalStatus: source.approvalStatus,
  reviewedAt: source.reviewedAt,
});
