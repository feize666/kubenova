"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AutoscalingIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/workloads/autoscaling/hpa");
  }, [router]);

  return null;
}
