"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClusterWorkspaceHref } from "@/components/cluster-workspace-context";

export default function AutoscalingIndexPage() {
  const router = useRouter();
  const hpaHref = useClusterWorkspaceHref("/workloads/autoscaling/hpa");

  useEffect(() => {
    router.replace(hpaHref);
  }, [hpaHref, router]);

  return null;
}
