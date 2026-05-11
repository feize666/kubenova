import type { TablePaginationConfig } from "antd";

export const DEFAULT_PAGE_SIZE_OPTIONS = ["10", "20", "50", "100"] as const;

export type BuildPaginationParams = {
  current: number;
  pageSize: number;
  total: number;
  onChange: NonNullable<TablePaginationConfig["onChange"]>;
  showTotal?: TablePaginationConfig["showTotal"];
  pageSizeOptions?: readonly number[] | readonly string[];
  showSizeChanger?: TablePaginationConfig["showSizeChanger"];
  disabled?: boolean;
};

export function buildTablePagination({
  current,
  pageSize,
  total,
  onChange,
  showTotal,
  pageSizeOptions,
  showSizeChanger = true,
  disabled = false,
}: BuildPaginationParams): TablePaginationConfig {
  return {
    current,
    pageSize,
    total,
    showSizeChanger,
    disabled,
    pageSizeOptions: pageSizeOptions
      ? pageSizeOptions.map((value) => String(value))
      : [...DEFAULT_PAGE_SIZE_OPTIONS],
    position: ["bottomRight"],
    showTotal: showTotal ?? ((count) => `共 ${count} 条`),
    onChange,
  };
}

export function buildCompactTablePagination({
  current,
  pageSize,
  total,
  onChange,
  showTotal,
  pageSizeOptions,
}: BuildPaginationParams): TablePaginationConfig {
  return {
    ...buildTablePagination({
      current,
      pageSize,
      total,
      onChange,
      showTotal,
      pageSizeOptions,
      showSizeChanger: false,
    }),
  };
}

export function createPaginationChangeHandler(
  currentPageSize: number,
  onPageChange: (nextPage: number) => void,
  onPageSizeChange: (nextPageSize: number) => void,
) {
  return (nextPage: number, nextPageSize?: number) => {
    if (typeof nextPageSize === "number" && nextPageSize !== currentPageSize) {
      onPageSizeChange(nextPageSize);
      onPageChange(1);
      return;
    }
    onPageChange(nextPage);
  };
}
