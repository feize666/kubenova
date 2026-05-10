"use client";

import { Suspense } from "react";
import { ShellLayout } from "@/components/shell-layout";
import { BootstrapScreen } from "@/components/bootstrap-screen";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<BootstrapScreen description="正在加载控制台布局..." />}>
      <ShellLayout>{children}</ShellLayout>
    </Suspense>
  );
}
