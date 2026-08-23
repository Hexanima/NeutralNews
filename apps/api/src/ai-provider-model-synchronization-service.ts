import {
  ok,
  type AiGenerationPort,
  type EffectiveAiProviderConfiguration,
  type IsoDateTimeString,
  type PortError,
  type Result,
} from "app-domain";

import type {
  JsonAiProviderConfigurationRepository,
  JsonAiProviderConfigurationRepositoryError,
} from "./ai-provider-configuration-repository.js";

export interface SyncAiProviderModelsResult {
  readonly configuration: EffectiveAiProviderConfiguration;
}

export interface SyncAiProviderModelsInput {
  readonly providerId: string;
  readonly configurationRepository: Pick<
    JsonAiProviderConfigurationRepository,
    "getEffectiveConfiguration" | "saveModelSynchronization"
  >;
  readonly aiProvider: Pick<AiGenerationPort, "listAccessibleModels">;
  readonly now?: (() => Date) | undefined;
}

const defaultNow = () => new Date();

export const syncAiProviderModels = async ({
  providerId,
  configurationRepository,
  aiProvider,
  now = defaultNow,
}: SyncAiProviderModelsInput): Promise<
  Result<
    SyncAiProviderModelsResult,
    JsonAiProviderConfigurationRepositoryError | PortError
  >
> => {
  const currentConfiguration = await configurationRepository.getEffectiveConfiguration();

  if (!currentConfiguration.ok) {
    return currentConfiguration;
  }

  const remoteModels = await aiProvider.listAccessibleModels({ providerId });

  if (!remoteModels.ok) {
    return remoteModels;
  }

  const saved = await configurationRepository.saveModelSynchronization({
    providerId,
    syncedAt: now().toISOString() as IsoDateTimeString,
    remoteModels: remoteModels.value,
  });

  return saved.ok ? ok({ configuration: saved.value }) : saved;
};
