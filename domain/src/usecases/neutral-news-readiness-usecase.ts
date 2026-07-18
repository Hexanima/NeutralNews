import { ok } from "../types/result.js";
import type { UseCase } from "../types/usecase.js";

export interface NeutralNewsReadinessResult {
  product: "neutral-news";
  domain: "ready";
  dependencyRule: "inward";
}

export const neutralNewsReadinessUseCase: UseCase<
  void,
  void,
  NeutralNewsReadinessResult,
  never
> = {
  execute: async () => {
    return ok({
      product: "neutral-news",
      domain: "ready",
      dependencyRule: "inward",
    } satisfies NeutralNewsReadinessResult);
  },
};
