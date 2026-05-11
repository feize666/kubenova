"use client";

import { SearchOutlined } from "@ant-design/icons";
import { Button, Col, Input, Row } from "antd";
import type { ReactNode } from "react";
import { ClusterSelect } from "@/components/cluster-select";
import { NamespaceSelect } from "@/components/namespace-select";

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
  onKeywordInputChange: (value: string) => void;
  onSearch: () => void;
  extraFilters?: ReactNode;
  keywordPlaceholder?: string;
  marginBottom?: number;
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
  onKeywordInputChange,
  onSearch,
  extraFilters,
  keywordPlaceholder = "按名称/标签搜索",
  marginBottom = 12,
}: ResourceClusterNamespaceFiltersProps) {
  const hasConcreteCluster = clusterId.trim().length > 0;
  const resolvedNamespaceDisabled = namespaceDisabled ?? !hasConcreteCluster;
  const resolvedNamespacePlaceholder =
    namespacePlaceholder ?? (hasConcreteCluster ? "全部名称空间" : "请先选择具体集群");

  return (
    <Row gutter={[12, 12]} align="middle" style={{ marginBottom }}>
      <Col xs={24} sm={12} md={6} lg={4}>
        <ClusterSelect
          value={clusterId}
          onChange={onClusterChange}
          options={clusterOptions}
          loading={clusterLoading}
          showAllOption
        />
      </Col>
      {namespaceVisible ? (
        <Col xs={24} sm={12} md={5} lg={4}>
          <NamespaceSelect
            value={namespace}
            onChange={onNamespaceChange ?? (() => undefined)}
            knownNamespaces={knownNamespaces}
            clusterId={clusterId}
            loading={namespaceLoading}
            disabled={resolvedNamespaceDisabled}
            placeholder={resolvedNamespacePlaceholder}
          />
        </Col>
      ) : null}
      <Col xs={24} sm={16} md={namespaceVisible ? 7 : 10} lg={namespaceVisible ? 6 : 8}>
        <Input
          prefix={<SearchOutlined />}
          allowClear
          placeholder={keywordPlaceholder}
          value={keywordInput}
          onChange={(event) => onKeywordInputChange(event.target.value)}
          onPressEnter={onSearch}
        />
      </Col>
      <Col xs={24} sm={12} md={4} lg={3}>
        <Button icon={<SearchOutlined />} type="primary" onClick={onSearch}>
          查询
        </Button>
      </Col>
      {extraFilters ? <Col xs={24}>{extraFilters}</Col> : null}
    </Row>
  );
}
