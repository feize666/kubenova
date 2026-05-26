"use client";

import { SearchOutlined } from "@ant-design/icons";
import { Button, Space } from "antd";
import type { ReactNode } from "react";
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

  return (
    <div style={{ marginBottom }}>
      <ResourceFilterToolbar
        actions={
          showKeywordSearch ? (
            <Button icon={<SearchOutlined />} type="primary" onClick={onSearch}>
              查询
            </Button>
          ) : null
        }
      >
        <ResourceFilterToolbarItem width="auto">
          <ResourceScopeFilterButton
            clusterId={clusterId}
            namespace={namespace}
            clusterOptions={clusterOptions}
            clusterLoading={clusterLoading}
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
