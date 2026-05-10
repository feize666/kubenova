"use client";

import { Breadcrumb } from "antd";
import Link from "next/link";
import { useMemo } from "react";

type NetworkPageKey =
  | "services"
  | "endpoints"
  | "endpointslices"
  | "ingress"
  | "ingressroute";

interface NetworkTopBreadcrumbProps {
  current: NetworkPageKey;
  namespace?: string;
  keyword?: string;
  clusterId?: string;
}

const NETWORK_PAGE_META: Record<NetworkPageKey, { label: string; path: string }> = {
  services: { label: "Service", path: "/network/services" },
  endpoints: { label: "Endpoints", path: "/network/endpoints" },
  endpointslices: { label: "EndpointSlice", path: "/network/endpointslices" },
  ingress: { label: "Ingress", path: "/network/ingress" },
  ingressroute: { label: "IngressRoute", path: "/network/ingressroute" },
};

export function NetworkTopBreadcrumb({ current, namespace, keyword, clusterId }: NetworkTopBreadcrumbProps) {
  const query = useMemo(() => {
    const params = new URLSearchParams();
    const normalizedClusterId = clusterId?.trim();
    const normalizedNamespace = namespace?.trim();
    const normalizedKeyword = keyword?.trim();
    if (normalizedClusterId) params.set("cluster", normalizedClusterId);
    if (normalizedNamespace) params.set("namespace", normalizedNamespace);
    if (normalizedKeyword) params.set("keyword", normalizedKeyword);
    const serialized = params.toString();
    return serialized ? `?${serialized}` : "";
  }, [clusterId, keyword, namespace]);

  return (
    <Breadcrumb
      style={{ marginTop: -4, marginBottom: 4 }}
      items={(Object.keys(NETWORK_PAGE_META) as NetworkPageKey[]).map((key) => {
        const page = NETWORK_PAGE_META[key];
        return {
          title:
            key === current ? (
              page.label
            ) : (
              <Link href={`${page.path}${query}`}>{page.label}</Link>
            ),
        };
      })}
    />
  );
}
