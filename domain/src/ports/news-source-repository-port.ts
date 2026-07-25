import type {
  CountryCode,
  LanguageCode,
  NewsSource,
  NewsSourceApprovalStatus,
  NewsSourceOrientation,
  NewsSourceRegion,
  NewsSourceType,
} from "../entities/news-source.js";
import type { AsyncResult } from "../types/result.js";
import type { UUID } from "../types/uuid.js";
import type { PortError, PortOperationOptions } from "./common.js";

export interface NewsSourceRepositoryFilters {
  active?: boolean | undefined;
  orientation?: NewsSourceOrientation | undefined;
  type?: NewsSourceType | undefined;
  region?: NewsSourceRegion | undefined;
  country?: CountryCode | undefined;
  language?: LanguageCode | undefined;
  approvalStatus?: NewsSourceApprovalStatus | undefined;
}

export interface NewsSourceRepositoryListOptions
  extends PortOperationOptions {
  maxItems?: number | undefined;
}

export interface NewsSourceRepositoryPort {
  getById: (input: {
    id: UUID;
    options?: PortOperationOptions | undefined;
  }) => AsyncResult<NewsSource | null, PortError>;
  list: (input?: {
    filters?: NewsSourceRepositoryFilters | undefined;
    options?: NewsSourceRepositoryListOptions | undefined;
  }) => AsyncResult<readonly NewsSource[], PortError>;
  save: (input: {
    source: NewsSource;
    options?: PortOperationOptions | undefined;
  }) => AsyncResult<void, PortError>;
  delete: (input: {
    id: UUID;
    options?: PortOperationOptions | undefined;
  }) => AsyncResult<void, PortError>;
}
