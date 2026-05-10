"use client";

import { Button, Col, Input, Row, Select } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { NamespaceSelect } from "@/components/namespace-select";

type Option = { label: string; value: string };

type NetworkResourcePageFiltersProps = {
  clusterId: string;
  namespace: string;
  keywordInput: string;
  clusterOptions: Option[];
  clusterLoading?: boolean;
  knownNamespaces: string[];
  onClusterChange: (value: string) => void;
  onNamespaceChange: (value: string) => void;
  onKeywordInputChange: (value: string) => void;
  onSearch: () => void;
};

export function NetworkResourcePageFilters({
  clusterId,
  namespace,
  keywordInput,
  clusterOptions,
  clusterLoading,
  knownNamespaces,
  onClusterChange,
  onNamespaceChange,
  onKeywordInputChange,
  onSearch,
}: NetworkResourcePageFiltersProps) {
  return (
    <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 12 }}>
      <Col xs={24} sm={12} md={6} lg={4}>
        <Select
          style={{ width: "100%" }}
          placeholder="全部集群"
          value={clusterId || undefined}
          onChange={(value) => onClusterChange(value ?? "")}
          allowClear
          options={clusterOptions}
          loading={clusterLoading}
        />
      </Col>
      <Col xs={24} sm={12} md={5} lg={4}>
        <NamespaceSelect
          value={namespace}
          onChange={onNamespaceChange}
          knownNamespaces={knownNamespaces}
          clusterId={clusterId}
        />
      </Col>
      <Col xs={24} sm={16} md={7} lg={6}>
        <Input
          prefix={<SearchOutlined />}
          allowClear
          placeholder="按名称/标签搜索"
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
    </Row>
  );
}
