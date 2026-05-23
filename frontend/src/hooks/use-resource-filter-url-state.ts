"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type FilterUrlValues = {
  clusterId: string;
  namespace: string;
  keyword: string;
};

type SyncFilterUrlOptions = {
  clusterId: string;
  namespace: string;
  keyword: string;
  path?: string;
};
type SearchParamsLike = {
  get: (name: string) => string | null;
};

function normalizeFilterValues(values: FilterUrlValues): URLSearchParams {
  const params = new URLSearchParams();
  const clusterId = values.clusterId.trim();
  const namespace = values.namespace.trim();
  const keyword = values.keyword.trim();
  if (clusterId) params.set("clusterId", clusterId);
  if (namespace) params.set("namespace", namespace);
  if (keyword) params.set("keyword", keyword);
  return params;
}

export function readResourceFilterFromSearchParams(searchParams: SearchParamsLike): FilterUrlValues {
  const clusterId = searchParams.get("clusterId") ?? searchParams.get("cluster") ?? "";
  return {
    clusterId,
    namespace: searchParams.get("namespace") ?? "",
    keyword: searchParams.get("keyword") ?? "",
  };
}

export function useSyncResourceFilterUrlState({
  clusterId,
  namespace,
  keyword,
  path,
}: SyncFilterUrlOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const nextQuery = normalizeFilterValues({ clusterId, namespace, keyword }).toString();
    const currentQuery = normalizeFilterValues(readResourceFilterFromSearchParams(searchParams)).toString();
    const hasLegacyClusterParam = Boolean(searchParams.get("cluster")) && !Boolean(searchParams.get("clusterId"));
    if (nextQuery === currentQuery && !hasLegacyClusterParam) {
      return;
    }
    const basePath = path ?? pathname;
    router.replace(nextQuery ? `${basePath}?${nextQuery}` : basePath, { scroll: false });
  }, [clusterId, namespace, keyword, path, pathname, router, searchParams]);
}
