import type { IsoDateTimeString } from "../entities/news-source.js";
import type { AiModelDefinition } from "./ai-model-definition.js";

export interface AiRemoteModelSnapshot {
  readonly id: string;
  readonly createdAt?: IsoDateTimeString | undefined;
  readonly ownedBy?: string | undefined;
}

export interface AiModelSynchronizationSnapshot {
  readonly providerId: string;
  readonly syncedAt: IsoDateTimeString;
  readonly remoteModels: readonly AiRemoteModelSnapshot[];
}

export interface SynchronizeAiProviderModelsInput {
  readonly providerId: string;
  readonly syncedAt: IsoDateTimeString;
  readonly models: readonly AiModelDefinition[];
  readonly remoteModels: readonly AiRemoteModelSnapshot[];
}

export interface SynchronizeAiProviderModelsResult {
  readonly synchronization: AiModelSynchronizationSnapshot;
  readonly models: readonly AiModelDefinition[];
}

const modelKey = (model: Pick<AiModelDefinition, "providerId" | "modelId">) =>
  `${model.providerId}/${model.modelId}`;

export const synchronizeAiProviderModels = ({
  providerId,
  syncedAt,
  models,
  remoteModels,
}: SynchronizeAiProviderModelsInput): SynchronizeAiProviderModelsResult => {
  const remoteIds = new Set(remoteModels.map((model) => model.id));
  const knownRemoteIds = new Set(
    models
      .filter((model) => model.providerId === providerId)
      .map((model) => model.remoteModelId),
  );
  const synchronizedKnownModels = models.map((model) =>
    model.providerId !== providerId
      ? model
      : {
          ...model,
          availabilityStatus: remoteIds.has(model.remoteModelId)
            ? "available"
            : "unavailable",
        } satisfies AiModelDefinition,
  );
  const knownModelKeys = new Set(synchronizedKnownModels.map(modelKey));
  const unknownRemoteModels = remoteModels.flatMap((remoteModel) => {
    if (knownRemoteIds.has(remoteModel.id)) {
      return [];
    }

    const model: AiModelDefinition = {
      providerId,
      modelId: remoteModel.id,
      remoteModelId: remoteModel.id,
      capabilities: [],
      compatibilityStatus: "unknown",
      availabilityStatus: "available",
    };

    return knownModelKeys.has(modelKey(model)) ? [] : [model];
  });

  return {
    synchronization: {
      providerId,
      syncedAt,
      remoteModels,
    },
    models: [...synchronizedKnownModels, ...unknownRemoteModels],
  };
};
