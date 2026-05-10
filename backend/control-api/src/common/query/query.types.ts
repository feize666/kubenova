import type { ResourceState } from '../contracts/resource-state.contract';

export type SortOrder = 'asc' | 'desc';

export interface QueryDefaults {
  page: number;
  pageSize: number;
  sortOrder: SortOrder;
}

export interface ListQuery {
  keyword?: string;
  state?: ResourceState;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
}

export interface DateRangeQuery {
  startTime?: string;
  endTime?: string;
}

export interface ScopeQuery {
  clusterId?: string;
  namespace?: string;
}
