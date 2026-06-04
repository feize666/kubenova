"use client";

import { AppstoreOutlined, DownOutlined } from "@ant-design/icons";
import { Badge, Button, Popover, Space, Typography } from "antd";
import { useMemo, useState } from "react";
import { ClusterSelect, type ClusterOption } from "@/components/cluster-select";
import { NamespaceSelect } from "@/components/namespace-select";
import { OpsPopoverPanel } from "@/components/ops";

type ResourceScopeFilterButtonProps = {
  clusterId: string;
  namespace?: string;
  clusterOptions: ClusterOption[];
  clusterLoading?: boolean;
  knownNamespaces?: string[];
  namespaceLoading?: boolean;
  namespaceDisabled?: boolean;
  namespacePlaceholder?: string;
  namespaceVisible?: boolean;
  label?: string;
  onApply: (values: { clusterId: string; namespace: string }) => void;
};

export function ResourceScopeFilterButton({
  clusterId,
  namespace = "",
  clusterOptions,
  clusterLoading,
  knownNamespaces = [],
  namespaceLoading = false,
  namespaceDisabled,
  namespacePlaceholder,
  namespaceVisible = true,
  label = "资源范围",
  onApply,
}: ResourceScopeFilterButtonProps) {
  const [open, setOpen] = useState(false);
  const [draftClusterId, setDraftClusterId] = useState(clusterId);
  const [draftNamespace, setDraftNamespace] = useState(namespace);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraftClusterId(clusterId);
      setDraftNamespace(namespace);
    }
    setOpen(nextOpen);
  };

  const clusterNameById = useMemo(() => {
    const map = new Map<string, string>();
    clusterOptions.forEach((option) => map.set(option.value, option.label));
    return map;
  }, [clusterOptions]);

  const hasConcreteDraftCluster = draftClusterId.trim().length > 0;
  const parentKeepsDraftDisabled = Boolean(namespaceDisabled && draftClusterId === clusterId);
  const resolvedNamespaceDisabled = !hasConcreteDraftCluster || parentKeepsDraftDisabled;
  const resolvedNamespacePlaceholder =
    namespacePlaceholder ?? (hasConcreteDraftCluster ? "全部名称空间" : "请先选择具体集群");
  const activeCount = Number(Boolean(clusterId)) + Number(Boolean(namespace));

  const summary = useMemo(() => {
    if (!clusterId && !namespace) return "全部资源";
    const clusterLabel = clusterId ? clusterNameById.get(clusterId) ?? clusterId : "全部集群";
    if (namespaceVisible && namespace) return `${clusterLabel} / ${namespace}`;
    return clusterLabel;
  }, [clusterId, clusterNameById, namespace, namespaceVisible]);

  const applyDraft = () => {
    onApply({ clusterId: draftClusterId, namespace: namespaceVisible ? draftNamespace : "" });
    setOpen(false);
  };

  const resetAndApply = () => {
    setDraftClusterId("");
    setDraftNamespace("");
    onApply({ clusterId: "", namespace: "" });
    setOpen(false);
  };

  const content = (
    <OpsPopoverPanel
      title="筛选范围"
      subtitle="应用后刷新列表"
      onReset={resetAndApply}
      onApply={applyDraft}
      className="resource-scope-filter-panel"
    >
      <Space direction="vertical" size={10} style={{ width: "100%" }}>
        <div>
          <Typography.Text className="resource-scope-filter-label">集群</Typography.Text>
          <ClusterSelect
            value={draftClusterId}
            onChange={(value) => {
              setDraftClusterId(value);
              setDraftNamespace("");
            }}
            options={clusterOptions}
            loading={clusterLoading}
            showAllOption
          />
        </div>
        {namespaceVisible ? (
          <div>
            <Typography.Text className="resource-scope-filter-label">名称空间</Typography.Text>
            <NamespaceSelect
              value={draftNamespace}
              onChange={setDraftNamespace}
              knownNamespaces={knownNamespaces}
              clusterId={draftClusterId}
              loading={namespaceLoading}
              disabled={resolvedNamespaceDisabled}
              placeholder={resolvedNamespacePlaceholder}
            />
          </div>
        ) : null}
      </Space>
    </OpsPopoverPanel>
  );

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      trigger="click"
      placement="bottomLeft"
      content={content}
      overlayClassName="resource-scope-filter-popover"
    >
      <Badge count={activeCount} size="small" offset={[-4, 4]}>
        <Button className="resource-scope-filter-button">
          <span className="resource-scope-filter-icon" aria-hidden>
            <AppstoreOutlined />
          </span>
          <span className="resource-scope-filter-copy">
            <span className="resource-scope-filter-field-label">{label} /</span>
            <span className="resource-scope-filter-value">
              <span className="resource-scope-filter-summary">{summary}</span>
            </span>
          </span>
          <span className="resource-scope-filter-affordance" aria-hidden>
            <DownOutlined className="resource-scope-filter-caret" aria-hidden />
          </span>
        </Button>
      </Badge>
    </Popover>
  );
}
