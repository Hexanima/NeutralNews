import type { EvidenceFragment } from "../entities/article-evidence.js";
import { TaggedError } from "../types/error.js";
import { err, ok, type Result } from "../types/result.js";
import type { UUID } from "../types/uuid.js";
import {
  parseTriangulationStructuredOutput,
  type TriangulationStructuredOutput,
} from "./triangulation-output-schema.js";

export type TriangulationAttributionFailure =
  | "NoAttributableSources"
  | "InvalidVerifiedOutput";

export class InvalidTriangulationAttributionError extends TaggedError<"InvalidTriangulationAttribution"> {
  public readonly type = "InvalidTriangulationAttribution";

  constructor(public readonly reason: TriangulationAttributionFailure) {
    super("InvalidTriangulationAttribution");
    this.message = "Triangulation result contains unverifiable attributions";
  }
}

export interface VerifyTriangulationAttributionsInput {
  readonly output: TriangulationStructuredOutput;
  readonly evidence: readonly EvidenceFragment[];
  readonly maximumItems: number;
}

const attributionWarning = {
  kind: "partial_coverage" as const,
  message: "Se omitieron afirmaciones cuya atribución no pudo verificarse.",
  sourceIds: [],
  evidenceFragmentIds: [],
};

const sourceEvidenceIndex = (evidence: readonly EvidenceFragment[]) =>
  new Map<UUID, UUID>(
    evidence.map((fragment) => [fragment.id, fragment.provenance.sourceId]),
  );

export const verifyTriangulationAttributions = ({
  output,
  evidence,
  maximumItems,
}: VerifyTriangulationAttributionsInput): Result<
  TriangulationStructuredOutput,
  InvalidTriangulationAttributionError
> => {
  const sourceIdByEvidenceId = sourceEvidenceIndex(evidence);
  let degraded = false;

  const sources = output.sources.flatMap((source) => {
    const evidenceFragmentIds = source.evidenceFragmentIds.filter(
      (evidenceFragmentId) =>
        sourceIdByEvidenceId.get(evidenceFragmentId) === source.sourceId,
    );

    if (evidenceFragmentIds.length !== source.evidenceFragmentIds.length) {
      degraded = true;
    }

    return evidenceFragmentIds.length === 0
      ? []
      : [{ sourceId: source.sourceId, evidenceFragmentIds }];
  });

  if (sources.length === 0) {
    return err(new InvalidTriangulationAttributionError("NoAttributableSources"));
  }

  const knownSourceIds = new Set(sources.map((source) => source.sourceId));
  const belongsToSource = (sourceId: UUID, evidenceFragmentId: UUID): boolean =>
    sourceIdByEvidenceId.get(evidenceFragmentId) === sourceId;
  const verifiesSingleSource = (
    sourceId: UUID,
    evidenceFragmentIds: readonly UUID[],
  ): boolean =>
    knownSourceIds.has(sourceId) &&
    evidenceFragmentIds.every((evidenceFragmentId) =>
      belongsToSource(sourceId, evidenceFragmentId),
    );
  const verifiesMultipleSources = (
    sourceIds: readonly UUID[],
    evidenceFragmentIds: readonly UUID[],
  ): boolean =>
    sourceIds.every((sourceId) => knownSourceIds.has(sourceId)) &&
    sourceIds.every((sourceId) =>
      evidenceFragmentIds.some((evidenceFragmentId) =>
        belongsToSource(sourceId, evidenceFragmentId),
      ),
    ) &&
    evidenceFragmentIds.every((evidenceFragmentId) => {
      const sourceId = sourceIdByEvidenceId.get(evidenceFragmentId);

      return sourceId !== undefined && sourceIds.includes(sourceId);
    });

  const corroboratedClaims = output.summary.corroboratedClaims.filter((claim) => {
    const valid = verifiesMultipleSources(claim.sourceIds, claim.evidenceFragmentIds);
    degraded ||= !valid;
    return valid;
  });
  const attributedStatements = output.summary.attributedStatements.filter((statement) => {
    const valid = verifiesSingleSource(statement.sourceId, statement.evidenceFragmentIds);
    degraded ||= !valid;
    return valid;
  });
  const matches = output.matches.filter((match) => {
    const valid = verifiesMultipleSources(match.sourceIds, match.evidenceFragmentIds);
    degraded ||= !valid;
    return valid;
  });
  const divergences = output.divergences.flatMap((divergence) => {
    const positions = divergence.positions.filter((position) => {
      const valid = verifiesSingleSource(position.sourceId, position.evidenceFragmentIds);
      degraded ||= !valid;
      return valid;
    });

    const valid = positions.length >= 2 &&
      new Set(positions.map((position) => position.sourceId)).size >= 2;

    degraded ||= !valid;
    return valid ? [{ ...divergence, positions }] : [];
  });
  const filterCoverage = <TEntry extends { readonly sourceIds: readonly UUID[] }>(
    coverage: readonly TEntry[],
  ): readonly TEntry[] => coverage.flatMap((entry) => {
    const sourceIds = entry.sourceIds.filter((sourceId) => knownSourceIds.has(sourceId));
    degraded ||= sourceIds.length !== entry.sourceIds.length;
    return sourceIds.length === 0 ? [] : [{ ...entry, sourceIds }];
  });
  const coverage = {
    regions: filterCoverage(output.coverage.regions),
    orientations: filterCoverage(output.coverage.orientations),
  };

  if (coverage.regions.length === 0 || coverage.orientations.length === 0) {
    return err(new InvalidTriangulationAttributionError("InvalidVerifiedOutput"));
  }

  const warnings = output.warnings.map((warning) => {
    const sourceIds = warning.sourceIds.filter((sourceId) => knownSourceIds.has(sourceId));
    const evidenceFragmentIds = warning.evidenceFragmentIds.filter((evidenceFragmentId) => {
      const sourceId = sourceIdByEvidenceId.get(evidenceFragmentId);

      return sourceId !== undefined &&
        (sourceIds.length === 0 || sourceIds.includes(sourceId));
    });

    degraded ||= sourceIds.length !== warning.sourceIds.length ||
      evidenceFragmentIds.length !== warning.evidenceFragmentIds.length;

    return { ...warning, sourceIds, evidenceFragmentIds };
  });
  const verified = parseTriangulationStructuredOutput({
    summary: {
      overview: output.summary.overview,
      corroboratedClaims,
      attributedStatements,
    },
    matches,
    divergences,
    sources,
    coverage,
    warnings: degraded
      ? [...warnings, attributionWarning].slice(0, maximumItems)
      : warnings,
  });

  return verified.ok
    ? ok(verified.value)
    : err(new InvalidTriangulationAttributionError("InvalidVerifiedOutput"));
};
