import type { BaseEntity } from "./entity.js";
import type { TaggedError } from "./error.js";
import type { AsyncResult } from "./result.js";
import type { UUID } from "./uuid.js";

export const FilterOperators = {
  Eq: "Eq",
  Neq: "Neq",
  Gt: "Gt",
  Gte: "Gte",
  Lt: "Lt",
  Lte: "Lte",
  Contains: "Contains",
  In: "In",
} as const;

export type FilterOperator =
  (typeof FilterOperators)[keyof typeof FilterOperators];

export interface BaseFilter<T, TField extends keyof T = keyof T> {
  type: "field";
  field: TField;
  operator: FilterOperator;
  value: T[TField];
}

export interface AndFilter<T> {
  type: "and";
  filters: Filter<T>[];
}

export interface OrFilter<T> {
  type: "or";
  filters: Filter<T>[];
}

export type Filter<T> = BaseFilter<T> | AndFilter<T> | OrFilter<T>;
export type IFilter<T> = Filter<T>;

export const fieldFilter = <T, TField extends keyof T>(
  field: TField,
  operator: FilterOperator,
  value: T[TField],
): BaseFilter<T, TField> => ({
  type: "field",
  field,
  operator,
  value,
});

export const and = <T>(...filters: Filter<T>[]): AndFilter<T> => ({
  type: "and",
  filters,
});

export const or = <T>(...filters: Filter<T>[]): OrFilter<T> => ({
  type: "or",
  filters,
});

export interface SingleQuery<T> {
  filter?: Filter<T>;
}

export interface MultipleQuery<T> extends SingleQuery<T> {
  limit?: number;
  offset?: number;
}

export interface MultipleQueryResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  pages: number;
}

export interface Repository<T extends BaseEntity, TError extends TaggedError = TaggedError> {
  getOne: (query: SingleQuery<T>) => AsyncResult<T, TError>;
  getMany: (query: MultipleQuery<T>) => AsyncResult<MultipleQueryResult<T>, TError>;
  create: (entity: T) => AsyncResult<void, TError>;
  update: (entity: T) => AsyncResult<void, TError>;
  delete: (id: UUID) => AsyncResult<void, TError>;
}

export type BaseService<T extends BaseEntity, TError extends TaggedError = TaggedError> =
  Repository<T, TError>;
