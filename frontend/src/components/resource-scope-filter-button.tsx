"use client";

import { AppstoreOutlined } from "@ant-design/icons";
import { Badge, Popover, Space, Typography } from "antd";
import { useMemo, useState } from "react";
import { ClusterSelect, type ClusterOption } from "@/components/cluster-select";
import { NamespaceSelect } from "@/components/namespace-select";
import { OpsFilterTriggerButton, OpsPopoverPanel } from "@/components/ops";
import { useClusterDisplayMap } from "@/hooks/use-cluster-display-map";
import { useRouteClusterScope } from "@/hooks/use-cluster-namespace-filter";
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
  const routeScope = useRouteClusterScope();
  const effectiveClusterId = routeScope.isFixed ? routeScope.clusterId : clusterId;
  const [open, setOpen] = useState(false);
  const [draftClusterId, setDraftClusterId] = useState(effectiveClusterId);
  const [draftNamespace, setDraftNamespace] = useState(namespace);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraftClusterId(effectiveClusterId);
      setDraftNamespace(namespace);
    }
    setOpen(nextOpen);
  };

  const clusterNameById = useClusterDisplayMap(clusterOptions, effectiveClusterId);
  const effectiveClusterName = effectiveClusterId
    ? getClusterDisplayName(Object.fromEntries(clusterNameById), effectiveClusterId)
    : "";

  const namespaceClusterId = routeScope.isFixed ? effectiveClusterId : draftClusterId;
  const hasConcreteDraftCluster = namespaceClusterId.trim().length > 0;
  const parentKeepsDraftDisabled = Boolean(namespaceDisabled && namespaceClusterId === clusterId);
  const resolvedNamespaceDisabled = !hasConcreteDraftCluster || parentKeepsDraftDisabled;
  const resolvedNamespacePlaceholder =
    namespacePlaceholder ?? (hasConcreteDraftCluster ? "全部名称空间" : "请先选择具体集群");
  const activeCount = Number(Boolean(effectiveClusterId)) + Number(Boolean(namespace));

  const summary = useMemo(() => {
    if (!effectiveClusterId && !namespace) return "全部资源";
    const clusterLabel = effectiveClusterId
      ? effectiveClusterName
      : "全部集群";
    if (namespaceVisible && namespace) return `${clusterLabel} / ${namespace}`;
    return clusterLabel;
  }, [effectiveClusterId, effectiveClusterName, namespace, namespaceVisible]);

  const applyDraft = () => {
    const nextClusterId = routeScope.isFixed ? effectiveClusterId : draftClusterId;
    const nextNamespace = namespaceVisible ? draftNamespace : "";
    emitResourceScopeChange({
      clusterId: nextClusterId,
      clusterName: nextClusterId
        ? getClusterDisplayName(Object.fromEntries(clusterNameById), nextClusterId)
        : "",
      namespace: nextNamespace,
    });
    onApply({ clusterId: nextClusterId, namespace: nextNamespace });
    setOpen(false);
  };

  const resetAndApply = () => {
    const nextClusterId = routeScope.isFixed ? effectiveClusterId : "";
    setDraftClusterId(nextClusterId);
    setDraftNamespace("");
    emitResourceScopeChange({
      clusterId: nextClusterId,
      clusterName: routeScope.isFixed ? effectiveClusterName : "",
      namespace: "",
    });
    onApply({ clusterId: nextClusterId, namespace: "" });
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
        {routeScope.isFixed ? (
          <div>
            <Typography.Text className="resource-scope-filter-label">当前集群</Typography.Text>
            <Typography.Text strong>{effectiveClusterName}</Typography.Text>
          </div>
        ) : (
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
        )}
        {namespaceVisible ? (
          <div>
            <Typography.Text className="resource-scope-filter-label">名称空间</Typography.Text>
            <NamespaceSelect
              value={draftNamespace}
              onChange={setDraftNamespace}
              knownNamespaces={knownNamespaces}
              clusterId={namespaceClusterId}
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
