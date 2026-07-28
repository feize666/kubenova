import type { PaginationProps, TablePaginationConfig, TableProps } from "antd";

export const DEFAULT_PAGE_SIZE_OPTIONS = ["10", "20", "50", "100"] as const;
export const DEFAULT_RESOURCE_TABLE_LOADING_TEXT = "资源数据加载中...";

export type PageSizeOption = number | string;
export type PageSizeOptions = readonly PageSizeOption[];

export type BuildPaginationParams = {
  current: number;
  pageSize: number;
  total: number;
  onChange: NonNullable<TablePaginationConfig["onChange"]>;
  showTotal?: TablePaginationConfig["showTotal"];
  pageSizeOptions?: PageSizeOptions;
  showSizeChanger?: PaginationProps["showSizeChanger"];
  disabled?: boolean;
};

export type ResourceTableLoadingOptions = {
  spinning?: boolean;
  description?: string;
};

function getPageSizeOptions(pageSizeOptions?: PageSizeOptions) {
  return pageSizeOptions
    ? pageSizeOptions.map((value) => String(value))
    : [...DEFAULT_PAGE_SIZE_OPTIONS];
}

function buildPageSizeChanger(
  showSizeChanger: PaginationProps["showSizeChanger"],
  pageSizeOptions: readonly string[],
): PaginationProps["showSizeChanger"] {
  if (showSizeChanger === false) {
    return false;
  }

  return {
    ...(typeof showSizeChanger === "object" ? showSizeChanger : {}),
    allowClear: false,
    showSearch: false,
    options: pageSizeOptions.map((value) => ({
      value,
      label: `${value} 条/页`,
    })),
  };
}

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
  const normalizedPageSizeOptions = getPageSizeOptions(pageSizeOptions);

  return {
    current,
    pageSize,
    total,
    showSizeChanger: buildPageSizeChanger(showSizeChanger, normalizedPageSizeOptions),
    disabled,
    pageSizeOptions: normalizedPageSizeOptions,
    placement: ["bottomEnd"],
    showTotal: showTotal ?? ((count) => `共 ${count} 条`),
    hideOnSinglePage: false,
    showQuickJumper: false,
    onChange,
  };
}

export function buildResourceTablePagination(
  params: BuildPaginationParams,
): TablePaginationConfig {
  return buildTablePagination({
    ...params,
    showTotal: params.showTotal ?? ((count, range) => `${range[0]}-${range[1]} / 共 ${count} 条`),
  });
}

export function buildCompactTablePagination({
  current,
  pageSize,
  total,
  onChange,
  showTotal,
  pageSizeOptions,
  disabled,
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
      disabled,
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

export function buildResourceTableLoading<T = unknown>({
  spinning = false,
  description = DEFAULT_RESOURCE_TABLE_LOADING_TEXT,
}: ResourceTableLoadingOptions = {}): TableProps<T>["loading"] {
  return {
    spinning,
    description,
  };
}
