"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { BootstrapScreen } from "@/components/bootstrap-screen";

export default function MonitoringPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/observability");
  }, [router]);

  return <BootstrapScreen title="正在跳转" description="正在前往可观测性..." />;
}
