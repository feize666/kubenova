"use client";

import { Alert, Card, Col, Input, Row, Select, Space, Switch, Table, Tag, Typography } from "antd";
import type { TableProps } from "antd";
import { useMemo, useState } from "react";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";
import { buildCompactTablePagination } from "@/lib/table/pagination";

export type ModuleRecord = {
  key: string;
  name: string;
  namespace?: string;
  status?: string;
  [key: string]: string | number | boolean | undefined;
};

type ModulePageProps = {
  title: string;
  description: string;
  columns: TableProps<ModuleRecord>["columns"];
  dataSource: ModuleRecord[];
  namespaceOptions?: string[];
  loading?: boolean;
  hasInitialData?: boolean;
  error?: string;
  tableProps?: TableProps<ModuleRecord>;
  filterState?: {
    keyword: string;
    namespace: string;
    onlyHealthy: boolean;
    onKeywordChange: (value: string) => void;
    onNamespaceChange: (value: string) => void;
    onOnlyHealthyChange: (value: boolean) => void;
  };
};

export type ModuleTableState = {
  keywordInput: string;
  keyword: string;
  namespace: string;
  page: number;
  pageSize: number;
  setKeywordInput: (value: string) => void;
  applyKeyword: () => void;
  setNamespace: (value: string) => void;
  setPage: (value: number) => void;
  setPageSize: (value: number) => void;
};

export function useModuleTableState(defaultPageSize = 10): ModuleTableState {
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [namespace, setNamespace] = useState<string>("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const applyKeyword = () => {
    setPage(1);
    setKeyword(keywordInput.trim());
  };

  return {
    keywordInput,
    keyword,
    namespace,
    page,
    pageSize,
    setKeywordInput,
    applyKeyword,
    setNamespace: (value: string) => {
      setNamespace(value);
      setPage(1);
    },
    setPage,
    setPageSize: (value: number) => {
      setPageSize(value);
      setPage(1);
    },
  };
}

function statusColor(status: string): string {
  if (status.includes("运行") || status.includes("就绪") || status.includes("已启用") || status.includes("正常")) {
    return "green";
  }
  if (status.includes("告警") || status.includes("异常") || status.includes("失败") || status.includes("高")) {
    return "red";
  }
  if (status.includes("待") || status.includes("暂停") || status.includes("低")) {
    return "gold";
  }
  return "blue";
}

export function ModulePage({
  title,
  description,
  columns,
  dataSource,
  namespaceOptions = [],
  loading = false,
  hasInitialData = false,
  error,
  tableProps,
  filterState,
}: ModulePageProps) {
  const [localKeyword, setLocalKeyword] = useState("");
  const [localNamespace, setLocalNamespace] = useState<string>("全部名称空间");
  const [localOnlyHealthy, setLocalOnlyHealthy] = useState(false);
  const keyword = filterState?.keyword ?? localKeyword;
  const namespace = filterState?.namespace ?? localNamespace;
  const onlyHealthy = filterState?.onlyHealthy ?? localOnlyHealthy;

  const handleKeywordChange = filterState?.onKeywordChange ?? setLocalKeyword;
  const handleNamespaceChange = filterState?.onNamespaceChange ?? setLocalNamespace;
  const handleOnlyHealthyChange = filterState?.onOnlyHealthyChange ?? setLocalOnlyHealthy;

  const filteredData = useMemo(() => {
    return dataSource.filter((item) => {
      const text = Object.values(item).join(" ").toLowerCase();
      const matchKeyword = text.includes(keyword.trim().toLowerCase());
      const matchNamespace =
        namespace === "全部名称空间" || !item.namespace || item.namespace === namespace;
      const matchHealthy =
        !onlyHealthy || !item.status || item.status.includes("运行") || item.status.includes("就绪") || item.status.includes("正常");
      return matchKeyword && matchNamespace && matchHealthy;
    });
  }, [dataSource, keyword, namespace, onlyHealthy]);

  const enhancedColumns = useMemo(() => {
    return (columns ?? []).map((column) => {
      const c = column as NonNullable<TableProps<ModuleRecord>["columns"]>[number] & { dataIndex?: string };
      if (c && c.dataIndex === "status" && !c.render) {
        return {
          ...c,
          render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag>,
        };
      }
      return c;
    });
  }, [columns]);

  const normalizedColumns = useMemo(() => {
    const adaptiveNameWidth = getAdaptiveNameWidth(dataSource.map((item) => item.name));

    return enhancedColumns.map((column, index) => {
      if (!column || typeof column !== "object") {
        return column;
      }
      const c = column as NonNullable<TableProps<ModuleRecord>["columns"]>[number] & { dataIndex?: string };
      if (c.dataIndex === "name") return { ...c, width: adaptiveNameWidth, ellipsis: c.ellipsis ?? true };
      if (c.dataIndex === "namespace") return { ...c, width: TABLE_COL_WIDTH.namespace };
      if (c.dataIndex === "clusterId" || c.key === "clusterId") return { ...c, width: TABLE_COL_WIDTH.cluster };
      if (c.dataIndex === "status") return { ...c, width: TABLE_COL_WIDTH.status };
      if (c.dataIndex === "updatedAt") return { ...c, width: TABLE_COL_WIDTH.updateTime };
      if (c.dataIndex === "keyCount") return { ...c, width: 120 };
      if (index === enhancedColumns.length - 1) return { ...c, width: c.width ?? TABLE_COL_WIDTH.action };
      return c;
    });
  }, [dataSource, enhancedColumns]);

  const tableScrollX = useMemo(
    () => getTableScrollX(normalizedColumns),
    [normalizedColumns],
  );

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <Typography.Title level={4} style={{ marginBottom: 8 }}>
          {title}
        </Typography.Title>
        <Typography.Text type="secondary">{description}</Typography.Text>
      </Card>

      <Card>
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} sm={12} md={8} lg={8}>
            <Input
              allowClear
              placeholder="请输入关键字筛选"
              value={keyword}
              onChange={(e) => handleKeywordChange(e.target.value)}
            />
          </Col>
          <Col xs={24} sm={12} md={8} lg={6}>
            <Select
              style={{ width: "100%" }}
              value={namespace}
              options={["全部名称空间", ...namespaceOptions].map((item) => ({ label: item, value: item }))}
              onChange={handleNamespaceChange}
            />
          </Col>
          <Col xs={24} sm={24} md={8} lg={10}>
            <Space>
              <Switch checked={onlyHealthy} onChange={handleOnlyHealthyChange} />
              <Typography.Text>仅显示健康资源</Typography.Text>
            </Space>
          </Col>
        </Row>
      </Card>

      {error ? <Alert type="error" showIcon message="数据加载失败" description={error} /> : null}

      <Card>
        <Table<ModuleRecord>
          rowKey="key"
          columns={normalizedColumns}
          dataSource={filteredData}
          loading={loading && !hasInitialData}
          scroll={{ x: tableScrollX }}
          pagination={buildCompactTablePagination({
            current: 1,
            pageSize: 6,
            total: filteredData.length,
            onChange: () => undefined,
          })}
          {...tableProps}
        />
      </Card>
    </Space>
  );
}
