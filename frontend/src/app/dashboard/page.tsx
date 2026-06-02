"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BootstrapScreen } from "@/components/bootstrap-screen";

// /dashboard 保持向后兼容，跳转到根路径（智能仪表盘）。
export default function DashboardPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/");
  }, [router]);

  return <BootstrapScreen description="正在进入仪表盘..." />;
}
