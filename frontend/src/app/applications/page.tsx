"use client";

import { NodeIndexOutlined } from "@ant-design/icons";
import { Button, Empty } from "antd";
import Link from "next/link";
import { OpsLoadingState, OpsPermissionState, OpsSurface } from "@/components/ops";
import { useAuth } from "@/components/auth-context";
import { isPlatformAdmin } from "@/lib/console-routing";
import { ResourcePageHeader } from "@/components/resource-page-header";

export default function ApplicationsPage() {
  const { isAuthenticated, isInitializing, role } = useAuth();
  if (isInitializing) return <OpsLoadingState title="正在验证访问权限" />;
  if (!isAuthenticated || !isPlatformAdmin(role)) {
    return <OpsPermissionState title="仅超级管理员可访问" description="应用中心暂未向其他用户开放。" />;
  }
  return (
    <main className="portal-applications">
      <ResourcePageHeader title="应用中心" path="/applications" />
      <OpsSurface variant="panel" padding="lg">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无平台级应用">
          <Link href="/clusters">
            <Button type="primary" icon={<NodeIndexOutlined />}>选择集群</Button>
          </Link>
        </Empty>
      </OpsSurface>
    </main>
  );
}
