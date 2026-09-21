"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { BootstrapScreen } from "@/components/bootstrap-screen";
import { getConsoleSurface } from "@/lib/console-routing";
import { useAuth } from "@/components/auth-context";
import { MfaRecovery } from "@/components/mfa-recovery";

const PortalShell = dynamic(
  () => import("@/components/shell-layout").then((mod) => mod.PortalShell),
  {
    loading: () => <BootstrapScreen description="正在加载控制台布局..." />,
    ssr: false,
  },
);

const ClusterWorkspaceShell = dynamic(
  () => import("@/components/cluster-workspace-shell").then((mod) => mod.ClusterWorkspaceShell),
  {
    loading: () => <BootstrapScreen description="正在加载集群工作区..." />,
    ssr: false,
  },
);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { recoveryCodes, enrollmentConfirming } = useAuth();
  if (recoveryCodes) return <MfaRecovery />;
  if (enrollmentConfirming) return <BootstrapScreen description="正在启用多因素验证..." />;
  const surface = getConsoleSurface(pathname);
  if (surface === "public") {
    return <>{children}</>;
  }

  if (surface === "cluster-workspace") {
    return (
      <Suspense fallback={<BootstrapScreen description="正在加载集群工作区..." />}>
        <ClusterWorkspaceShell>{children}</ClusterWorkspaceShell>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<BootstrapScreen description="正在加载控制台布局..." />}>
      <PortalShell>{children}</PortalShell>
    </Suspense>
  );
}
