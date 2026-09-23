"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { BootstrapScreen } from "@/components/bootstrap-screen";
import { getConsoleSurface } from "@/lib/console-routing";
import { useAuth } from "@/components/auth-context";
import { MfaRecovery } from "@/components/mfa-recovery";

const FloatingAiAssistant = dynamic(
  () =>
    import("@/components/ai-assistant/floating-assistant").then(
      (mod) => mod.FloatingAiAssistant,
    ),
  { ssr: false },
);

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

  // 悬浮助手只在常规控制台页面出现：AI 助手页本身已有完整工作区，
  // 集群的日志/终端为全屏运行工作台，都不应叠加浮层。
  const floatingAssistantVisible =
    !pathname.startsWith("/ai-assistant") &&
    !/^\/clusters\/[^/]+\/(logs|terminal)\/?$/.test(pathname);

  const withFloatingAssistant = (content: React.ReactNode) =>
    floatingAssistantVisible ? (
      <>
        {content}
        <FloatingAiAssistant />
      </>
    ) : (
      <>{content}</>
    );

  if (surface === "cluster-workspace") {
    return withFloatingAssistant(
      <Suspense fallback={<BootstrapScreen description="正在加载集群工作区..." />}>
        <ClusterWorkspaceShell>{children}</ClusterWorkspaceShell>
      </Suspense>,
    );
  }

  return withFloatingAssistant(
    <Suspense fallback={<BootstrapScreen description="正在加载控制台布局..." />}>
      <PortalShell>{children}</PortalShell>
    </Suspense>,
  );
}
