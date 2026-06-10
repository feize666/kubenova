"use client";

import { SearchOutlined } from "@ant-design/icons";
import { Space } from "antd";
import type { ReactNode } from "react";
import { OpsIconActionButton, type OpsActiveFilter } from "@/components/ops";
import {
  ResourceFilterToolbar,
  ResourceFilterToolbarItem,
  ResourceKeywordSearch,
} from "@/components/resource-filter-toolbar";
import { ResourceScopeFilterButton } from "@/components/resource-scope-filter-button";

type Option = { label: string; value: string };

type ResourceClusterNamespaceFiltersProps = {
  clusterId: string;
  namespace?: string;
  keywordInput: string;
  clusterOptions: Option[];
  clusterLoading?: boolean;
  clusterUnavailable?: boolean;
  knownNamespaces?: string[];
  namespaceLoading?: boolean;
  namespaceDisabled?: boolean;
  namespacePlaceholder?: string;
  namespaceVisible?: boolean;
  onClusterChange: (value: string) => void;
  onNamespaceChange?: (value: string) => void;
  onScopeChange?: (clusterId: string, namespace: string) => void;
  onKeywordInputChange: (value: string) => void;
  onSearch: () => void;
  extraFilters?: ReactNode;
  keywordPlaceholder?: string;
  marginBottom?: number;
  showKeywordSearch?: boolean;
};

export function ResourceClusterNamespaceFilters({
  clusterId,
  namespace = "",
  keywordInput,
  clusterOptions,
  clusterLoading,
  clusterUnavailable = false,
  knownNamespaces = [],
  namespaceLoading = false,
  namespaceDisabled,
  namespacePlaceholder,
  namespaceVisible = true,
  onClusterChange,
  onNamespaceChange,
  onScopeChange,
  onKeywordInputChange,
  onSearch,
  extraFilters,
  keywordPlaceholder = "按名称/标签搜索",
  marginBottom = 12,
  showKeywordSearch = false,
}: ResourceClusterNamespaceFiltersProps) {
  const hasConcreteCluster = clusterId.trim().length > 0;
  const resolvedNamespaceDisabled = namespaceDisabled ?? !hasConcreteCluster;
  const resolvedNamespacePlaceholder =
    namespacePlaceholder ?? (hasConcreteCluster ? "全部名称空间" : "请先选择具体集群");
  const clusterLabel = clusterId
    ? clusterOptions.find((option) => option.value === clusterId)?.label ?? clusterId
    : "";
  const activeFilters: OpsActiveFilter[] = [
    clusterId
      ? {
          key: "cluster",
          label: "集群",
          value: clusterLabel,
          tone: "info",
          onClear: () => {
            if (onScopeChange) {
              onScopeChange("", "");
            } else {
              onClusterChange("");
              onNamespaceChange?.("");
            }
          },
        }
      : null,
    namespaceVisible && namespace
      ? {
          key: "namespace",
          label: "名称空间",
          value: namespace,
          tone: "neutral",
          onClear: () => {
            if (onScopeChange) {
              onScopeChange(clusterId, "");
            } else {
              onNamespaceChange?.("");
            }
          },
        }
      : null,
    showKeywordSearch && keywordInput.trim()
      ? {
          key: "keyword",
          label: "关键词",
          value: keywordInput.trim(),
          tone: "warning",
          onClear: () => {
            onKeywordInputChange("");
            window.queueMicrotask(onSearch);
          },
        }
      : null,
  ].filter(Boolean) as OpsActiveFilter[];

  return (
    <div style={{ marginBottom }}>
      <ResourceFilterToolbar
        activeFilters={activeFilters}
        actions={
          showKeywordSearch ? (
            <OpsIconActionButton icon={<SearchOutlined />} opsTone="primary" onClick={onSearch}>
              查询
            </OpsIconActionButton>
          ) : null
        }
      >
        <ResourceFilterToolbarItem width="auto">
          <ResourceScopeFilterButton
            clusterId={clusterId}
            namespace={namespace}
            clusterOptions={clusterOptions}
            clusterLoading={clusterLoading}
            clusterUnavailable={clusterUnavailable}
            knownNamespaces={knownNamespaces}
            namespaceLoading={namespaceLoading}
            namespaceDisabled={resolvedNamespaceDisabled}
            namespacePlaceholder={resolvedNamespacePlaceholder}
            namespaceVisible={namespaceVisible}
            onApply={({ clusterId: nextClusterId, namespace: nextNamespace }) => {
              if (onScopeChange) {
                onScopeChange(nextClusterId, nextNamespace);
              } else {
                onClusterChange(nextClusterId);
                onNamespaceChange?.(nextNamespace);
              }
            }}
          />
        </ResourceFilterToolbarItem>
        {showKeywordSearch ? (
          <ResourceKeywordSearch
            placeholder={keywordPlaceholder}
            value={keywordInput}
            onChange={onKeywordInputChange}
            onSearch={onSearch}
            onClearSearch={onSearch}
            width={namespaceVisible ? "lg" : "xl"}
          />
        ) : null}
        {extraFilters ? (
          <ResourceFilterToolbarItem width="auto">
            <Space size={8} wrap>
              {extraFilters}
            </Space>
          </ResourceFilterToolbarItem>
        ) : null}
      </ResourceFilterToolbar>
    </div>
  );
}
