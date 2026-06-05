"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { BootstrapScreen } from "@/components/bootstrap-screen";

const ShellLayout = dynamic(
  () => import("@/components/shell-layout").then((mod) => mod.ShellLayout),
  {
    loading: () => <BootstrapScreen description="正在加载控制台布局..." />,
    ssr: false,
  },
);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <Suspense fallback={<BootstrapScreen description="正在加载控制台布局..." />}>
      <ShellLayout>{children}</ShellLayout>
    </Suspense>
  );
}
