"use client";

import { DynamicConfigResourcePage } from "@/components/configs/dynamic-config-resource-page";

export default function ResourceQuotasPage() {
  return (
    <DynamicConfigResourcePage
      path="/configs/resourcequotas"
      tableKey="configs.resourcequotas"
      titleKind="ResourceQuota"
      titleBadge="资源配额"
      version="v1"
      resource="resourcequotas"
      kind="ResourceQuota"
      resourceType="resourcequota"
      emptyDescription="暂无 ResourceQuota"
    />
  );
}
