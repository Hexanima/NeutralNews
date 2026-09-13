import {
  rewriteChangeTypes,
  type RewriteChangeType,
} from "../entities/editorial-result.js";
import { TaggedError } from "../types/error.js";
import { err, ok, type Result } from "../types/result.js";
import type { UUID } from "../types/uuid.js";

export const rewriteOutputSchemaVersion = "1";

export interface RewriteStructuredChange {
  id: UUID;
  type: RewriteChangeType;
  originalText: string;
  neutralText: string;
  justification: string;
}

export interface RewriteStructuredOutput {
  neutralText: string;
  changes: readonly RewriteStructuredChange[];
}

export class InvalidRewriteStructuredOutputError extends TaggedError<"InvalidRewriteStructuredOutput"> {
  public readonly type = "InvalidRewriteStructuredOutput";

  constructor(public readonly field: string) {
    super("InvalidRewriteStructuredOutput");
    this.message = `Invalid rewrite structured output at ${field}`;
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const rewriteChangeTypeSet = new Set<string>(rewriteChangeTypes);

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isExactRecord = (
  value: unknown,
  keys: readonly string[],
): value is UnknownRecord =>
  isRecord(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

const invalid = (field: string) =>
  err(new InvalidRewriteStructuredOutputError(field));

const parseText = (
  value: unknown,
  field: string,
): Result<string, InvalidRewriteStructuredOutputError> =>
  typeof value === "string" && /\S/.test(value)
    ? ok(value)
    : invalid(field);

const parseUuid = (
  value: unknown,
  field: string,
): Result<UUID, InvalidRewriteStructuredOutputError> =>
  typeof value === "string" && uuidPattern.test(value)
    ? ok(value as UUID)
    : invalid(field);

const parseChangeType = (
  value: unknown,
  field: string,
): Result<RewriteChangeType, InvalidRewriteStructuredOutputError> =>
  typeof value === "string" && rewriteChangeTypeSet.has(value)
    ? ok(value as RewriteChangeType)
    : invalid(field);

const parseChange = (
  value: unknown,
  field: string,
): Result<RewriteStructuredChange, InvalidRewriteStructuredOutputError> => {
  if (!isExactRecord(value, ["id", "type", "originalText", "neutralText", "justification"])) {
    return invalid(field);
  }

  const id = parseUuid(value.id, `${field}.id`);
  const type = parseChangeType(value.type, `${field}.type`);
  const originalText = parseText(value.originalText, `${field}.originalText`);
  const neutralText = parseText(value.neutralText, `${field}.neutralText`);
  const justification = parseText(value.justification, `${field}.justification`);

  if (!id.ok || !type.ok || !originalText.ok || !neutralText.ok || !justification.ok) {
    return invalid(field);
  }

  return ok({
    id: id.value,
    type: type.value,
    originalText: originalText.value,
    neutralText: neutralText.value,
    justification: justification.value,
  });
};

export const parseRewriteStructuredOutput = (
  value: unknown,
): Result<RewriteStructuredOutput, InvalidRewriteStructuredOutputError> => {
  if (!isExactRecord(value, ["neutralText", "changes"])) {
    return invalid("root");
  }

  const neutralText = parseText(value.neutralText, "neutralText");

  if (!Array.isArray(value.changes)) {
    return invalid("changes");
  }

  const changes = value.changes.map((change, index) =>
    parseChange(change, `changes[${index}]`),
  );

  if (!neutralText.ok || changes.some((change) => !change.ok)) {
    return invalid("root");
  }

  return ok({
    neutralText: neutralText.value,
    changes: changes.flatMap((change) => change.ok ? [change.value] : []),
  });
};

const uuidSchema = { type: "string", pattern: uuidPattern.source } as const;
const nonEmptyTextSchema = { type: "string", pattern: "\\S" } as const;

export const rewriteOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["neutralText", "changes"],
  properties: {
    neutralText: nonEmptyTextSchema,
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "originalText", "neutralText", "justification"],
        properties: {
          id: uuidSchema,
          type: { type: "string", enum: rewriteChangeTypes },
          originalText: nonEmptyTextSchema,
          neutralText: nonEmptyTextSchema,
          justification: nonEmptyTextSchema,
        },
      },
    },
  },
} as const;
