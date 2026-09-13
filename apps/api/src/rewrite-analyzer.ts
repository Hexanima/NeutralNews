import {
  AiConfigurationUnavailableError,
  AiInvalidStructuredOutputError,
  PortCancelledError,
  PortLimitExceededError,
  createRewriteResult,
  err,
  ok,
  parseRewriteStructuredOutput,
  rewriteOutputSchema,
  rewritePrompt,
  validateAiModelSelection,
  type AiGenerationPort,
  type LimitedPortOperationOptions,
  type PortError,
  type Result,
  type RewriteResult,
  type RewriteStructuredOutput,
} from "app-domain";

import type { JsonAiProviderConfigurationRepository } from "./ai-provider-configuration-repository.js";

const operationName = "rewrite.analyze";
const defaultMaximumInputBytes = 24 * 1024;

export interface RewriteAnalyzer {
  rewrite: (input: {
    text: string;
    options?: LimitedPortOperationOptions | undefined;
  }) => Promise<Result<RewriteResult, PortError>>;
}

export interface RewriteAnalyzerOptions {
  aiProvider: Pick<AiGenerationPort, "generateStructuredResponse">;
  configurationRepository: Pick<
    JsonAiProviderConfigurationRepository,
    "getEffectiveConfiguration"
  >;
}

interface SourceSegment {
  id: string;
  text: string;
}

const maximumInputBytes = (options: LimitedPortOperationOptions | undefined): number =>
  options?.maxBytes === undefined
    ? defaultMaximumInputBytes
    : Math.max(0, Math.floor(options.maxBytes));

const segmentText = (text: string): readonly SourceSegment[] =>
  text
    .trim()
    .split(/(?:\r?\n)+|(?<=[.!?])\s+/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "")
    .map((text, index) => ({ id: `segment-${index + 1}`, text }));

const promptFor = (input: { readonly segments: readonly SourceSegment[] }): string => [
  `Prompt ${rewritePrompt.id} v${rewritePrompt.version}.`,
  rewritePrompt.instructions,
  "Usa exclusivamente el texto y los segmentos de entrada. No uses herramientas, búsqueda web ni contexto externo.",
  "La cobertura debe incluir cada ID de segmento de entrada exactamente una vez entre todas las posiciones.",
  "Segmentos de entrada preparados:",
  JSON.stringify(input.segments),
].join("\n\n");

const normalizedText = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("es");

const hasCompletePositionCoverage = (input: {
  readonly output: RewriteStructuredOutput;
  readonly sourceSegments: readonly SourceSegment[];
}): boolean => {
  const expectedIds = new Set(input.sourceSegments.map((segment) => segment.id));
  const coveredIds = input.output.positions.flatMap((position) => position.sourceSegmentIds);
  const coveredIdSet = new Set(coveredIds);
  const rewrittenText = normalizedText(input.output.neutralText);

  return coveredIds.length === expectedIds.size &&
    coveredIdSet.size === expectedIds.size &&
    [...coveredIdSet].every((id) => expectedIds.has(id)) &&
    input.output.positions.every((position) =>
      rewrittenText.includes(normalizedText(position.neutralText))
    );
};

const changeFragmentsBelongToInput = (input: {
  readonly output: RewriteStructuredOutput;
  readonly text: string;
}): boolean => {
  const sourceText = normalizedText(input.text);

  return input.output.changes.every((change) =>
    sourceText.includes(normalizedText(change.originalText))
  );
};

const toRewriteResult = (
  output: RewriteStructuredOutput,
): Result<RewriteResult, PortError> => {
  const result = createRewriteResult({
    neutralText: output.neutralText,
    changes: output.changes,
    warnings: [],
  });

  return result.ok
    ? ok(result.value)
    : err(new AiInvalidStructuredOutputError("rewrite"));
};

export const createRewriteAnalyzer = ({
  aiProvider,
  configurationRepository,
}: RewriteAnalyzerOptions): RewriteAnalyzer => ({
  rewrite: async ({ text, options }) => {
    if (options?.signal?.aborted) {
      return err(new PortCancelledError(operationName));
    }

    const sourceSegments = segmentText(text);
    const prompt = promptFor({ segments: sourceSegments });

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
      requiredCapabilities: ["structured_outputs"],
    });

    if (!selection.ok) {
      return selection;
    }

    if (options?.signal?.aborted) {
      return err(new PortCancelledError(operationName));
    }

    const generated = await aiProvider.generateStructuredResponse({
      selection: configuration.value.activeSelection,
      requiredCapabilities: ["structured_outputs"],
      prompt,
      outputSchema: rewriteOutputSchema,
      options,
    });

    if (!generated.ok) {
      return generated;
    }

    const structuredOutput = parseRewriteStructuredOutput(generated.value.output);

    if (
      !structuredOutput.ok ||
      generated.value.citations.length > 0 ||
      !hasCompletePositionCoverage({
        output: structuredOutput.value,
        sourceSegments,
      }) ||
      !changeFragmentsBelongToInput({ output: structuredOutput.value, text })
    ) {
      return err(new AiInvalidStructuredOutputError("rewrite"));
    }

    return toRewriteResult(structuredOutput.value);
  },
});
