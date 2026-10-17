"use client";

import { Result } from "antd";
import { useAuth } from "@/components/auth-context";
import { ObservabilityConfiguration } from "@/components/observability-configuration";
import { isPlatformAdmin } from "@/lib/console-routing";

export default function ObservabilityConfigurationPage() {
  const { isInitializing, role } = useAuth();
  if (!isInitializing && !isPlatformAdmin(role)) {
    return <Result status="403" title="仅超级管理员可访问" subTitle="观测配置仍在开发中，当前仅对超级管理员开放。" />;
  }
  return (
    <main data-observability-configuration-route="true">
      <ObservabilityConfiguration />
    </main>
  );
}
