"use client";

import type { TablePaginationConfig } from "antd";
import type { TableProps } from "antd/es/table";
import { buildTablePagination, createPaginationChangeHandler } from "./pagination";
import { useTableSortPaginationState, type TableSortPaginationOptions } from "./use-table-sort-pagination";

export type UseAntdTableSortPaginationOptions = TableSortPaginationOptions;

export function useAntdTableSortPagination<T = unknown>(options: UseAntdTableSortPaginationOptions) {
  type TableChangeHandler = NonNullable<TableProps<T>["onChange"]>;
  const {
    pagination,
    setPagination,
    resetPage,
    getSortableColumnProps,
    setSortState,
    sortBy,
    sortOrder,
  } = useTableSortPaginationState(options);

  function handleTableChange(
    nextPagination: Parameters<TableChangeHandler>[0],
    _filters: Parameters<TableChangeHandler>[1],
    sorter: Parameters<TableChangeHandler>[2],
    extra: Parameters<TableChangeHandler>[3],
    busy = false,
  ) {
    if (extra?.action === "paginate") {
      const nextPage = nextPagination?.current ?? pagination.pageIndex + 1;
      const nextPageSize = nextPagination?.pageSize ?? pagination.pageSize;
      setPagination({
        pageIndex: Math.max(0, nextPage - 1),
        pageSize: nextPageSize,
      });
      return;
    }
    if (extra?.action === "sort") {
      if (!Array.isArray(sorter)) {
        const nextSortBy =
          typeof sorter.columnKey === "string"
            ? sorter.columnKey
            : typeof sorter.field === "string"
              ? sorter.field
            : undefined;
        if (!busy) {
          setSortState(nextSortBy, sorter.order === "descend" ? "desc" : sorter.order === "ascend" ? "asc" : undefined);
        }
      }
      resetPage();
    }
  }

  function getPaginationConfig(total: number, busy = false): TablePaginationConfig {
    return buildTablePagination({
      current: pagination.pageIndex + 1,
      pageSize: pagination.pageSize,
      total,
      disabled: busy,
      onChange: createPaginationChangeHandler(
        pagination.pageSize,
        (nextPage) => setPagination((prev) => ({ ...prev, pageIndex: nextPage - 1 })),
        (nextPageSize) => setPagination({ pageIndex: 0, pageSize: nextPageSize }),
      ),
    });
  }

  return {
    sortBy,
    sortOrder,
    pagination,
    setPagination,
    resetPage,
    getSortableColumnProps,
    setSortState,
    getPaginationConfig,
    handleTableChange,
  };
}
