import { useMemo, useState } from "react";
import type { ColumnFiltersState, PaginationState, SortingState, VisibilityState } from "@tanstack/react-table";
import type { QueryParams, SortOrder } from "@/lib/contracts";
import { buildResourceListQuery } from "@/lib/api/helpers";

export interface TableStateOptions {
  defaultPageSize?: number;
  defaultKeyword?: string;
  defaultSortBy?: string;
  defaultSortOrder?: SortOrder;
  initialVisibility?: VisibilityState;
}

export interface TableQueryOptions {
  extraFilters?: QueryParams;
}

function toSortOrder(value?: string): SortOrder | undefined {
  if (value === "asc" || value === "desc") {
    return value;
  }
  return undefined;
}

export function useTableState(options: TableStateOptions = {}) {
  const [keyword, setKeyword] = useState(options.defaultKeyword ?? "");
  const [sorting, setSorting] = useState<SortingState>(
    options.defaultSortBy
      ? [
          {
            id: options.defaultSortBy,
            desc: options.defaultSortOrder === "desc",
          },
        ]
      : [],
  );
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(options.initialVisibility ?? {});
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: options.defaultPageSize ?? 20,
  });

  const tableState = useMemo(
    () => ({
      sorting,
      columnFilters,
      columnVisibility,
      pagination,
      globalFilter: keyword,
    }),
    [sorting, columnFilters, columnVisibility, pagination, keyword],
  );

  function resetPage() {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }

  function setKeywordAndReset(value: string) {
    setKeyword(value);
    resetPage();
  }

  function buildListQuery(options: TableQueryOptions = {}): QueryParams {
    const [primarySort] = sorting;

    const filterQuery = columnFilters.reduce<QueryParams>((acc, item) => {
      if (!item.id) {
        return acc;
      }
      const key = String(item.id);
      const value = item.value;

      if (Array.isArray(value)) {
        acc[key] = value.map((entry) => String(entry));
        return acc;
      }

      if (value === undefined || value === null || value === "") {
        return acc;
      }

      acc[key] = String(value);
      return acc;
    }, {});

    return buildResourceListQuery({
      page: pagination.pageIndex + 1,
      pageSize: pagination.pageSize,
      keyword: keyword || undefined,
      sortBy: primarySort?.id,
      sortOrder: primarySort ? (primarySort.desc ? "desc" : "asc") : toSortOrder(options.extraFilters?.sortOrder as string),
      ...filterQuery,
      ...(options.extraFilters ?? {}),
    });
  }

  return {
    keyword,
    setKeyword: setKeywordAndReset,
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
    columnVisibility,
    setColumnVisibility,
    pagination,
    setPagination,
    tableState,
    buildListQuery,
  };
}
