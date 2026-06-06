"use client";

import { Empty, Table } from "antd";
import type { TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useMemo, type ReactNode } from "react";
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
import { ResourceTableToolbar } from "@/components/resource-table-toolbar";

export const RESOURCE_TABLE_CLASS_NAME = "resource-table";

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
  emptyDescription?: string;
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
  pagination,
  preferencesClient,
  scroll,
  showToolbar = true,
  size,
  sort,
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
        pagination={pagination}
        preferencesClient={preferencesClient}
        scroll={scroll}
        showToolbar={showToolbar}
        size={size}
        sort={sort}
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
      pagination={pagination}
      scroll={scroll}
      size={size}
    />
  );
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
  pagination,
  scroll,
  size,
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
    () => normalizeResourceTableColumns(columns, normalizedLayoutOptions),
    [columns, normalizedLayoutOptions],
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
        (isLoading ? (
          "正在加载..."
        ) : (
          <Empty description={emptyDescription} />
        )),
    }),
    [emptyDescription, isLoading, locale],
  );

  return (
    <Table<T>
      {...restProps}
      bordered={bordered}
      className={[RESOURCE_TABLE_CLASS_NAME, className].filter(Boolean).join(" ")}
      columns={normalizedColumns}
      loading={nextLoading}
      locale={nextLocale}
      pagination={pagination}
      scroll={nextScroll}
      size={size}
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
  pagination,
  preferencesClient,
  scroll,
  showToolbar,
  size,
  sort,
  tableKey,
  toolbarExtra,
  ...restProps
}: ResourceTableProps<T> & { tableKey: string }) {
  const headlampColumns = columns.filter(
    (column): column is HeadlampResourceTableColumn<T> =>
      Boolean(column && typeof column === "object" && "key" in column && typeof column.key === "string"),
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
    () => normalizeResourceTableColumns(table.columns, normalizedLayoutOptions),
    [normalizedLayoutOptions, table.columns],
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
        (isLoading ? (
          "正在加载..."
        ) : (
          <Empty description={emptyDescription} />
        )),
    }),
    [emptyDescription, isLoading, locale],
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

  return (
    <div className="resource-table-shell">
      {showToolbar ? <ResourceTableToolbar<T> table={table} extra={toolbarExtra} /> : null}
      <Table<T>
        {...restProps}
        bordered={bordered}
        className={[
          RESOURCE_TABLE_CLASS_NAME,
          "resource-table-headlamp",
          table.filterRowVisible ? "resource-table-filter-row-visible" : undefined,
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        columns={normalizedColumns}
        loading={nextLoading}
        locale={nextLocale}
        onChange={handleChange}
        pagination={pagination}
        scroll={nextScroll}
        size={size}
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
