"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { BootstrapScreen } from "@/components/bootstrap-screen";
import { getConsoleSurface } from "@/lib/console-routing";

const PortalShell = dynamic(
  () => import("@/components/shell-layout").then((mod) => mod.PortalShell),
  {
    loading: () => <BootstrapScreen description="正在加载控制台布局..." />,
    ssr: false,
  },
);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const surface = getConsoleSurface(pathname);
  if (surface === "public") {
    return <>{children}</>;
  }

  return (
    <Suspense fallback={<BootstrapScreen description="正在加载控制台布局..." />}>
      <PortalShell>{children}</PortalShell>
    </Suspense>
  );
}
