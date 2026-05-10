import type { QueryDefaults } from './query.types';

export const DEFAULT_QUERY: QueryDefaults = {
  page: 1,
  pageSize: 20,
  sortOrder: 'desc',
};

export const PAGE_SIZE_LIMITS = {
  min: 1,
  max: 200,
} as const;
