"use client";

import dynamic from "next/dynamic";
import { notFound, useParams } from "next/navigation";
import { BootstrapScreen } from "@/components/bootstrap-screen";
import {
  isSupportedClusterWorkspaceResource,
  type ClusterWorkspaceResourcePath,
} from "@/lib/cluster-workspace";

const loading = () => <BootstrapScreen description="正在加载集群资源..." />;

const resourcePages: Record<ClusterWorkspaceResourcePath, React.ComponentType> = {
  nodes: dynamic(() => import("@/app/clusters/nodes/page"), { loading }),
  namespaces: dynamic(() => import("@/app/namespaces/page"), { loading }),
  "workloads/deployments": dynamic(() => import("@/app/workloads/deployments/page"), { loading }),
  "workloads/statefulsets": dynamic(() => import("@/app/workloads/statefulsets/page"), { loading }),
  "workloads/daemonsets": dynamic(() => import("@/app/workloads/daemonsets/page"), { loading }),
  "workloads/pods": dynamic(() => import("@/app/workloads/pods/page"), { loading }),
  "workloads/jobs": dynamic(() => import("@/app/workloads/jobs/page"), { loading }),
  "workloads/cronjobs": dynamic(() => import("@/app/workloads/cronjobs/page"), { loading }),
  "workloads/replicasets": dynamic(() => import("@/app/workloads/replicasets/page"), { loading }),
  "workloads/autoscaling": dynamic(() => import("@/app/workloads/autoscaling/page"), { loading }),
  "workloads/autoscaling/hpa": dynamic(() => import("@/app/workloads/autoscaling/hpa/page"), { loading }),
  "workloads/autoscaling/vpa": dynamic(() => import("@/app/workloads/autoscaling/vpa/page"), { loading }),
  "workloads/create": dynamic(() => import("@/app/workloads/create/page"), { loading }),
  "network/services": dynamic(() => import("@/app/network/services/page"), { loading }),
  "network/ingress": dynamic(() => import("@/app/network/ingress/page"), { loading }),
  "network/endpoints": dynamic(() => import("@/app/network/endpoints/page"), { loading }),
  "network/endpointslices": dynamic(() => import("@/app/network/endpointslices/page"), { loading }),
  "network/networkpolicy": dynamic(() => import("@/app/network/networkpolicy/page"), { loading }),
  "network/gateway-api": dynamic(() => import("@/app/network/gateway-api/page"), { loading }),
  "network/topology": dynamic(() => import("@/app/network/topology/page"), { loading }),
  "storage/pv": dynamic(() => import("@/app/storage/pv/page"), { loading }),
  "storage/pvc": dynamic(() => import("@/app/storage/pvc/page"), { loading }),
  "storage/sc": dynamic(() => import("@/app/storage/sc/page"), { loading }),
  "configs/configmaps": dynamic(() => import("@/app/configs/configmaps/page"), { loading }),
  "configs/secrets": dynamic(() => import("@/app/configs/secrets/page"), { loading }),
  "configs/serviceaccounts": dynamic(() => import("@/app/configs/serviceaccounts/page"), { loading }),
  "configs/limitranges": dynamic(() => import("@/app/configs/limitranges/page"), { loading }),
  "configs/resourcequotas": dynamic(() => import("@/app/configs/resourcequotas/page"), { loading }),
  observability: dynamic(() => import("@/app/observability/page"), { loading }),
  inspection: dynamic(() => import("@/app/inspection/page"), { loading }),
  aiops: dynamic(() => import("@/app/aiops/page"), { loading }),
  logs: dynamic(() => import("@/app/logs/page"), { loading }),
  terminal: dynamic(() => import("@/app/terminal/page"), { loading }),
};

export function ClusterWorkspaceResourcePage() {
  const params = useParams<{ resource: string[] }>();
  const resourcePath = params.resource.join("/");
  if (!isSupportedClusterWorkspaceResource(resourcePath)) notFound();
  const Page = resourcePages[resourcePath];
  return <Page />;
}
