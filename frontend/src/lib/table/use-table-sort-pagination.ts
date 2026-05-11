"use client";

import { useMemo, useState } from "react";
import type { PaginationProps, TableProps } from "antd";
import type { ColumnFiltersState, PaginationState, VisibilityState } from "@tanstack/react-table";
import { buildTablePagination } from "./pagination";
import {
  type PersistentTableSortStateOptions,
  usePersistentTableSortState,
} from "./use-persistent-table-sort-state";

export interface TableSortPaginationOptions extends PersistentTableSortStateOptions {
  defaultPageSize?: number;
  defaultKeyword?: string;
  initialVisibility?: VisibilityState;
  pageSizeOptions?: readonly string[];
}

type TableChangeHandler<T> = NonNullable<TableProps<T>["onChange"]>;

export function useTableSortPaginationState(options: TableSortPaginationOptions = {}) {
  const sortState = usePersistentTableSortState<object>(options);
  const [keyword, setKeyword] = useState(options.defaultKeyword ?? "");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(options.initialVisibility ?? {});
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: options.defaultPageSize ?? 20,
  });

  const tableState = useMemo(
    () => ({
      sorting: sortState.sortBy
        ? [
            {
              id: sortState.sortBy,
              desc: sortState.sortOrder === "desc",
            },
          ]
        : [],
      columnFilters,
      columnVisibility,
      pagination,
      globalFilter: keyword,
    }),
    [columnFilters, columnVisibility, keyword, pagination, sortState.sortBy, sortState.sortOrder],
  );

  function resetPage() {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }

  function setKeywordAndReset(value: string) {
    setKeyword(value);
    resetPage();
  }

  function handleTableChange(
    _pagination: Parameters<TableChangeHandler<object>>[0],
    _filters: Parameters<TableChangeHandler<object>>[1],
    sorter: Parameters<TableChangeHandler<object>>[2],
    extra: Parameters<TableChangeHandler<object>>[3],
  ) {
    sortState.handleTableChange(_pagination, _filters, sorter, extra);
  }

  function getPaginationConfig(
    total: number,
    overrides: Partial<PaginationProps> = {},
  ): PaginationProps {
    const { pageSizeOptions: overridePageSizeOptions, ...restOverrides } = overrides;
    const pageSizeOptions =
      (overridePageSizeOptions as readonly string[] | readonly number[] | undefined) ??
      options.pageSizeOptions;
    return buildTablePagination({
      current: pagination.pageIndex + 1,
      pageSize: pagination.pageSize,
      total,
      pageSizeOptions,
      onChange: (nextPage, nextPageSize) => {
        if (typeof nextPageSize === "number" && nextPageSize !== pagination.pageSize) {
          setPagination({ pageIndex: 0, pageSize: nextPageSize });
          return;
        }
        setPagination((prev) => ({ ...prev, pageIndex: Math.max(0, nextPage - 1) }));
      },
      ...restOverrides,
    });
  }

  return {
    keyword,
    setKeyword: setKeywordAndReset,
    sortBy: sortState.sortBy,
    sortOrder: sortState.sortOrder,
    setSortState: sortState.setSortState,
    getColumnSortOrder: sortState.getColumnSortOrder,
    getSortableColumnProps: sortState.getSortableColumnProps,
    handleTableChange,
    columnFilters,
    setColumnFilters,
    columnVisibility,
    setColumnVisibility,
    pagination,
    setPagination,
    tableState,
    resetPage,
    getPaginationConfig,
  };
}
