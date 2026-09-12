import {
  type ArticleExtractorPort,
  type EditorialGenerationPort,
  type PortError,
  type RssFeedReaderPort,
  type WebSearchPort,
} from "../ports/index.js";
import {
  createTriangulationResult,
  type EditorialWarning,
  type InvalidEditorialResultError,
  type TriangulationResult,
} from "../entities/editorial-result.js";
import type { AiModelSelection } from "../ai/index.js";
import type { NewsSource, NewsSourceOrientation } from "../entities/news-source.js";
import { err } from "../types/result.js";
import type { UseCase } from "../types/usecase.js";
import type { UUID } from "../types/uuid.js";
import {
  InvalidTriangulationAttributionError,
  verifyTriangulationResultAttributions,
} from "../services/triangulation-attribution-verifier.js";
import {
  discoverHybridEvidenceUseCase,
  type DiscoverHybridEvidencePayload,
} from "./hybrid-discovery-usecase.js";

const requiredCapabilities = ["structured_outputs", "reasoning_medium"] as const;

export interface TriangulateTopicDependencies {
  readonly rssFeedReader: RssFeedReaderPort;
  readonly articleExtractor: ArticleExtractorPort;
  readonly webSearch: WebSearchPort;
  readonly editorialGeneration: Pick<
    EditorialGenerationPort,
    "generateTriangulation"
  >;
}

export interface TriangulateTopicPayload extends DiscoverHybridEvidencePayload {
  readonly selection: AiModelSelection;
}

export type TriangulateTopicError =
  | PortError
  | InvalidEditorialResultError
  | InvalidTriangulationAttributionError;

const classifiedOrientation = (
  source: NewsSource | undefined,
): NewsSourceOrientation | undefined =>
  source?.orientation === undefined || source.orientation === "sin_clasificar"
    ? undefined
    : source.orientation;

const insufficientEvidenceResult = (): ReturnType<typeof createTriangulationResult> =>
  createTriangulationResult({
    summary: "No hay evidencia suficiente para comparar coberturas.",
    matches: [],
    divergences: [],
    sources: [],
    warnings: [{
      kind: "insufficient_evidence",
      message: "No se encontró evidencia utilizable para realizar la triangulación.",
    }],
  });

const discoveryWarnings = (input: {
  readonly coverage: "complete" | "partial";
  readonly failedSourceCount: number;
  readonly evidenceSourceIds: readonly UUID[];
  readonly referencedSourceIds: readonly UUID[];
  readonly sources: readonly NewsSource[];
}): readonly EditorialWarning[] => {
  const sourcesById = new Map(input.sources.map((source) => [source.id, source]));
  const referencedSourceIds = new Set(input.referencedSourceIds);
  const contributingSources = [...new Set(input.evidenceSourceIds)]
    .map((sourceId) => sourcesById.get(sourceId))
    .filter((source): source is NewsSource => source !== undefined);
  const mediaSourceIds = [...new Set(
    contributingSources
      .filter((source) => source.type === "media")
      .map((source) => source.id),
  )];
  const classifiedSourceIds = [...new Set(
    contributingSources
      .filter((source) => classifiedOrientation(source) !== undefined)
      .map((source) => source.id),
  )];
  const orientationCount = new Set(
    contributingSources
      .map(classifiedOrientation)
      .filter((orientation): orientation is NewsSourceOrientation => orientation !== undefined),
  ).size;
  const warnings: EditorialWarning[] = [];

  if (input.coverage === "partial") {
    warnings.push({
      kind: "partial_coverage",
      message: "La cobertura disponible es parcial y no reúne diversidad suficiente para una comparación completa.",
    });
  }

  if (input.failedSourceCount > 0) {
    warnings.push({
      kind: "partial_coverage",
      message: "Algunas fuentes no pudieron procesarse; el resultado conserva la evidencia disponible.",
    });
  }

  if (mediaSourceIds.length === 1 || orientationCount === 1) {
    const sourceIds = (mediaSourceIds.length === 1
      ? mediaSourceIds
      : classifiedSourceIds
    ).filter((sourceId) => referencedSourceIds.has(sourceId));
    warnings.push({
      kind: "asymmetric_coverage",
      message: mediaSourceIds.length === 1 && orientationCount === 1
        ? "La cobertura disponible se concentra en un único medio y una única orientación editorial clasificada."
        : mediaSourceIds.length === 1
          ? "La cobertura disponible se concentra en un único medio."
          : "La cobertura disponible se concentra en una única orientación editorial clasificada.",
      ...(sourceIds.length === 0 ? {} : { sourceIds }),
    });
  }

  return warnings;
};

const addDiscoveryWarnings = (input: {
  readonly triangulation: TriangulationResult;
  readonly warnings: readonly EditorialWarning[];
}): ReturnType<typeof createTriangulationResult> =>
  createTriangulationResult({
    ...input.triangulation,
    warnings: [...input.triangulation.warnings, ...input.warnings],
  });

export const triangulateTopicUseCase: UseCase<
  TriangulateTopicDependencies,
  TriangulateTopicPayload,
  TriangulationResult,
  TriangulateTopicError
> = {
  execute: async ({ rssFeedReader, articleExtractor, webSearch, editorialGeneration }, payload) => {
    const { selection, ...discoveryPayload } = payload;
    const discovery = await discoverHybridEvidenceUseCase.execute(
      { rssFeedReader, articleExtractor, webSearch },
      discoveryPayload,
    );

    if (!discovery.ok) {
      return err(discovery.error);
    }

    if (discovery.value.evidence.length === 0) {
      return insufficientEvidenceResult();
    }

    const generated = await editorialGeneration.generateTriangulation({
      selection,
      requiredCapabilities,
      evidence: discovery.value.evidence,
      options: payload.options,
    });

    if (!generated.ok) {
      return generated;
    }

    const verified = verifyTriangulationResultAttributions({
      triangulation: generated.value,
      evidence: discovery.value.evidence,
    });

    if (!verified.ok) {
      return verified;
    }

    return addDiscoveryWarnings({
      triangulation: verified.value,
      warnings: discoveryWarnings({
        coverage: discovery.value.coverage,
        failedSourceCount: discovery.value.failedSources.length,
        evidenceSourceIds: discovery.value.evidence.map((evidence) => evidence.provenance.sourceId),
        referencedSourceIds: verified.value.sources.map((source) => source.sourceId),
        sources: payload.sources.map((entry) => entry.source),
      }),
    });
  },
};
