"use client";

import { hashKey, useQuery, type DefaultError, type QueryClient, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";
import { visibleResourceQueryData } from "@/lib/query/visible-resource-data";
import { useReadAccess } from "@/lib/query/read-access-state";

export function useResourceListQuery<TQueryFnData, TError = DefaultError, TData = TQueryFnData, TQueryKey extends QueryKey = QueryKey>(
  options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
  queryClient?: QueryClient,
) {
  const query = useQuery(options, queryClient);
  const permissionDenied = useReadAccess(hashKey(options.queryKey ?? []), query);
  return { ...query, data: permissionDenied ? undefined : visibleResourceQueryData(query) };
}
