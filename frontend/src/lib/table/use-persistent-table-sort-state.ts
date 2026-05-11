"use client";

import { useEffect, useMemo, useState } from "react";
import type { TableProps } from "antd/es/table";
import type { SortOrder } from "@/lib/contracts";

export type AntdSortOrder = "ascend" | "descend" | null;

export interface PersistentTableSortStateOptions {
  storageKey?: string;
  defaultSortBy?: string;
  defaultSortOrder?: SortOrder;
  allowedSortBy?: readonly string[];
}

type TableChangeHandler<T> = NonNullable<TableProps<T>["onChange"]>;

const DEFAULT_SORT_DIRECTIONS: AntdSortOrder[] = ["ascend", "descend", null];

function normalizeSortBy(value?: string, allowedSortBy?: readonly string[]): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  if (allowedSortBy?.length && !allowedSortBy.includes(normalized)) {
    return undefined;
  }
  return normalized;
}

function toAntdSortOrder(sortOrder?: SortOrder): AntdSortOrder {
  if (sortOrder === "asc") return "ascend";
  if (sortOrder === "desc") return "descend";
  return null;
}

function fromAntdSortOrder(sortOrder?: AntdSortOrder): SortOrder | undefined {
  if (sortOrder === "ascend") return "asc";
  if (sortOrder === "descend") return "desc";
  return undefined;
}

function readStoredSortState(options: PersistentTableSortStateOptions): {
  sortBy?: string;
  sortOrder?: SortOrder;
} {
  const fallbackSortBy = normalizeSortBy(options.defaultSortBy, options.allowedSortBy);
  const fallbackSortOrder = fallbackSortBy ? options.defaultSortOrder : undefined;

  if (typeof window === "undefined" || !options.storageKey) {
    return { sortBy: fallbackSortBy, sortOrder: fallbackSortOrder };
  }

  try {
    const raw = window.localStorage.getItem(options.storageKey);
    if (!raw) {
      return { sortBy: fallbackSortBy, sortOrder: fallbackSortOrder };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { sortBy: fallbackSortBy, sortOrder: fallbackSortOrder };
    }
    const record = parsed as Record<string, unknown>;
    const sortBy = normalizeSortBy(typeof record.sortBy === "string" ? record.sortBy : undefined, options.allowedSortBy);
    const sortOrder = record.sortOrder === "asc" || record.sortOrder === "desc" ? record.sortOrder : undefined;
    return {
      sortBy: sortBy ?? fallbackSortBy,
      sortOrder: sortOrder ?? (sortBy ? fallbackSortOrder : undefined),
    };
  } catch {
    return { sortBy: fallbackSortBy, sortOrder: fallbackSortOrder };
  }
}

export function usePersistentTableSortState<T extends object>(options: PersistentTableSortStateOptions) {
  const initialSortState = useMemo(() => readStoredSortState(options), [options]);
  const [sortBy, setSortBy] = useState<string | undefined>(initialSortState.sortBy);
  const [sortOrder, setSortOrder] = useState<SortOrder | undefined>(initialSortState.sortOrder);

  useEffect(() => {
    if (typeof window === "undefined" || !options.storageKey) {
      return;
    }
    window.localStorage.setItem(options.storageKey, JSON.stringify({ sortBy, sortOrder }));
  }, [options.storageKey, sortBy, sortOrder]);

  const sortDirections = useMemo(() => DEFAULT_SORT_DIRECTIONS, []);

  function setSortState(nextSortBy?: string, nextSortOrder?: SortOrder) {
    const normalizedSortBy = normalizeSortBy(nextSortBy, options.allowedSortBy);
    setSortBy(normalizedSortBy);
    setSortOrder(normalizedSortBy ? nextSortOrder : undefined);
  }

  function getColumnSortOrder(columnKey: string): AntdSortOrder {
    if (sortBy !== columnKey) {
      return null;
    }
    return toAntdSortOrder(sortOrder);
  }

  function getSortableColumnProps(columnKey: string, busy = false) {
    return {
      sorter: true as const,
      sortDirections,
      sortOrder: getColumnSortOrder(columnKey),
      onHeaderCell: () => ({
        style: {
          cursor: busy ? "not-allowed" : "pointer",
          pointerEvents: busy ? "none" : undefined,
        },
      }),
    };
  }

  function handleTableChange(
    _pagination: Parameters<TableChangeHandler<T>>[0],
    _filters: Parameters<TableChangeHandler<T>>[1],
    sorter: Parameters<TableChangeHandler<T>>[2],
    extra: Parameters<TableChangeHandler<T>>[3],
    busy = false,
  ) {
    if (busy || extra?.action !== "sort" || Array.isArray(sorter)) {
      return;
    }

    const nextSortBy =
      typeof sorter.columnKey === "string"
        ? sorter.columnKey
        : typeof sorter.field === "string"
          ? sorter.field
          : undefined;
    setSortState(nextSortBy, fromAntdSortOrder(sorter.order ?? null));
  }

  return {
    sortBy,
    sortOrder,
    setSortState,
    getColumnSortOrder,
    getSortableColumnProps,
    handleTableChange,
  };
}
