"use client";

import { Empty, Table } from "antd";
import type { TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  getStandardResourceTableScrollX,
  normalizeResourceTableColumns,
  type StandardTableLayoutOptions,
} from "@/lib/table-column-widths";
import { buildResourceTableLoading, type ResourceTableLoadingOptions } from "@/lib/table/pagination";

export const RESOURCE_TABLE_CLASS_NAME = "resource-table";

export type ResourceTableProps<T extends object> = Omit<
  TableProps<T>,
  "columns" | "loading" | "locale" | "scroll"
> & {
  columns: ColumnsType<T>;
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
  columns,
  emptyDescription = "暂无资源数据",
  layoutOptions,
  loading,
  loadingOptions,
  locale,
  pagination,
  scroll,
  size,
  ...restProps
}: ResourceTableProps<T>) {
  const normalizedColumns = normalizeResourceTableColumns(columns, layoutOptions);
  const nextScroll = scroll ?? { x: getStandardResourceTableScrollX(normalizedColumns) };
  const nextLoading = loading ?? buildResourceTableLoading(loadingOptions);
  const isLoading = typeof nextLoading === "boolean" ? nextLoading : Boolean(nextLoading?.spinning);
  const nextLocale = {
    ...locale,
    emptyText:
      locale?.emptyText ??
      (isLoading ? (
        "正在加载..."
      ) : (
        <Empty description={emptyDescription} />
      )),
  };

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
