import { TaggedError } from "../types/error.js";
import { err, ok, type Result } from "../types/result.js";

export type AiCapability =
  | "structured_outputs"
  | "web_search"
  | "reasoning_low"
  | "reasoning_medium"
  | "reasoning_high";

export type AiCredentialFieldType = "secret" | "text" | "url";

export interface AiCredentialFieldDefinition {
  id: string;
  label: string;
  type: AiCredentialFieldType;
  required: boolean;
  description?: string | undefined;
}

export interface AiCredentialSchema {
  fields: readonly AiCredentialFieldDefinition[];
}

export interface AiProviderDefinition {
  id: string;
  name: string;
  credentialSchema: AiCredentialSchema;
}

export interface AiModelDefinition {
  providerId: string;
  modelId: string;
  remoteModelId: string;
  capabilities: readonly AiCapability[];
}

export interface AiModelSelection {
  providerId: string;
  modelId: string;
}

export class AiProviderNotFoundError extends TaggedError<"AiProviderNotFound"> {
  public readonly type = "AiProviderNotFound";

  constructor(public readonly providerId: string) {
    super("AiProviderNotFound");
    this.message = `AI provider was not found: ${providerId}`;
  }
}

export class AiModelNotFoundError extends TaggedError<"AiModelNotFound"> {
  public readonly type = "AiModelNotFound";

  constructor(
    public readonly providerId: string,
    public readonly modelId: string,
  ) {
    super("AiModelNotFound");
    this.message = `AI model was not found: ${providerId}/${modelId}`;
  }
}

export class AiCapabilityUnavailableError extends TaggedError<"AiCapabilityUnavailable"> {
  public readonly type = "AiCapabilityUnavailable";

  constructor(
    public readonly providerId: string,
    public readonly modelId: string,
    public readonly capability: AiCapability,
  ) {
    super("AiCapabilityUnavailable");
    this.message = `${providerId}/${modelId} does not provide ${capability}`;
  }
}

export type AiModelSelectionError =
  | AiProviderNotFoundError
  | AiModelNotFoundError
  | AiCapabilityUnavailableError;

export interface ValidateAiModelSelectionInput {
  providers: readonly AiProviderDefinition[];
  models: readonly AiModelDefinition[];
  selection: AiModelSelection;
  requiredCapabilities: readonly AiCapability[];
}

export interface ValidatedAiModelSelection {
  provider: AiProviderDefinition;
  model: AiModelDefinition;
}

const reasoningRank: Partial<Record<AiCapability, number>> = {
  reasoning_low: 1,
  reasoning_medium: 2,
  reasoning_high: 3,
};

const supportsCapability = (
  modelCapabilities: readonly AiCapability[],
  requiredCapability: AiCapability,
): boolean => {
  const requiredReasoningRank = reasoningRank[requiredCapability];

  if (requiredReasoningRank !== undefined) {
    return modelCapabilities.some((capability) => {
      const modelReasoningRank = reasoningRank[capability];

      return (
        modelReasoningRank !== undefined &&
        modelReasoningRank >= requiredReasoningRank
      );
    });
  }

  return modelCapabilities.includes(requiredCapability);
};

export const validateAiModelSelection = ({
  providers,
  models,
  selection,
  requiredCapabilities,
}: ValidateAiModelSelectionInput): Result<
  ValidatedAiModelSelection,
  AiModelSelectionError
> => {
  const provider = providers.find(({ id }) => id === selection.providerId);

  if (provider === undefined) {
    return err(new AiProviderNotFoundError(selection.providerId));
  }

  const model = models.find(
    ({ providerId, modelId }) =>
      providerId === selection.providerId && modelId === selection.modelId,
  );

  if (model === undefined) {
    return err(
      new AiModelNotFoundError(selection.providerId, selection.modelId),
    );
  }

  const missingCapability = requiredCapabilities.find(
    (capability) => !supportsCapability(model.capabilities, capability),
  );

  if (missingCapability !== undefined) {
    return err(
      new AiCapabilityUnavailableError(
        selection.providerId,
        selection.modelId,
        missingCapability,
      ),
    );
  }

  return ok({ provider, model });
};
