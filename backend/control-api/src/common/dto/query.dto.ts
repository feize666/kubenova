import type { ResourceState } from '../contracts/resource-state.contract';
import type { SortOrder } from '../query/query.types';

export interface PaginationQueryDto {
  page?: number;
  pageSize?: number;
}

export interface SortQueryDto {
  sortBy?: string;
  sortOrder?: SortOrder;
}

export interface FilterQueryDto {
  keyword?: string;
  state?: ResourceState;
  clusterId?: string;
  namespace?: string;
}

export interface ListQueryDto
  extends PaginationQueryDto, SortQueryDto, FilterQueryDto {}
