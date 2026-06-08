"use client";

import { DynamicConfigResourcePage } from "@/components/configs/dynamic-config-resource-page";

export default function LimitRangesPage() {
  return (
    <DynamicConfigResourcePage
      path="/configs/limitranges"
      tableKey="configs.limitranges"
      titleKind="LimitRange"
      version="v1"
      resource="limitranges"
      kind="LimitRange"
      resourceType="limitrange"
      emptyDescription="暂无 LimitRange"
    />
  );
}
