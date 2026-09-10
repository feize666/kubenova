"use client";

import { AppstoreOutlined } from "@ant-design/icons";
import { Badge, Popover, Space, Typography } from "antd";
import { useMemo, useState } from "react";
import { ClusterSelect, type ClusterOption } from "@/components/cluster-select";
import { NamespaceSelect } from "@/components/namespace-select";
import { useOptionalClusterWorkspace } from "@/components/cluster-workspace-context";
import { OpsFilterTriggerButton, OpsPopoverPanel } from "@/components/ops";
import { useClusterDisplayMap } from "@/hooks/use-cluster-display-map";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { emitResourceScopeChange } from "@/lib/resource-scope-events";

type ResourceScopeFilterButtonProps = {
  clusterId: string;
  namespace?: string;
  clusterOptions: ClusterOption[];
  clusterLoading?: boolean;
  clusterUnavailable?: boolean;
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
  clusterUnavailable = false,
  knownNamespaces = [],
  namespaceLoading = false,
  namespaceDisabled,
  namespacePlaceholder,
  namespaceVisible = true,
  label = "资源范围",
  onApply,
}: ResourceScopeFilterButtonProps) {
  const workspace = useOptionalClusterWorkspace();
  const isWorkspaceLocked = Boolean(workspace);
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

  const clusterNameById = useClusterDisplayMap(clusterOptions, clusterId);

  const hasConcreteDraftCluster = draftClusterId.trim().length > 0;
  const parentKeepsDraftDisabled = Boolean(namespaceDisabled && draftClusterId === clusterId);
  const resolvedNamespaceDisabled = !hasConcreteDraftCluster || parentKeepsDraftDisabled;
  const resolvedNamespacePlaceholder =
    namespacePlaceholder ?? (hasConcreteDraftCluster ? "全部名称空间" : "请先选择具体集群");
  const activeCount = Number(!isWorkspaceLocked && Boolean(clusterId)) + Number(Boolean(namespace));

  const summary = useMemo(() => {
    if (isWorkspaceLocked) return namespaceVisible && namespace ? namespace : "全部名称空间";
    if (!clusterId && !namespace) return "全部资源";
    const clusterLabel = clusterId
      ? getClusterDisplayName(Object.fromEntries(clusterNameById), clusterId)
      : "全部集群";
    if (namespaceVisible && namespace) return `${clusterLabel} / ${namespace}`;
    return clusterLabel;
  }, [clusterId, clusterNameById, isWorkspaceLocked, namespace, namespaceVisible]);

  const applyDraft = () => {
    const nextNamespace = namespaceVisible ? draftNamespace : "";
    emitResourceScopeChange({
      clusterId: draftClusterId,
      clusterName: draftClusterId ? getClusterDisplayName(Object.fromEntries(clusterNameById), draftClusterId) : "",
      namespace: nextNamespace,
    });
    onApply({ clusterId: draftClusterId, namespace: nextNamespace });
    setOpen(false);
  };

  const resetAndApply = () => {
    setDraftClusterId(isWorkspaceLocked ? clusterId : "");
    setDraftNamespace("");
    emitResourceScopeChange({ clusterId: isWorkspaceLocked ? clusterId : "", namespace: "" });
    onApply({ clusterId: isWorkspaceLocked ? clusterId : "", namespace: "" });
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
      <Space orientation="vertical" size={10} style={{ width: "100%" }}>
        {!isWorkspaceLocked ? (
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
              unavailable={clusterUnavailable}
              showAllOption
            />
          </div>
        ) : null}
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

  if (isWorkspaceLocked && !namespaceVisible) return null;

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
        <OpsFilterTriggerButton
          active={open || activeCount > 0}
          icon={<AppstoreOutlined />}
          label={label}
          value={summary}
        />
      </Badge>
    </Popover>
  );
}
