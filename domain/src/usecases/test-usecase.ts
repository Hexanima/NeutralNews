import { ok } from "../types/result.js";
import type { UseCase } from "../types/usecase.js";

export interface TestUseCaseResult {
  testVar: boolean;
}

export const testUseCase: UseCase<void, void, TestUseCaseResult, never> = {
  execute: async () => {
    return ok({ testVar: false } satisfies TestUseCaseResult);
  },
};
