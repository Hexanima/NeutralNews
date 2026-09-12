import {
  AiConfigurationUnavailableError,
  AiInvalidStructuredOutputError,
  PortCancelledError,
  PortLimitExceededError,
  createTriangulationResult,
  err,
  neutralityPrompt,
  ok,
  parseTriangulationStructuredOutput,
  triangulationOutputSchema,
  validateAiModelSelection,
  type AiGenerationPort,
  type EvidenceFragment,
  type LimitedPortOperationOptions,
  type PortError,
  type Result,
  type TriangulationResult,
  type TriangulationStructuredOutput,
} from "app-domain";

import type { JsonAiProviderConfigurationRepository } from "./ai-provider-configuration-repository.js";

const operationName = "triangulation.analyze";
const defaultMaximumInputBytes = 48 * 1024;
const defaultMaximumOutputItems = 6;
const absoluteMaximumOutputItems = 12;

export interface TriangulationAnalyzerResult {
  readonly triangulation: TriangulationResult;
  readonly structuredOutput: TriangulationStructuredOutput;
}

export interface TriangulationAnalyzer {
  analyze: (input: {
    evidence: readonly EvidenceFragment[];
    options?: LimitedPortOperationOptions | undefined;
  }) => Promise<Result<TriangulationAnalyzerResult, PortError>>;
}

export interface TriangulationAnalyzerOptions {
  aiProvider: Pick<AiGenerationPort, "generateStructuredResponse">;
  configurationRepository: Pick<
    JsonAiProviderConfigurationRepository,
    "getEffectiveConfiguration"
  >;
}

const maximumInputBytes = (options: LimitedPortOperationOptions | undefined): number =>
  options?.maxBytes === undefined
    ? defaultMaximumInputBytes
    : Math.max(0, Math.floor(options.maxBytes));

const maximumOutputItems = (options: LimitedPortOperationOptions | undefined): number =>
  Math.min(
    absoluteMaximumOutputItems,
    Math.max(1, Math.floor(options?.maxItems ?? defaultMaximumOutputItems)),
  );

const outputSchemaWithLimits = (maximumItems: number) => ({
  ...triangulationOutputSchema,
  properties: {
    ...triangulationOutputSchema.properties,
    summary: {
      ...triangulationOutputSchema.properties.summary,
      properties: {
        ...triangulationOutputSchema.properties.summary.properties,
        corroboratedClaims: {
          ...triangulationOutputSchema.properties.summary.properties.corroboratedClaims,
          maxItems: maximumItems,
        },
        attributedStatements: {
          ...triangulationOutputSchema.properties.summary.properties.attributedStatements,
          maxItems: maximumItems,
        },
      },
    },
    matches: {
      ...triangulationOutputSchema.properties.matches,
      maxItems: maximumItems,
    },
    divergences: {
      ...triangulationOutputSchema.properties.divergences,
      maxItems: maximumItems,
    },
    sources: {
      ...triangulationOutputSchema.properties.sources,
      maxItems: maximumItems,
    },
    warnings: {
      ...triangulationOutputSchema.properties.warnings,
      maxItems: maximumItems,
    },
  },
});

const preparedEvidence = (evidence: readonly EvidenceFragment[]) =>
  evidence.map((fragment) => ({
    id: fragment.id,
    text: fragment.text,
    provenance: {
      articleId: fragment.provenance.articleId,
      sourceId: fragment.provenance.sourceId,
      url: fragment.provenance.url,
      contentKind: fragment.provenance.contentKind,
      ...(fragment.provenance.discoveryKind === undefined
        ? {}
        : { discoveryKind: fragment.provenance.discoveryKind }),
    },
    quality: { contentLevel: fragment.quality.contentLevel },
  }));

const promptFor = (input: {
  evidence: readonly EvidenceFragment[];
  maximumItems: number;
}): string => [
  `Prompt ${neutralityPrompt.id} v${neutralityPrompt.version}.`,
  neutralityPrompt.instructions,
  "Usa exclusivamente los IDs de fuente, evidencia y URLs incluidas a continuación.",
  "No agregues fuentes, URLs, citas ni evidencias que no estén presentes en la entrada.",
  `Incluye como máximo ${input.maximumItems} elementos en cada lista de resultados.`,
  "Evidencias preparadas:",
  JSON.stringify(preparedEvidence(input.evidence)),
].join("\n\n");

const outputReferencesBelongToEvidence = (
  output: TriangulationStructuredOutput,
  evidence: readonly EvidenceFragment[],
): boolean => {
  const sourceIdByEvidenceId = new Map(
    evidence.map((fragment) => [fragment.id, fragment.provenance.sourceId]),
  );

  return output.sources.every((source) =>
    source.evidenceFragmentIds.every(
      (evidenceId) => sourceIdByEvidenceId.get(evidenceId) === source.sourceId,
    ),
  );
};

const toTriangulationResult = (
  output: TriangulationStructuredOutput,
): Result<TriangulationResult, PortError> => {
  const result = createTriangulationResult({
    summary: output.summary.overview,
    matches: output.matches,
    divergences: output.divergences.map((divergence) => ({
      id: divergence.id,
      text: divergence.contrast,
      positions: divergence.positions.map((position) => ({
        text: position.claim,
        sourceIds: [position.sourceId],
        evidenceFragmentIds: position.evidenceFragmentIds,
      })),
    })),
    sources: output.sources,
    warnings: output.warnings,
  });

  return result.ok
    ? result
    : err(new AiInvalidStructuredOutputError("triangulation"));
};

export const createTriangulationAnalyzer = ({
  aiProvider,
  configurationRepository,
}: TriangulationAnalyzerOptions): TriangulationAnalyzer => ({
  analyze: async ({ evidence, options }) => {
    if (options?.signal?.aborted) {
      return err(new PortCancelledError(operationName));
    }

    const prompt = promptFor({
      evidence,
      maximumItems: maximumOutputItems(options),
    });

    if (Buffer.byteLength(prompt, "utf8") > maximumInputBytes(options)) {
      return err(new PortLimitExceededError(operationName, "maxBytes"));
    }

    const configuration = await configurationRepository.getEffectiveConfiguration();

    if (!configuration.ok) {
      return err(new AiConfigurationUnavailableError());
    }

    const selection = validateAiModelSelection({
      providers: configuration.value.providers,
      models: configuration.value.models,
      selection: configuration.value.activeSelection,
      requiredCapabilities: ["structured_outputs", "reasoning_medium"],
    });

    if (!selection.ok) {
      return selection;
    }

    if (options?.signal?.aborted) {
      return err(new PortCancelledError(operationName));
    }

    const generated = await aiProvider.generateStructuredResponse({
      selection: configuration.value.activeSelection,
      requiredCapabilities: ["structured_outputs", "reasoning_medium"],
      prompt,
      outputSchema: outputSchemaWithLimits(maximumOutputItems(options)),
      options,
    });

    if (!generated.ok) {
      return generated;
    }

    const structuredOutput = parseTriangulationStructuredOutput(generated.value.output);

    if (!structuredOutput.ok || !outputReferencesBelongToEvidence(structuredOutput.value, evidence)) {
      return err(new AiInvalidStructuredOutputError("triangulation"));
    }

    const triangulation = toTriangulationResult(structuredOutput.value);

    return triangulation.ok
      ? ok({ triangulation: triangulation.value, structuredOutput: structuredOutput.value })
      : triangulation;
  },
});
