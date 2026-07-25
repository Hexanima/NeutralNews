import type { AsyncResult } from "../types/result.js";
import type {
  JsonValue,
  LimitedPortOperationOptions,
  PortError,
} from "./common.js";

export interface CacheKeyInput {
  namespace: string;
  key: string;
  options?: LimitedPortOperationOptions | undefined;
}

export interface CachePort {
  read: <TValue extends JsonValue = JsonValue>(
    input: CacheKeyInput,
  ) => AsyncResult<TValue | null, PortError>;
  write: (input: CacheKeyInput & {
    value: JsonValue;
  }) => AsyncResult<void, PortError>;
  delete: (input: CacheKeyInput) => AsyncResult<void, PortError>;
  clearNamespace: (input: {
    namespace: string;
    options?: LimitedPortOperationOptions | undefined;
  }) => AsyncResult<void, PortError>;
}
