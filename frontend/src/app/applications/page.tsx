"use client";

import { NodeIndexOutlined } from "@ant-design/icons";
import { Button, Empty } from "antd";
import Link from "next/link";
import { OpsSurface } from "@/components/ops";
import { ResourcePageHeader } from "@/components/resource-page-header";

export default function ApplicationsPage() {
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
