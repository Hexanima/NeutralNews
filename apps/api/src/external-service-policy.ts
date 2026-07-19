import { err, ok, TaggedError, type Result } from "app-domain";

export type ExternalServiceErrorCategory =
  | "Timeout"
  | "Cancelled"
  | "TransientFailure"
  | "PermanentFailure";

export interface ExternalServicePolicy {
  timeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
}

export interface ExternalOperationContext {
  signal: AbortSignal;
  attempt: number;
}

export interface ExecuteExternalOperationOptions<TResult>
  extends ExternalServicePolicy {
  operationName: string;
  idempotent: boolean;
  signal: AbortSignal;
  sensitiveValues?: string[];
  run: (context: ExternalOperationContext) => Promise<TResult>;
}

export interface NormalizeExternalServiceErrorOptions {
  operationName: string;
  error: unknown;
  idempotent: boolean;
  sensitiveValues?: string[];
}

export class ExternalServiceError extends TaggedError<"ExternalServiceError"> {
  public readonly type = "ExternalServiceError";

  constructor(
    public readonly operationName: string,
    public readonly category: ExternalServiceErrorCategory,
    public readonly retryable: boolean,
    public readonly statusCode?: number,
  ) {
    super("ExternalServiceError");
    this.message = `${operationName} failed: ${category}`;
  }

  toJSON() {
    return {
      type: this.type,
      operationName: this.operationName,
      category: this.category,
      retryable: this.retryable,
      ...(this.statusCode === undefined ? {} : { statusCode: this.statusCode }),
    };
  }
}

type AbortReason = "Timeout" | "Cancelled";

const abortReasonKey = "neutralNewsExternalAbortReason";

const createAbortReason = (reason: AbortReason): Record<string, AbortReason> => ({
  [abortReasonKey]: reason,
});

const getObjectProperty = (value: unknown, property: string): unknown => {
  if (typeof value !== "object" || value === null || !(property in value)) {
    return undefined;
  }

  return (value as Record<string, unknown>)[property];
};

const getAbortReason = (error: unknown): AbortReason | null => {
  const reason = getObjectProperty(error, abortReasonKey);

  return reason === "Timeout" || reason === "Cancelled" ? reason : null;
};

const getStatusCode = (error: unknown): number | undefined => {
  const statusCode =
    getObjectProperty(error, "statusCode") ?? getObjectProperty(error, "status");

  return typeof statusCode === "number" && Number.isInteger(statusCode)
    ? statusCode
    : undefined;
};

const getErrorCode = (error: unknown): string | undefined => {
  const code = getObjectProperty(error, "code");

  return typeof code === "string" ? code : undefined;
};

const hasTransientFlag = (error: unknown): boolean =>
  getObjectProperty(error, "transient") === true;

const isAbortError = (error: unknown): boolean =>
  getObjectProperty(error, "name") === "AbortError";

const transientErrorCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "ETIMEDOUT",
]);

const isTransientStatusCode = (statusCode: number): boolean =>
  statusCode === 408 ||
  statusCode === 409 ||
  statusCode === 425 ||
  statusCode === 429 ||
  (statusCode >= 500 && statusCode <= 599);

const classifyExternalError = (
  error: unknown,
): {
  category: ExternalServiceErrorCategory;
  statusCode?: number;
} => {
  const abortReason = getAbortReason(error);

  if (abortReason !== null) {
    return { category: abortReason };
  }

  if (isAbortError(error)) {
    return { category: "Cancelled" };
  }

  const statusCode = getStatusCode(error);

  if (statusCode !== undefined) {
    return {
      category: isTransientStatusCode(statusCode)
        ? "TransientFailure"
        : "PermanentFailure",
      statusCode,
    };
  }

  if (hasTransientFlag(error) || transientErrorCodes.has(getErrorCode(error) ?? "")) {
    return { category: "TransientFailure" };
  }

  return { category: "PermanentFailure" };
};

export const normalizeExternalServiceError = ({
  operationName,
  error,
  idempotent,
}: NormalizeExternalServiceErrorOptions): ExternalServiceError => {
  const { category, statusCode } = classifyExternalError(error);
  const retryable = category === "TransientFailure" && idempotent;

  return new ExternalServiceError(
    operationName,
    category,
    retryable,
    statusCode,
  );
};

const createCombinedSignal = (
  callerSignal: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } => {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(createAbortReason("Timeout"));
  }, timeoutMs);

  const abortFromCaller = () => {
    controller.abort(createAbortReason("Cancelled"));
  };

  if (callerSignal.aborted) {
    abortFromCaller();
  } else {
    callerSignal.addEventListener("abort", abortFromCaller, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      callerSignal.removeEventListener("abort", abortFromCaller);
    },
  };
};

const rejectWhenAborted = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => {
    const rejectWithAbortReason = () => {
      reject(signal.reason ?? createAbortReason("Cancelled"));
    };

    if (signal.aborted) {
      rejectWithAbortReason();
      return;
    }

    signal.addEventListener("abort", rejectWithAbortReason, { once: true });
  });

const runAbortable = async <TResult>(
  operation: Promise<TResult>,
  signal: AbortSignal,
): Promise<TResult> => {
  operation.catch(() => undefined);

  return Promise.race([operation, rejectWhenAborted(signal)]);
};

const waitForRetryDelay = async (
  retryDelayMs: number,
  signal: AbortSignal,
): Promise<void> => {
  if (signal.aborted) {
    throw signal.reason ?? createAbortReason("Cancelled");
  }

  if (retryDelayMs <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", rejectDelay);
      resolve();
    }, retryDelayMs);

    const rejectDelay = () => {
      clearTimeout(timeout);
      reject(signal.reason ?? createAbortReason("Cancelled"));
    };

    signal.addEventListener("abort", rejectDelay, { once: true });
  });
};

export const executeExternalOperation = async <TResult>({
  operationName,
  idempotent,
  timeoutMs,
  maxAttempts,
  retryDelayMs,
  signal: callerSignal,
  run,
}: ExecuteExternalOperationOptions<TResult>): Promise<
  Result<TResult, ExternalServiceError>
> => {
  const { signal, cleanup } = createCombinedSignal(callerSignal, timeoutMs);

  try {
    if (signal.aborted) {
      return err(
        normalizeExternalServiceError({
          operationName,
          error: signal.reason ?? createAbortReason("Cancelled"),
          idempotent,
        }),
      );
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return ok(
          await runAbortable(
            Promise.resolve().then(() => run({ signal, attempt })),
            signal,
          ),
        );
      } catch (error) {
        const normalizedError = normalizeExternalServiceError({
          operationName,
          error,
          idempotent,
        });

        if (!normalizedError.retryable || attempt >= maxAttempts) {
          return err(normalizedError);
        }

        try {
          await waitForRetryDelay(retryDelayMs, signal);
        } catch (delayError) {
          return err(
            normalizeExternalServiceError({
              operationName,
              error: delayError,
              idempotent,
            }),
          );
        }
      }
    }

    return err(
      new ExternalServiceError(
        operationName,
        "PermanentFailure",
        false,
      ),
    );
  } finally {
    cleanup();
  }
};
