import type { TaggedError } from "./error.js";

export interface Ok<TResult> {
  ok: true;
  value: TResult;
}

export interface Err<TError extends TaggedError = TaggedError> {
  ok: false;
  error: TError;
}

export type Result<TResult, TError extends TaggedError = TaggedError> =
  | Ok<TResult>
  | Err<TError>;

export type AsyncResult<
  TResult,
  TError extends TaggedError = TaggedError,
> = Promise<Result<TResult, TError>>;

export const ok = <TResult>(value: TResult): Ok<TResult> => ({
  ok: true,
  value,
});

export const err = <TError extends TaggedError>(error: TError): Err<TError> => ({
  ok: false,
  error,
});

export const isOk = <TResult, TError extends TaggedError>(
  result: Result<TResult, TError>,
): result is Ok<TResult> => result.ok;

export const isErr = <TResult, TError extends TaggedError>(
  result: Result<TResult, TError>,
): result is Err<TError> => !result.ok;
