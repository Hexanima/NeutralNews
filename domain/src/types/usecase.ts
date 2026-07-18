import type { TaggedError } from "./error.js";
import type { AsyncResult } from "./result.js";

export interface UseCase<
  TDependencies,
  TPayload,
  TResult,
  TErrors extends TaggedError,
> {
  execute: (
    dependencies: TDependencies,
    payload: TPayload,
  ) => AsyncResult<TResult, TErrors>;
}
