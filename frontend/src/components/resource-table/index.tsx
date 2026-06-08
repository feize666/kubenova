"use client";

import { Table, Typography } from "antd";
import type { TableProps } from "antd";
import type { ColumnsType, ColumnType } from "antd/es/table";
import { isValidElement, useCallback, useMemo, type Key, type ReactNode } from "react";
import {
  getStandardResourceTableScrollX,
  normalizeResourceTableColumns,
  type StandardTableLayoutOptions,
} from "@/lib/table-column-widths";
import { buildResourceTableLoading, type ResourceTableLoadingOptions } from "@/lib/table/pagination";
import {
  useHeadlampTableState,
  type HeadlampGlobalSearchState,
  type HeadlampResourceTableColumn,
  type HeadlampTableColumnSetting,
  type HeadlampTableFilters,
  type HeadlampTableSortState,
} from "@/lib/table/headlamp-table";
import type { TablePreferencesClient } from "@/lib/api/table-preferences";
import type { ResourceDetailDrawerProps } from "@/components/resource-detail";
import { ResourceTableToolbar } from "@/components/resource-table-toolbar";
import { OpsEmptyState, OpsErrorState, OpsFilteredEmptyState, OpsLoadingState, OpsPermissionState, OpsState } from "@/components/ops";

export const RESOURCE_TABLE_CLASS_NAME = "resource-table";

type ResourceTableNavigateRequest = NonNullable<ResourceDetailDrawerProps["request"]>;
type ResourceTableNavigateHandler = (request: ResourceTableNavigateRequest) => void;

function getResourceTableClassName(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

function getStableResourceRowKey<T extends object>(record: T, index?: number): Key {
  const value = record as Record<string, unknown>;
  const metadata = value.metadata && typeof value.metadata === "object"
    ? value.metadata as Record<string, unknown>
    : undefined;
  const directKey = value.key ?? value.id ?? value.uid ?? metadata?.uid;
  if (typeof directKey === "string" || typeof directKey === "number") {
    return directKey;
  }

  const namespace = metadata?.namespace ?? value.namespace;
  const name = metadata?.name ?? value.name;
  if ((typeof name === "string" || typeof name === "number") && (typeof namespace === "string" || typeof namespace === "number")) {
    return `${namespace}/${name}`;
  }
  if (typeof name === "string" || typeof name === "number") {
    return name;
  }

  return index ?? 0;
}

function toStringCellValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

const RESOURCE_RECORD_KEY_ALIASES: Record<string, string[]> = {
  kind: ["kind", "resourceKind", "type", "资源类型"],
  resourceKind: ["resourceKind", "kind", "type", "资源类型"],
  type: ["type", "kind", "resourceKind", "资源类型"],
  name: ["name", "resourceName", "名称", "原始名称"],
  resourceName: ["resourceName", "name", "名称", "原始名称"],
  clusterId: ["clusterId", "cluster", "clusterName", "集群"],
  cluster: ["cluster", "clusterId", "clusterName", "集群"],
  clusterName: ["clusterName", "clusterId", "cluster", "集群"],
  namespace: ["namespace", "namespaceName", "名称空间", "命名空间"],
  namespaceName: ["namespaceName", "namespace", "名称空间", "命名空间"],
  node: ["node", "nodeName", "节点"],
  nodeName: ["nodeName", "node", "节点"],
};

function expandRecordKeys(keys: string[]): string[] {
  return Array.from(new Set(keys.flatMap((key) => RESOURCE_RECORD_KEY_ALIASES[key] ?? [key])));
}

function getRecordString(record: object, keys: string[]): string {
  const value = record as Record<string, unknown>;
  const expandedKeys = expandRecordKeys(keys);
  for (const key of expandedKeys) {
    const next = toStringCellValue(value[key]);
    if (next) return next;
  }
  const metadata = value.metadata && typeof value.metadata === "object"
    ? value.metadata as Record<string, unknown>
    : undefined;
  if (metadata) {
    for (const key of expandedKeys) {
      const next = toStringCellValue(metadata[key]);
      if (next) return next;
    }
  }
  return "";
}

function getColumnIdentity<T extends object>(column: ColumnsType<T>[number]): string {
  if (!column || typeof column !== "object") return "";
  const key = "key" in column ? toStringCellValue(column.key) : "";
  if (key) return key;
  const dataIndex = "dataIndex" in column ? column.dataIndex : undefined;
  if (typeof dataIndex === "string") return dataIndex;
  if (Array.isArray(dataIndex)) return dataIndex.map(String).join(".");
  return "";
}

function normalizeNavigationColumnKey(columnKey: string): string {
  const normalized = columnKey.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const aliases: Record<string, string> = {
    name: "name",
    resourcename: "name",
    名称: "name",
    资源名称: "name",
    原始名称: "name",
    cluster: "cluster",
    clusterid: "cluster",
    clustername: "cluster",
    集群: "cluster",
    集群名称: "cluster",
    namespace: "namespace",
    namespaceid: "namespace",
    namespacename: "namespace",
    namespace名称: "namespace",
    名称空间: "namespace",
    命名空间: "namespace",
    node: "node",
    nodename: "node",
    节点: "node",
    节点名称: "node",
  };
  return aliases[normalized] ?? "";
}

function getCellValueFromColumn<T extends object>(column: ColumnType<T>, record: T): unknown {
  const dataIndex = column.dataIndex;
  if (typeof dataIndex === "string" || typeof dataIndex === "number") {
    return (record as Record<string, unknown>)[dataIndex];
  }
  if (Array.isArray(dataIndex)) {
    return dataIndex.reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[String(key)];
    }, record);
  }
  return undefined;
}

function shouldLinkValue(value: unknown): boolean {
  const text = toStringCellValue(value);
  return Boolean(text && text !== "-" && text !== "—" && text.toLowerCase() !== "n/a");
}

function buildColumnNavigationRequest<T extends object>(
  columnKey: string,
  record: T,
  value: unknown,
): ResourceTableNavigateRequest | null {
  const navigationKey = normalizeNavigationColumnKey(columnKey);

  if (navigationKey === "name") {
    const kind = normalizeNavigationKind(getRecordString(record, ["kind", "resourceKind", "type"]));
    const name = toStringCellValue(value) || getRecordString(record, ["name"]);
    const clusterId = getRecordString(record, ["clusterId", "cluster"]);
    const namespace = getRecordString(record, ["namespace", "namespaceName"]);
    const clusterScoped = new Set(["PersistentVolume", "StorageClass", "GatewayClass", "Cluster", "Node", "Namespace"]);
    const id =
      getRecordString(record, ["id"]) ||
      (kind === "Cluster"
        ? clusterId || name
        : kind === "Namespace" && clusterId
          ? `live-namespace:${clusterId}:${name}`
          : kind === "Node" && clusterId
            ? `live-node:${clusterId}:${name}`
            : clusterId
              ? clusterScoped.has(kind)
                ? `${clusterId}//${name}`
                : `${clusterId}/${namespace || "default"}/${name}`
              : "");
    if (!id || !kind || !name) return null;
    return {
      kind,
      id,
      name,
      label: name,
    };
  }

  if (navigationKey === "cluster") {
    const clusterId = getRecordString(record, ["clusterId", "cluster", "clusterName"]);
    if (!clusterId || clusterId === "all") return null;
    return {
      kind: "Cluster",
      id: clusterId,
      name: clusterId,
      label: toStringCellValue(value) || clusterId,
    };
  }

  if (navigationKey === "namespace") {
    const namespace = toStringCellValue(value) || getRecordString(record, ["namespace", "namespaceName"]);
    const clusterId = getRecordString(record, ["clusterId", "cluster"]);
    const namespaceId = getRecordString(record, ["namespaceId"]);
    if (!namespace || namespace === "all") return null;
    const id = clusterId ? `live-namespace:${clusterId}:${namespace}` : namespaceId;
    if (!id) return null;
    return {
      kind: "Namespace",
      id,
      namespace,
      name: namespace,
      label: namespace,
    };
  }

  if (navigationKey === "node") {
    const nodeName = toStringCellValue(value) || getRecordString(record, ["nodeName", "node"]);
    const clusterId = getRecordString(record, ["clusterId", "cluster"]);
    if (!nodeName || !clusterId) return null;
    return {
      kind: "Node",
      id: `live-node:${clusterId}:${nodeName}`,
      name: nodeName,
      label: nodeName,
    };
  }

  return null;
}

function normalizeNavigationKind(kind: string): string {
  const normalized = kind.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return "";
  if (normalized === "hpa") return "HorizontalPodAutoscaler";
  if (normalized === "vpa") return "VerticalPodAutoscaler";
  if (normalized === "pvc") return "PersistentVolumeClaim";
  if (normalized === "pv") return "PersistentVolume";
  if (normalized === "sc") return "StorageClass";
  return kind;
}

function renderNavigableCell(input: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { children, disabled, onClick } = input;
  if (disabled) return children;
  return (
    <Typography.Link
      className="resource-table-resource-link"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </Typography.Link>
  );
}

function isInteractiveResourceCell(content: ReactNode): boolean {
  if (!isValidElement(content)) return false;
  const props = content.props as { onClick?: unknown; className?: unknown };
  return (
    typeof props.onClick === "function" ||
    (typeof props.className === "string" && props.className.includes("resource-table-resource-link"))
  );
}

function enhanceResourceNavigationColumns<T extends object>(
  columns: ColumnsType<T>,
  onResourceNavigate?: ResourceTableNavigateHandler,
): ColumnsType<T> {
  if (!onResourceNavigate) return columns;
  return columns.map((column) => {
    if (!column || typeof column !== "object") return column;
    if ("children" in column && column.children) {
      return {
        ...column,
        children: enhanceResourceNavigationColumns(column.children as ColumnsType<T>, onResourceNavigate),
      };
    }

    const columnKey = getColumnIdentity(column);
    const navigationColumnKey = normalizeNavigationColumnKey(columnKey);
    if (!navigationColumnKey) {
      return column;
    }

    const baseColumn = column as ColumnType<T>;
    const previousRender = baseColumn.render;
    return {
      ...baseColumn,
      render: (value: unknown, record: T, index: number) => {
        const rawValue = value ?? getCellValueFromColumn(baseColumn, record);
        const content = previousRender
          ? previousRender(value as never, record, index)
          : toStringCellValue(rawValue) || "—";
        if (navigationColumnKey === "name" && previousRender && isInteractiveResourceCell(content as ReactNode)) {
          return content;
        }
        const request = buildColumnNavigationRequest(columnKey, record, rawValue);
        const linkValue = rawValue ?? request?.label ?? request?.name ?? request?.id;
        return renderNavigableCell({
          children: content as ReactNode,
          disabled: !request || !shouldLinkValue(linkValue),
          onClick: () => {
            if (request) onResourceNavigate(request);
          },
        });
      },
    };
  });
}

export type ResourceTableProps<T extends object> = Omit<
  TableProps<T>,
  "columns" | "loading" | "locale" | "scroll"
> & {
  columns: ColumnsType<T>;
  tableKey?: string;
  columnSettings?: HeadlampTableColumnSetting[];
  globalSearch?: HeadlampGlobalSearchState;
  filters?: HeadlampTableFilters;
  onFiltersChange?: (filters: HeadlampTableFilters) => void;
  sort?: HeadlampTableSortState;
  initialFilterRowVisible?: boolean;
  preferencesClient?: TablePreferencesClient;
  toolbarExtra?: ReactNode;
  showToolbar?: boolean;
  loading?: TableProps<T>["loading"];
  loadingOptions?: ResourceTableLoadingOptions;
  onResourceNavigate?: ResourceTableNavigateHandler;
  emptyDescription?: string;
  state?: "idle" | "loading" | "empty" | "filtered-empty" | "error" | "degraded" | "permission";
  stateTitle?: ReactNode;
  stateDescription?: ReactNode;
  stateAction?: ReactNode;
  layoutOptions?: StandardTableLayoutOptions<T>;
  scroll?: TableProps<T>["scroll"];
  locale?: TableProps<T>["locale"];
};

export function ResourceTable<T extends object>({
  bordered = true,
  className,
  columnSettings,
  columns,
  emptyDescription = "暂无资源数据",
  filters,
  globalSearch,
  initialFilterRowVisible,
  layoutOptions,
  loading,
  loadingOptions,
  locale,
  onChange,
  onFiltersChange,
  onResourceNavigate,
  pagination,
  preferencesClient,
  scroll,
  showToolbar = true,
  size,
  sort,
  state,
  stateAction,
  stateDescription,
  stateTitle,
  tableKey,
  toolbarExtra,
  ...restProps
}: ResourceTableProps<T>) {
  if (tableKey) {
    return (
      <HeadlampResourceTable<T>
        {...restProps}
        bordered={bordered}
        className={className}
        columnSettings={columnSettings}
        columns={columns}
        emptyDescription={emptyDescription}
        filters={filters}
        globalSearch={globalSearch}
        initialFilterRowVisible={initialFilterRowVisible}
        layoutOptions={layoutOptions}
        loading={loading}
        loadingOptions={loadingOptions}
        locale={locale}
        onChange={onChange}
        onFiltersChange={onFiltersChange}
        onResourceNavigate={onResourceNavigate}
        pagination={pagination}
        preferencesClient={preferencesClient}
        scroll={scroll}
        showToolbar={showToolbar}
        size={size}
        sort={sort}
        state={state}
        stateAction={stateAction}
        stateDescription={stateDescription}
        stateTitle={stateTitle}
        tableKey={tableKey}
        toolbarExtra={toolbarExtra}
      />
    );
  }

  return (
    <StandardResourceTable<T>
      {...restProps}
      bordered={bordered}
      className={className}
      columns={columns}
      emptyDescription={emptyDescription}
      layoutOptions={layoutOptions}
      loading={loading}
      loadingOptions={loadingOptions}
      locale={locale}
      onResourceNavigate={onResourceNavigate}
      pagination={pagination}
      scroll={scroll}
      size={size}
      state={state}
      stateAction={stateAction}
      stateDescription={stateDescription}
      stateTitle={stateTitle}
    />
  );
}

function renderResourceTableState(input: {
  emptyDescription?: string;
  isLoading: boolean;
  state?: ResourceTableProps<object>["state"];
  stateTitle?: ReactNode;
  stateDescription?: ReactNode;
  stateAction?: ReactNode;
}) {
  const { emptyDescription, isLoading, state = "idle", stateAction, stateDescription, stateTitle } = input;

  if (state === "loading" || (state === "idle" && isLoading)) {
    return <OpsLoadingState compact title={stateTitle ?? "正在加载资源数据"} description={stateDescription} action={stateAction} />;
  }
  if (state === "filtered-empty") {
    return <OpsFilteredEmptyState compact title={stateTitle ?? "没有匹配结果"} description={stateDescription ?? "调整筛选条件后重试。"} action={stateAction} />;
  }
  if (state === "error") {
    return <OpsErrorState compact title={stateTitle ?? "资源数据加载失败"} description={stateDescription ?? "请刷新后重试。"} action={stateAction} />;
  }
  if (state === "degraded") {
    return <OpsState compact kind="degraded" title={stateTitle ?? "数据源已降级"} description={stateDescription ?? "当前列表可能不是完整实时数据。"} action={stateAction} />;
  }
  if (state === "permission") {
    return <OpsPermissionState compact title={stateTitle ?? "没有查看权限"} description={stateDescription ?? "请检查当前账号权限。"} action={stateAction} />;
  }
  return <OpsEmptyState compact title={stateTitle ?? emptyDescription ?? "暂无资源数据"} description={stateDescription} action={stateAction} />;
}

function StandardResourceTable<T extends object>({
  bordered,
  className,
  columns,
  emptyDescription,
  layoutOptions,
  loading,
  loadingOptions,
  locale,
  onResourceNavigate,
  pagination,
  scroll,
  size,
  state,
  stateAction,
  stateDescription,
  stateTitle,
  ...restProps
}: ResourceTableProps<T>) {
  const normalizedLayoutOptions = useMemo(
    () => ({
      ...layoutOptions,
      autoFit:
        typeof layoutOptions?.autoFit === "object"
          ? { rows: restProps.dataSource, ...layoutOptions.autoFit }
          : { rows: restProps.dataSource, enabled: layoutOptions?.autoFit },
    }),
    [layoutOptions, restProps.dataSource],
  );
  const normalizedColumns = useMemo(
    () => normalizeResourceTableColumns(enhanceResourceNavigationColumns(columns, onResourceNavigate), normalizedLayoutOptions),
    [columns, normalizedLayoutOptions, onResourceNavigate],
  );
  const nextScroll = useMemo(
    () => scroll ?? { x: getStandardResourceTableScrollX(normalizedColumns) },
    [normalizedColumns, scroll],
  );
  const nextLoading = useMemo(
    () => loading ?? buildResourceTableLoading(loadingOptions),
    [loading, loadingOptions],
  );
  const isLoading = typeof nextLoading === "boolean" ? nextLoading : Boolean(nextLoading?.spinning);
  const nextLocale = useMemo(
    () => ({
      ...locale,
      emptyText:
        locale?.emptyText ??
        renderResourceTableState({ emptyDescription, isLoading, state, stateAction, stateDescription, stateTitle }),
    }),
    [emptyDescription, isLoading, locale, state, stateAction, stateDescription, stateTitle],
  );
  const nextClassName = useMemo(
    () => getResourceTableClassName(RESOURCE_TABLE_CLASS_NAME, state ? `resource-table--state-${state}` : undefined, className),
    [className, state],
  );
  const nextRowKey = restProps.rowKey ?? getStableResourceRowKey<T>;

  return (
    <Table<T>
      {...restProps}
      bordered={bordered}
      className={nextClassName}
      columns={normalizedColumns}
      loading={nextLoading}
      locale={nextLocale}
      pagination={pagination}
      rowKey={nextRowKey}
      scroll={nextScroll}
      size={size}
      tableLayout={restProps.tableLayout ?? "fixed"}
    />
  );
}

function HeadlampResourceTable<T extends object>({
  bordered,
  className,
  columnSettings,
  columns,
  emptyDescription,
  filters,
  globalSearch,
  initialFilterRowVisible,
  layoutOptions,
  loading,
  loadingOptions,
  locale,
  onChange,
  onFiltersChange,
  onResourceNavigate,
  pagination,
  preferencesClient,
  scroll,
  showToolbar,
  size,
  sort,
  state,
  stateAction,
  stateDescription,
  stateTitle,
  tableKey,
  toolbarExtra,
  ...restProps
}: ResourceTableProps<T> & { tableKey: string }) {
  const headlampColumns = useMemo(
    () =>
      columns.filter(
        (column): column is HeadlampResourceTableColumn<T> =>
          Boolean(column && typeof column === "object" && "key" in column && typeof column.key === "string"),
      ),
    [columns],
  );
  const table = useHeadlampTableState<T>({
    tableKey,
    columns: headlampColumns,
    columnSettings,
    filters,
    globalSearch,
    initialFilterRowVisible,
    onFiltersChange,
    preferencesClient,
    sort,
  });
  const normalizedLayoutOptions = useMemo(
    () => ({
      ...layoutOptions,
      autoFit:
        typeof layoutOptions?.autoFit === "object"
          ? { rows: restProps.dataSource, ...layoutOptions.autoFit }
          : { rows: restProps.dataSource, enabled: layoutOptions?.autoFit },
    }),
    [layoutOptions, restProps.dataSource],
  );
  const normalizedColumns = useMemo(
    () => normalizeResourceTableColumns(enhanceResourceNavigationColumns(table.columns, onResourceNavigate), normalizedLayoutOptions),
    [normalizedLayoutOptions, onResourceNavigate, table.columns],
  );
  const nextScroll = useMemo(
    () => scroll ?? { x: getStandardResourceTableScrollX(normalizedColumns) },
    [normalizedColumns, scroll],
  );
  const nextLoading = useMemo(
    () => loading ?? buildResourceTableLoading(loadingOptions),
    [loading, loadingOptions],
  );
  const isLoading = typeof nextLoading === "boolean" ? nextLoading : Boolean(nextLoading?.spinning);
  const nextLocale = useMemo(
    () => ({
      ...locale,
      emptyText:
        locale?.emptyText ??
        renderResourceTableState({ emptyDescription, isLoading, state, stateAction, stateDescription, stateTitle }),
    }),
    [emptyDescription, isLoading, locale, state, stateAction, stateDescription, stateTitle],
  );

  type TableChangeHandler = NonNullable<TableProps<T>["onChange"]>;
  const handleChange = useCallback<TableChangeHandler>((nextPagination, nextFilters, sorter, extra) => {
    if (extra?.action === "sort" && !Array.isArray(sorter) && sort?.onChange) {
      const nextSortBy =
        typeof sorter.columnKey === "string"
          ? sorter.columnKey
          : typeof sorter.field === "string"
            ? sorter.field
            : undefined;
      const nextSortOrder =
        sorter.order === "ascend" ? "asc" : sorter.order === "descend" ? "desc" : undefined;
      sort.onChange(nextSortOrder ? nextSortBy : undefined, nextSortOrder);
    }
    onChange?.(nextPagination, nextFilters, sorter, extra);
  }, [onChange, sort]);
  const nextClassName = useMemo(
    () =>
      getResourceTableClassName(
        RESOURCE_TABLE_CLASS_NAME,
        "resource-table-headlamp",
        state ? `resource-table--state-${state}` : undefined,
        table.filterRowVisible ? "resource-table-filter-row-visible" : undefined,
        className,
      ),
    [className, state, table.filterRowVisible],
  );
  const nextRowKey = restProps.rowKey ?? getStableResourceRowKey<T>;

  return (
    <div className="resource-table-shell">
      {showToolbar ? <ResourceTableToolbar<T> table={table} extra={toolbarExtra} /> : null}
      <Table<T>
        {...restProps}
        bordered={bordered}
        className={nextClassName}
        columns={normalizedColumns}
        loading={nextLoading}
        locale={nextLocale}
        onChange={handleChange}
        pagination={pagination}
        rowKey={nextRowKey}
        scroll={nextScroll}
        size={size}
        tableLayout={restProps.tableLayout ?? "fixed"}
      />
    </div>
  );
}

export type {
  HeadlampGlobalSearchState,
  HeadlampResourceTableColumn,
  HeadlampTableColumnSetting,
  HeadlampTableFilters,
  HeadlampTableSortState,
};
