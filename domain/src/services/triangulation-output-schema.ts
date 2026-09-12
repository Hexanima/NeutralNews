import { TaggedError } from "../types/error.js";
import { err, ok, type Result } from "../types/result.js";
import type { UUID } from "../types/uuid.js";

export const triangulationOutputSchemaVersion = "1";

export type TriangulationStructuredWarningKind =
  | "insufficient_evidence"
  | "partial_coverage"
  | "asymmetric_coverage";

export type TriangulationStructuredRegion =
  | "argentina"
  | "latin_america"
  | "international";

export type TriangulationStructuredOrientation =
  | "izquierda"
  | "centroizquierda"
  | "centro"
  | "centroderecha"
  | "derecha"
  | "sin_clasificar";

export interface TriangulationStructuredCorroboratedClaim {
  text: string;
  sourceIds: readonly UUID[];
  evidenceFragmentIds: readonly UUID[];
}

export interface TriangulationStructuredAttributedStatement {
  text: string;
  attribution: string;
  sourceId: UUID;
  evidenceFragmentIds: readonly UUID[];
}

export interface TriangulationStructuredOutput {
  summary: {
    overview: string;
    corroboratedClaims: readonly TriangulationStructuredCorroboratedClaim[];
    attributedStatements: readonly TriangulationStructuredAttributedStatement[];
  };
  matches: readonly (TriangulationStructuredCorroboratedClaim & {
    id: UUID;
  })[];
  divergences: readonly {
    id: UUID;
    contrast: string;
    positions: readonly {
      sourceId: UUID;
      claim: string;
      evidenceFragmentIds: readonly UUID[];
    }[];
  }[];
  sources: readonly {
    sourceId: UUID;
    evidenceFragmentIds: readonly UUID[];
  }[];
  coverage: {
    regions: readonly {
      region: TriangulationStructuredRegion;
      sourceIds: readonly UUID[];
    }[];
    orientations: readonly {
      orientation: TriangulationStructuredOrientation;
      sourceIds: readonly UUID[];
    }[];
  };
  warnings: readonly {
    kind: TriangulationStructuredWarningKind;
    message: string;
    sourceIds: readonly UUID[];
    evidenceFragmentIds: readonly UUID[];
  }[];
}

export class InvalidTriangulationStructuredOutputError extends TaggedError<"InvalidTriangulationStructuredOutput"> {
  public readonly type = "InvalidTriangulationStructuredOutput";

  constructor(public readonly field: string) {
    super("InvalidTriangulationStructuredOutput");
    this.message = `Invalid triangulation structured output at ${field}`;
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const warningKinds = new Set<TriangulationStructuredWarningKind>([
  "insufficient_evidence",
  "partial_coverage",
  "asymmetric_coverage",
]);

const regions = new Set<TriangulationStructuredRegion>([
  "argentina",
  "latin_america",
  "international",
]);

const orientations = new Set<TriangulationStructuredOrientation>([
  "izquierda",
  "centroizquierda",
  "centro",
  "centroderecha",
  "derecha",
  "sin_clasificar",
]);

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
  err(new InvalidTriangulationStructuredOutputError(field));

const parseText = (
  value: unknown,
  field: string,
): Result<string, InvalidTriangulationStructuredOutputError> =>
  typeof value === "string" && /\S/.test(value)
    ? ok(value)
    : invalid(field);

const parseUuid = (
  value: unknown,
  field: string,
): Result<UUID, InvalidTriangulationStructuredOutputError> =>
  typeof value === "string" && uuidPattern.test(value)
    ? ok(value as UUID)
    : invalid(field);

const parseUuidArray = (
  value: unknown,
  field: string,
  minimum: number,
): Result<readonly UUID[], InvalidTriangulationStructuredOutputError> => {
  if (!Array.isArray(value) || value.length < minimum) {
    return invalid(field);
  }

  const parsed = value.map((candidate, index) => parseUuid(candidate, `${field}[${index}]`));

  if (parsed.some((result) => !result.ok)) {
    return invalid(field);
  }

  const ids = parsed.flatMap((result) => (result.ok ? [result.value] : []));

  return new Set(ids).size === ids.length ? ok(ids) : invalid(field);
};

const parseArray = <TValue>(
  value: unknown,
  field: string,
  parse: (candidate: unknown, field: string) => Result<TValue, InvalidTriangulationStructuredOutputError>,
): Result<readonly TValue[], InvalidTriangulationStructuredOutputError> => {
  if (!Array.isArray(value)) {
    return invalid(field);
  }

  const parsed = value.map((candidate, index) => parse(candidate, `${field}[${index}]`));

  if (parsed.some((result) => !result.ok)) {
    return invalid(field);
  }

  return ok(parsed.flatMap((result) => (result.ok ? [result.value] : [])));
};

const parseCorroboratedClaim = (
  value: unknown,
  field: string,
): Result<TriangulationStructuredCorroboratedClaim, InvalidTriangulationStructuredOutputError> => {
  if (!isExactRecord(value, ["text", "sourceIds", "evidenceFragmentIds"])) {
    return invalid(field);
  }

  const text = parseText(value.text, `${field}.text`);
  const sourceIds = parseUuidArray(value.sourceIds, `${field}.sourceIds`, 2);
  const evidenceFragmentIds = parseUuidArray(
    value.evidenceFragmentIds,
    `${field}.evidenceFragmentIds`,
    2,
  );

  if (!text.ok || !sourceIds.ok || !evidenceFragmentIds.ok) {
    return invalid(field);
  }

  return ok({
    text: text.value,
    sourceIds: sourceIds.value,
    evidenceFragmentIds: evidenceFragmentIds.value,
  });
};

const parseAttributedStatement = (
  value: unknown,
  field: string,
): Result<TriangulationStructuredAttributedStatement, InvalidTriangulationStructuredOutputError> => {
  if (!isExactRecord(value, ["text", "attribution", "sourceId", "evidenceFragmentIds"])) {
    return invalid(field);
  }

  const text = parseText(value.text, `${field}.text`);
  const attribution = parseText(value.attribution, `${field}.attribution`);
  const sourceId = parseUuid(value.sourceId, `${field}.sourceId`);
  const evidenceFragmentIds = parseUuidArray(
    value.evidenceFragmentIds,
    `${field}.evidenceFragmentIds`,
    1,
  );

  if (!text.ok || !attribution.ok || !sourceId.ok || !evidenceFragmentIds.ok) {
    return invalid(field);
  }

  return ok({
    text: text.value,
    attribution: attribution.value,
    sourceId: sourceId.value,
    evidenceFragmentIds: evidenceFragmentIds.value,
  });
};

const parseSummary = (
  value: unknown,
): Result<TriangulationStructuredOutput["summary"], InvalidTriangulationStructuredOutputError> => {
  if (!isExactRecord(value, ["overview", "corroboratedClaims", "attributedStatements"])) {
    return invalid("summary");
  }

  const overview = parseText(value.overview, "summary.overview");
  const corroboratedClaims = parseArray(
    value.corroboratedClaims,
    "summary.corroboratedClaims",
    parseCorroboratedClaim,
  );
  const attributedStatements = parseArray(
    value.attributedStatements,
    "summary.attributedStatements",
    parseAttributedStatement,
  );

  if (!overview.ok || !corroboratedClaims.ok || !attributedStatements.ok) {
    return invalid("summary");
  }

  return ok({
    overview: overview.value,
    corroboratedClaims: corroboratedClaims.value,
    attributedStatements: attributedStatements.value,
  });
};

const parseMatch = (
  value: unknown,
  field: string,
): Result<TriangulationStructuredOutput["matches"][number], InvalidTriangulationStructuredOutputError> => {
  if (!isExactRecord(value, ["id", "text", "sourceIds", "evidenceFragmentIds"])) {
    return invalid(field);
  }

  const id = parseUuid(value.id, `${field}.id`);
  const claim = parseCorroboratedClaim(
    {
      text: value.text,
      sourceIds: value.sourceIds,
      evidenceFragmentIds: value.evidenceFragmentIds,
    },
    field,
  );

  if (!id.ok || !claim.ok) {
    return invalid(field);
  }

  return ok({ id: id.value, ...claim.value });
};

const parsePosition = (
  value: unknown,
  field: string,
): Result<TriangulationStructuredOutput["divergences"][number]["positions"][number], InvalidTriangulationStructuredOutputError> => {
  if (!isExactRecord(value, ["sourceId", "claim", "evidenceFragmentIds"])) {
    return invalid(field);
  }

  const sourceId = parseUuid(value.sourceId, `${field}.sourceId`);
  const claim = parseText(value.claim, `${field}.claim`);
  const evidenceFragmentIds = parseUuidArray(
    value.evidenceFragmentIds,
    `${field}.evidenceFragmentIds`,
    1,
  );

  if (!sourceId.ok || !claim.ok || !evidenceFragmentIds.ok) {
    return invalid(field);
  }

  return ok({
    sourceId: sourceId.value,
    claim: claim.value,
    evidenceFragmentIds: evidenceFragmentIds.value,
  });
};

const parseDivergence = (
  value: unknown,
  field: string,
): Result<TriangulationStructuredOutput["divergences"][number], InvalidTriangulationStructuredOutputError> => {
  if (!isExactRecord(value, ["id", "contrast", "positions"])) {
    return invalid(field);
  }

  const id = parseUuid(value.id, `${field}.id`);
  const contrast = parseText(value.contrast, `${field}.contrast`);
  const positions = parseArray(value.positions, `${field}.positions`, parsePosition);

  if (!id.ok || !contrast.ok || !positions.ok || positions.value.length < 2) {
    return invalid(field);
  }

  if (new Set(positions.value.map((position) => position.sourceId)).size < 2) {
    return invalid(`${field}.positions`);
  }

  return ok({ id: id.value, contrast: contrast.value, positions: positions.value });
};

const parseSource = (
  value: unknown,
  field: string,
): Result<TriangulationStructuredOutput["sources"][number], InvalidTriangulationStructuredOutputError> => {
  if (!isExactRecord(value, ["sourceId", "evidenceFragmentIds"])) {
    return invalid(field);
  }

  const sourceId = parseUuid(value.sourceId, `${field}.sourceId`);
  const evidenceFragmentIds = parseUuidArray(
    value.evidenceFragmentIds,
    `${field}.evidenceFragmentIds`,
    1,
  );

  return sourceId.ok && evidenceFragmentIds.ok
    ? ok({ sourceId: sourceId.value, evidenceFragmentIds: evidenceFragmentIds.value })
    : invalid(field);
};

const parseCoverage = (
  value: unknown,
): Result<TriangulationStructuredOutput["coverage"], InvalidTriangulationStructuredOutputError> => {
  if (!isExactRecord(value, ["regions", "orientations"])) {
    return invalid("coverage");
  }

  const regionsValue = parseArray(value.regions, "coverage.regions", (candidate, field) => {
    if (!isExactRecord(candidate, ["region", "sourceIds"]) ||
      typeof candidate.region !== "string" || !regions.has(candidate.region as TriangulationStructuredRegion)) {
      return invalid(field);
    }
    const sourceIds = parseUuidArray(candidate.sourceIds, `${field}.sourceIds`, 1);
    return sourceIds.ok
      ? ok({ region: candidate.region as TriangulationStructuredRegion, sourceIds: sourceIds.value })
      : invalid(field);
  });
  const orientationsValue = parseArray(value.orientations, "coverage.orientations", (candidate, field) => {
    if (!isExactRecord(candidate, ["orientation", "sourceIds"]) ||
      typeof candidate.orientation !== "string" || !orientations.has(candidate.orientation as TriangulationStructuredOrientation)) {
      return invalid(field);
    }
    const sourceIds = parseUuidArray(candidate.sourceIds, `${field}.sourceIds`, 1);
    return sourceIds.ok
      ? ok({ orientation: candidate.orientation as TriangulationStructuredOrientation, sourceIds: sourceIds.value })
      : invalid(field);
  });

  return regionsValue.ok && orientationsValue.ok
    ? ok({ regions: regionsValue.value, orientations: orientationsValue.value })
    : invalid("coverage");
};

const parseWarning = (
  value: unknown,
  field: string,
): Result<TriangulationStructuredOutput["warnings"][number], InvalidTriangulationStructuredOutputError> => {
  if (!isExactRecord(value, ["kind", "message", "sourceIds", "evidenceFragmentIds"]) ||
    typeof value.kind !== "string" || !warningKinds.has(value.kind as TriangulationStructuredWarningKind)) {
    return invalid(field);
  }
  const message = parseText(value.message, `${field}.message`);
  const sourceIds = parseUuidArray(value.sourceIds, `${field}.sourceIds`, 0);
  const evidenceFragmentIds = parseUuidArray(value.evidenceFragmentIds, `${field}.evidenceFragmentIds`, 0);

  return message.ok && sourceIds.ok && evidenceFragmentIds.ok
    ? ok({
      kind: value.kind as TriangulationStructuredWarningKind,
      message: message.value,
      sourceIds: sourceIds.value,
      evidenceFragmentIds: evidenceFragmentIds.value,
    })
    : invalid(field);
};

const hasReferenceIntegrity = (output: TriangulationStructuredOutput): boolean => {
  const knownSourceIds = new Set<string>();
  const evidenceSourceIds = new Map<string, string>();

  for (const source of output.sources) {
    if (knownSourceIds.has(source.sourceId)) {
      return false;
    }
    knownSourceIds.add(source.sourceId);
    for (const evidenceFragmentId of source.evidenceFragmentIds) {
      if (evidenceSourceIds.has(evidenceFragmentId)) {
        return false;
      }
      evidenceSourceIds.set(evidenceFragmentId, source.sourceId);
    }
  }

  const sourcesExist = (sourceIds: readonly UUID[]) =>
    sourceIds.every((sourceId) => knownSourceIds.has(sourceId));
  const evidenceExists = (evidenceFragmentIds: readonly UUID[]) =>
    evidenceFragmentIds.every((evidenceFragmentId) => evidenceSourceIds.has(evidenceFragmentId));
  const validatesSingleSource = (sourceId: UUID, evidenceFragmentIds: readonly UUID[]) =>
    sourcesExist([sourceId]) && evidenceExists(evidenceFragmentIds) &&
    evidenceFragmentIds.every((evidenceFragmentId) => evidenceSourceIds.get(evidenceFragmentId) === sourceId);
  const validatesMultipleSources = (sourceIds: readonly UUID[], evidenceFragmentIds: readonly UUID[]) =>
    sourcesExist(sourceIds) && evidenceExists(evidenceFragmentIds) &&
    sourceIds.every((sourceId) => evidenceFragmentIds.some(
      (evidenceFragmentId) => evidenceSourceIds.get(evidenceFragmentId) === sourceId,
    ));
  const validatesWarning = (warning: TriangulationStructuredOutput["warnings"][number]) =>
    sourcesExist(warning.sourceIds) && evidenceExists(warning.evidenceFragmentIds) &&
    (warning.sourceIds.length === 0 || warning.evidenceFragmentIds.every(
      (evidenceFragmentId) => warning.sourceIds.includes(evidenceSourceIds.get(evidenceFragmentId) as UUID),
    ));

  return (
    output.summary.corroboratedClaims.every((claim) => validatesMultipleSources(claim.sourceIds, claim.evidenceFragmentIds)) &&
    output.summary.attributedStatements.every((statement) => validatesSingleSource(statement.sourceId, statement.evidenceFragmentIds)) &&
    output.matches.every((match) => validatesMultipleSources(match.sourceIds, match.evidenceFragmentIds)) &&
    output.divergences.every((divergence) => divergence.positions.every(
      (position) => validatesSingleSource(position.sourceId, position.evidenceFragmentIds),
    )) &&
    output.coverage.regions.every((coverage) => sourcesExist(coverage.sourceIds)) &&
    output.coverage.orientations.every((coverage) => sourcesExist(coverage.sourceIds)) &&
    output.warnings.every(validatesWarning)
  );
};
export const parseTriangulationStructuredOutput = (
  value: unknown,
): Result<TriangulationStructuredOutput, InvalidTriangulationStructuredOutputError> => {
  if (!isExactRecord(value, ["summary", "matches", "divergences", "sources", "coverage", "warnings"])) {
    return invalid("root");
  }

  const summary = parseSummary(value.summary);
  const matches = parseArray(value.matches, "matches", parseMatch);
  const divergences = parseArray(value.divergences, "divergences", parseDivergence);
  const sources = parseArray(value.sources, "sources", parseSource);
  const coverage = parseCoverage(value.coverage);
  const warnings = parseArray(value.warnings, "warnings", parseWarning);

  if (!summary.ok || !matches.ok || !divergences.ok || !sources.ok || !coverage.ok || !warnings.ok) {
    return invalid("root");
  }

  const output = {
    summary: summary.value,
    matches: matches.value,
    divergences: divergences.value,
    sources: sources.value,
    coverage: coverage.value,
    warnings: warnings.value,
  };

  return hasReferenceIntegrity(output) ? ok(output) : invalid("references");
};

const uuidSchema = { type: "string", pattern: uuidPattern.source } as const;
const nonEmptyTextSchema = {
  type: "string",
  minLength: 1,
  pattern: "\\S",
} as const;
const uuidArraySchema = (minimum: number) => ({
  type: "array",
  items: uuidSchema,
  minItems: minimum,
  uniqueItems: true,
} as const);

export const triangulationOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "matches", "divergences", "sources", "coverage", "warnings"],
  properties: {
    summary: {
      type: "object",
      additionalProperties: false,
      required: ["overview", "corroboratedClaims", "attributedStatements"],
      properties: {
        overview: nonEmptyTextSchema,
        corroboratedClaims: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "sourceIds", "evidenceFragmentIds"],
            properties: {
              text: nonEmptyTextSchema,
              sourceIds: uuidArraySchema(2),
              evidenceFragmentIds: uuidArraySchema(2),
            },
          },
        },
        attributedStatements: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "attribution", "sourceId", "evidenceFragmentIds"],
            properties: {
              text: nonEmptyTextSchema,
              attribution: nonEmptyTextSchema,
              sourceId: uuidSchema,
              evidenceFragmentIds: uuidArraySchema(1),
            },
          },
        },
      },
    },
    matches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text", "sourceIds", "evidenceFragmentIds"],
        properties: {
          id: uuidSchema,
          text: nonEmptyTextSchema,
          sourceIds: uuidArraySchema(2),
          evidenceFragmentIds: uuidArraySchema(2),
        },
      },
    },
    divergences: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "contrast", "positions"],
        properties: {
          id: uuidSchema,
          contrast: nonEmptyTextSchema,
          positions: {
            type: "array",
            minItems: 2,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["sourceId", "claim", "evidenceFragmentIds"],
              properties: {
                sourceId: uuidSchema,
                claim: nonEmptyTextSchema,
                evidenceFragmentIds: uuidArraySchema(1),
              },
            },
          },
        },
      },
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceId", "evidenceFragmentIds"],
        properties: {
          sourceId: uuidSchema,
          evidenceFragmentIds: uuidArraySchema(1),
        },
      },
    },
    coverage: {
      type: "object",
      additionalProperties: false,
      required: ["regions", "orientations"],
      properties: {
        regions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["region", "sourceIds"],
            properties: {
              region: { type: "string", enum: [...regions] },
              sourceIds: uuidArraySchema(1),
            },
          },
        },
        orientations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["orientation", "sourceIds"],
            properties: {
              orientation: { type: "string", enum: [...orientations] },
              sourceIds: uuidArraySchema(1),
            },
          },
        },
      },
    },
    warnings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "message", "sourceIds", "evidenceFragmentIds"],
        properties: {
          kind: { type: "string", enum: [...warningKinds] },
          message: nonEmptyTextSchema,
          sourceIds: uuidArraySchema(0),
          evidenceFragmentIds: uuidArraySchema(0),
        },
      },
    },
  },
} as const;
