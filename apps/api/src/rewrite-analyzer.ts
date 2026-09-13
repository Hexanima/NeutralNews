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
const defaultMaximumOutputItems = 32;
const absoluteMaximumOutputItems = 64;
const lowInformationTokens = new Set([
  "a", "al", "ante", "con", "de", "del", "el", "en", "es", "fue", "ha",
  "la", "las", "lo", "los", "para", "por", "que", "se", "su", "sus", "un",
  "una", "y", "pero",
]);
const attributionVerbRoots = [
  "aclar", "acus", "admit", "advert", "afirm", "agreg", "aleg", "anad", "anunci",
  "argument", "asegur", "asever", "confirm", "consider", "critic", "cuestion", "declar",
  "defend", "denunci", "dij", "explic", "expres", "inform", "insist", "manifest", "neg",
  "opin", "pid", "plante", "propon", "propus", "rechaz", "reclam", "reconoc", "remarc", "respond",
  "senal", "sosten", "sostuv", "subray",
] as const;
const attributionVerbEndings = [
  "aba", "aban", "abas", "abais", "abamos", "ado", "ados", "ando", "an",
  "ara", "aran", "aras", "arais", "aramos", "are", "aremos", "ares", "areis",
  "aria", "arian", "arias", "ariais", "ariamos", "aron", "as", "aste", "asteis",
  "a", "e", "en", "emos", "eis", "eron", "es", "ia", "ian", "ias", "iais", "iamos",
  "ido", "idos", "iendo", "i", "imos", "io", "ieron", "is", "iste", "isteis", "o",
] as const;
const finiteVerbEndings = [
  "aron", "ieron", "aban", "abas", "aba", "ábamos", "ían", "ías", "ía",
  "íamos", "arán", "ará", "erán", "erá", "irán", "irá", "asteis", "aste",
  "isteis", "iste", "ó",
] as const;

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

const maximumOutputItems = (
  options: LimitedPortOperationOptions | undefined,
): number | null => {
  const requested = options?.maxItems ?? defaultMaximumOutputItems;

  if (!Number.isInteger(requested) || requested < 1) {
    return null;
  }

  return Math.min(absoluteMaximumOutputItems, requested);
};

const promptFor = (input: { readonly segments: readonly SourceSegment[] }): string => [
  `Prompt ${rewritePrompt.id} v${rewritePrompt.version}.`,
  rewritePrompt.instructions,
  "Usa exclusivamente el texto y los segmentos de entrada. No uses herramientas, búsqueda web ni contexto externo.",
  "La cobertura debe incluir cada ID de segmento de entrada exactamente una vez entre todas las posiciones.",
  "Segmentos de entrada preparados:",
  JSON.stringify(input.segments),
].join("\n\n");

const outputSchemaWithLimits = (maximumItems: number) => ({
  ...rewriteOutputSchema,
  properties: {
    ...rewriteOutputSchema.properties,
    changes: {
      ...rewriteOutputSchema.properties.changes,
      maxItems: maximumItems,
    },
    positions: {
      ...rewriteOutputSchema.properties.positions,
      maxItems: maximumItems,
    },
  },
});

const normalizedText = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("es");

const materialTokenList = (text: string): readonly string[] =>
  normalizedText(text)
    .split(/[^\p{Letter}\p{Number}]+/u)
    .filter((token) => token !== "" && !lowInformationTokens.has(token));

const materialTokens = (text: string): ReadonlySet<string> => new Set(materialTokenList(text));

const textTokens = (text: string): readonly string[] =>
  normalizedText(text)
    .split(/[^\p{Letter}\p{Number}]+/u)
    .filter((token) => token !== "");

const isAttributionVerb = (token: string): boolean =>
  attributionVerbRoots.some((root) =>
    attributionVerbEndings.some((ending) => token === `${root}${ending}`),
  );

const hasFiniteVerb = (text: string): boolean =>
  text
    .split(/[^\p{Letter}]+/u)
    .some((token) => finiteVerbEndings.some((ending) => token.endsWith(ending)));

const attributionSubjectTokens = (text: string): readonly string[] | null => {
  const accordingTo = text.match(/^\s*según\s+([^,;:.!?]+)/iu);

  if (accordingTo?.[1] !== undefined) {
    const subjectTokens = [...materialTokens(accordingTo[1])];

    return subjectTokens.length === 0 ? null : subjectTokens;
  }

  const tokens = textTokens(text);
  const attributionVerbIndex = tokens.findIndex(isAttributionVerb);

  if (attributionVerbIndex < 1) {
    return null;
  }

  const subjectTokens = tokens
    .slice(0, attributionVerbIndex)
    .filter((token) => !lowInformationTokens.has(token));

  return subjectTokens.length === 0 ? null : subjectTokens;
};

const splitCoordinatedAttributions = (text: string): readonly string[] => {
  const clauses = text.split(/\s+y\s+/iu);

  if (clauses.length < 2) {
    return [text];
  }

  const segments = [clauses[0]!];

  for (const clause of clauses.slice(1)) {
    const previousSegment = segments[segments.length - 1]!;

    if (
      (attributionSubjectTokens(previousSegment) !== null || hasFiniteVerb(previousSegment)) &&
      (attributionSubjectTokens(clause) !== null || hasFiniteVerb(clause))
    ) {
      segments.push(clause);
    } else {
      segments[segments.length - 1] = `${previousSegment} y ${clause}`;
    }
  }

  return segments;
};

const segmentText = (text: string): readonly SourceSegment[] =>
  text
    .trim()
    .split(/(?:\r?\n)+|(?<=[.!?])\s+|,\s+(?=(?:pero|aunque|mientras(?:\s+que)?|sin embargo|no obstante)\b)/iu)
    .flatMap(splitCoordinatedAttributions)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "")
    .map((text, index) => ({ id: `segment-${index + 1}`, text }));

const representationPreservesAttribution = (input: {
  readonly sourceSegment: SourceSegment;
  readonly neutralText: string;
}): boolean => {
  const subjectTokens = attributionSubjectTokens(input.sourceSegment.text);

  if (subjectTokens === null) {
    return true;
  }

  const neutralTextTokens = textTokens(input.neutralText);
  const neutralTokens = new Set(neutralTextTokens);
  const normalizedNeutralText = normalizedText(input.neutralText);
  const finalSubjectIndex = Math.max(
    ...subjectTokens.map((token) => neutralTextTokens.lastIndexOf(token)),
  );
  const preservesAccordingTo = normalizedNeutralText.startsWith("segun ");
  const preservesDeclarativeAttribution = neutralTextTokens.some(
    (token, index) => index > finalSubjectIndex && isAttributionVerb(token),
  );

  return subjectTokens.every((token) => neutralTokens.has(token)) &&
    (preservesAccordingTo || preservesDeclarativeAttribution);
};

const minimumPreservedTokenCount = (tokenCount: number): number =>
  tokenCount < 3
    ? 1
    : Math.max(2, Math.ceil(tokenCount / 3));

const representationPreservesSegmentContent = (input: {
  readonly sourceSegment: SourceSegment;
  readonly neutralText: string;
}): boolean => {
  const sourceTokens = materialTokens(input.sourceSegment.text);

  if (sourceTokens.size === 0) {
    return true;
  }

  const neutralTokens = materialTokens(input.neutralText);
  const preservedTokenCount = [...sourceTokens].filter((token) => neutralTokens.has(token)).length;

  return preservedTokenCount >= minimumPreservedTokenCount(sourceTokens.size);
};

const countTokens = (tokens: readonly string[]): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return counts;
};

const representationDoesNotAddMaterialContext = (input: {
  readonly sourceSegment: SourceSegment;
  readonly neutralText: string;
}): boolean => {
  const sourceTokenCounts = countTokens(materialTokenList(input.sourceSegment.text));
  const neutralTokenCounts = countTokens(materialTokenList(input.neutralText));
  let introducedTokenCount = 0;
  let removedTokenCount = 0;

  for (const [token, count] of neutralTokenCounts) {
    introducedTokenCount += Math.max(0, count - (sourceTokenCounts.get(token) ?? 0));
  }

  for (const [token, count] of sourceTokenCounts) {
    removedTokenCount += Math.max(0, count - (neutralTokenCounts.get(token) ?? 0));
  }

  return introducedTokenCount <= removedTokenCount;
};

const hasCompletePositionCoverage = (input: {
  readonly output: RewriteStructuredOutput;
  readonly sourceSegments: readonly SourceSegment[];
}): boolean => {
  const expectedIds = new Set(input.sourceSegments.map((segment) => segment.id));
  const sourceSegmentsById = new Map(
    input.sourceSegments.map((segment) => [segment.id, segment]),
  );
  const coveredIds = input.output.positions.flatMap((position) => position.sourceSegmentIds);
  const coveredIdSet = new Set(coveredIds);
  const neutralRepresentations = input.output.positions.map((position) =>
    normalizedText(position.neutralText),
  );
  const positionsBySourceSegmentId = new Map(
    input.output.positions.map((position) => [position.sourceSegmentIds[0]!, position]),
  );
  const concatenatedPositionText = input.sourceSegments
    .map((segment) => positionsBySourceSegmentId.get(segment.id)?.neutralText ?? "")
    .join(" ");

  return coveredIds.length === expectedIds.size &&
    coveredIdSet.size === expectedIds.size &&
    [...coveredIdSet].every((id) => expectedIds.has(id)) &&
    new Set(neutralRepresentations).size === neutralRepresentations.length &&
    normalizedText(input.output.neutralText) === normalizedText(concatenatedPositionText) &&
    input.output.positions.every((position) => {
      const sourceSegment = sourceSegmentsById.get(position.sourceSegmentIds[0]!);

      return sourceSegment !== undefined &&
        segmentText(position.neutralText).length === 1 &&
        representationPreservesSegmentContent({
          sourceSegment,
          neutralText: position.neutralText,
        }) && representationDoesNotAddMaterialContext({
          sourceSegment,
          neutralText: position.neutralText,
        }) && representationPreservesAttribution({
          sourceSegment,
          neutralText: position.neutralText,
        });
    });
};

const outputFitsMaximumItems = (
  output: RewriteStructuredOutput,
  maximumItems: number,
): boolean =>
  output.changes.length <= maximumItems &&
  output.positions.length <= maximumItems;

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

    const maximumItems = maximumOutputItems(options);

    if (maximumItems === null) {
      return err(new PortLimitExceededError(operationName, "maxItems"));
    }

    const sourceSegments = segmentText(text);
    const prompt = promptFor({ segments: sourceSegments });

    if (Buffer.byteLength(prompt, "utf8") > maximumInputBytes(options)) {
      return err(new PortLimitExceededError(operationName, "maxBytes"));
    }

    if (sourceSegments.length > maximumItems) {
      return err(new PortLimitExceededError(operationName, "maxItems"));
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
      outputSchema: outputSchemaWithLimits(maximumItems),
      options,
    });

    if (!generated.ok) {
      return generated;
    }

    const structuredOutput = parseRewriteStructuredOutput(generated.value.output);

    if (
      !structuredOutput.ok ||
      generated.value.citations.length > 0 ||
      !outputFitsMaximumItems(structuredOutput.value, maximumItems) ||
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
