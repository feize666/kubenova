"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Input, Select } from "antd";
import type { ColumnType, ColumnsType } from "antd/es/table";
import type { SortOrder as AntdSortOrder } from "antd/es/table/interface";
import { OpsFilterChip } from "@/components/ops";
import type {
  TableColumnVisibilityPreference,
  TablePreferences,
  TablePreferencesClient,
} from "@/lib/api/table-preferences";

export type HeadlampTableFilterKind = "text" | "select" | "multiSelect" | "status" | "custom";

export type HeadlampTableFilterOption = {
  label: ReactNode;
  value: string;
};

export type HeadlampTableFilterRenderContext<T extends object> = {
  column: HeadlampResourceTableColumn<T>;
  value: unknown;
  setValue: (value: unknown) => void;
  clearValue: () => void;
};

export type HeadlampTableFilterConfig<T extends object> = {
  type?: HeadlampTableFilterKind;
  placeholder?: string;
  options?: HeadlampTableFilterOption[];
  renderer?: (context: HeadlampTableFilterRenderContext<T>) => ReactNode;
};

export type HeadlampResourceTableColumn<T extends object> = ColumnType<T> & {
  key: string;
  title: ReactNode;
  required?: boolean;
  filter?: HeadlampTableFilterConfig<T>;
};

export type HeadlampTableColumnSetting = {
  key: string;
  visible?: boolean;
  required?: boolean;
};

export type HeadlampTableColumnDescriptor = {
  key: string;
  title: ReactNode;
  required: boolean;
  visible: boolean;
  hideable: boolean;
};

export type HeadlampTableFilters = Record<string, unknown>;

export type HeadlampGlobalSearchState = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export type HeadlampTableSortState = {
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  onChange?: (sortBy: string | undefined, sortOrder: "asc" | "desc" | undefined) => void;
};

export type HeadlampTableStateOptions<T extends object> = {
  tableKey: string;
  columns: Array<HeadlampResourceTableColumn<T>>;
  columnSettings?: HeadlampTableColumnSetting[];
  filters?: HeadlampTableFilters;
  onFiltersChange?: (filters: HeadlampTableFilters) => void;
  globalSearch?: HeadlampGlobalSearchState;
  sort?: HeadlampTableSortState;
  initialFilterRowVisible?: boolean;
  preferencesClient?: TablePreferencesClient;
};

export type HeadlampTableState<T extends object> = {
  tableKey: string;
  columns: ColumnsType<T>;
  columnDescriptors: HeadlampTableColumnDescriptor[];
  visibleColumnKeys: string[];
  filterRowVisible: boolean;
  setFilterRowVisible: (visible: boolean) => void;
  toggleFilterRowVisible: () => void;
  globalSearch?: HeadlampGlobalSearchState;
  filters: HeadlampTableFilters;
  setFilterValue: (key: string, value: unknown) => void;
  clearFilters: () => void;
  hasActiveFilters: boolean;
  activeFilterCount: number;
  setColumnVisible: (key: string, visible: boolean) => void;
  resetColumnVisibility: () => void;
};

const TABLE_PREFERENCES_STORAGE_PREFIX = "resource-table-preferences:";
const EMPTY_FILTERS: HeadlampTableFilters = {};

function readStoragePreferences(tableKey: string): TablePreferences | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(`${TABLE_PREFERENCES_STORAGE_PREFIX}${tableKey}`);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as TablePreferences;
  } catch {
    return null;
  }
}

function writeStoragePreferences(tableKey: string, preferences: TablePreferences) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(`${TABLE_PREFERENCES_STORAGE_PREFIX}${tableKey}`, JSON.stringify(preferences));
}

function isActiveFilterValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== undefined && value !== null && value !== "";
}

function areColumnVisibilityEqual(
  left: TableColumnVisibilityPreference | undefined,
  right: TableColumnVisibilityPreference | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  const leftKeys = Object.keys(left ?? {});
  const rightKeys = Object.keys(right ?? {});
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => left?.[key] === right?.[key]);
}

function areTablePreferencesEqual(left: TablePreferences, right: TablePreferences): boolean {
  return (
    Boolean(left.filterRowVisible) === Boolean(right.filterRowVisible) &&
    areColumnVisibilityEqual(left.columnVisibility, right.columnVisibility)
  );
}

function normalizeColumnSettings<T extends object>(
  columns: Array<HeadlampResourceTableColumn<T>>,
  columnSettings: HeadlampTableColumnSetting[] | undefined,
  storedVisibility?: TableColumnVisibilityPreference,
  columnSettingMap?: ReadonlyMap<string, HeadlampTableColumnSetting>,
): TableColumnVisibilityPreference {
  const settingMap = columnSettingMap ?? new Map((columnSettings ?? []).map((setting) => [setting.key, setting]));

  return columns.reduce<TableColumnVisibilityPreference>((acc, column) => {
    const setting = settingMap.get(column.key);
    const required = column.required ?? setting?.required ?? false;
    if (required) {
      acc[column.key] = true;
      return acc;
    }
    acc[column.key] = storedVisibility?.[column.key] ?? setting?.visible ?? true;
    return acc;
  }, {});
}

function toAntdSortOrder(sortOrder?: "asc" | "desc"): AntdSortOrder | undefined {
  if (sortOrder === "asc") {
    return "ascend";
  }
  if (sortOrder === "desc") {
    return "descend";
  }
  return undefined;
}

function buildDefaultFilterControl<T extends object>(
  column: HeadlampResourceTableColumn<T>,
  value: unknown,
  setValue: (value: unknown) => void,
): ReactNode {
  const filter = column.filter;
  if (!filter) {
    return null;
  }

  if (filter.renderer) {
    return filter.renderer({
      column,
      value,
      setValue,
      clearValue: () => setValue(undefined),
    });
  }

  const placeholder =
    filter.placeholder ??
    (typeof column.title === "string" ? `筛选${column.title}` : "筛选");
  const options = filter.options ?? [];

  if (filter.type === "select" || filter.type === "status") {
    return (
      <Select
        allowClear
        className="resource-table-filter-control"
        options={options}
        placeholder={placeholder}
        popupMatchSelectWidth={false}
        size="small"
        value={typeof value === "string" ? value : undefined}
        onChange={(nextValue) => setValue(nextValue)}
      />
    );
  }

  if (filter.type === "multiSelect") {
    return (
      <Select
        allowClear
        className="resource-table-filter-control"
        mode="multiple"
        options={options}
        placeholder={placeholder}
        popupMatchSelectWidth={false}
        size="small"
        value={Array.isArray(value) ? value : []}
        onChange={(nextValue) => setValue(nextValue)}
      />
    );
  }

  return (
    <Input
      allowClear
      className="resource-table-filter-control"
      placeholder={placeholder}
      size="small"
      value={typeof value === "string" ? value : ""}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

function renderFilterTitle<T extends object>(
  column: HeadlampResourceTableColumn<T>,
  value: unknown,
  setValue: (value: unknown) => void,
) {
  if (!column.filter) {
    return <span className="resource-table-filter-placeholder" />;
  }
  return buildDefaultFilterControl(column, value, setValue);
}

function renderColumnTitle<T extends object>(column: HeadlampResourceTableColumn<T>) {
  if (column.filter?.type !== "status") {
    return column.title;
  }

  return (
    <span className="resource-table-status-title">
      <OpsFilterChip tone="info" bordered={false}>
        {column.title}
      </OpsFilterChip>
    </span>
  );
}

function renderStackedColumnTitle<T extends object>(
  column: HeadlampResourceTableColumn<T>,
  filterRowVisible: boolean,
  filterValue: unknown,
  setValue: (value: unknown) => void,
) {
  if (!filterRowVisible) {
    return renderColumnTitle(column);
  }

  return (
    <div className="resource-table-stacked-header">
      <div className="resource-table-stacked-header-title">{renderColumnTitle(column)}</div>
      <div
        className="resource-table-stacked-header-filter"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {renderFilterTitle(column, filterValue, setValue)}
      </div>
    </div>
  );
}

export function useHeadlampTableState<T extends object>({
  tableKey,
  columns,
  columnSettings,
  filters,
  globalSearch,
  initialFilterRowVisible = false,
  onFiltersChange,
  preferencesClient,
  sort,
}: HeadlampTableStateOptions<T>): HeadlampTableState<T> {
  const columnSettingMap = useMemo(
    () => new Map((columnSettings ?? []).map((setting) => [setting.key, setting])),
    [columnSettings],
  );
  const columnByKey = useMemo(
    () => new Map(columns.map((column) => [column.key, column])),
    [columns],
  );
  const [preferences, setPreferences] = useState<TablePreferences>(() => {
    const stored = readStoragePreferences(tableKey);
    return {
      columnVisibility: normalizeColumnSettings(
        columns,
        columnSettings,
        stored?.columnVisibility,
      ),
      filterRowVisible: initialFilterRowVisible,
    };
  });
  const preferencesDirtyRef = useRef(false);

  useEffect(() => {
    let canceled = false;

    async function loadRemotePreferences() {
      const remotePreferences = await preferencesClient?.loadTablePreferences?.(tableKey);
      if (canceled || !remotePreferences) {
        return;
      }
      setPreferences((prev) => {
        const nextPreferences = {
          columnVisibility: normalizeColumnSettings(
            columns,
            undefined,
            remotePreferences.columnVisibility ?? prev.columnVisibility,
            columnSettingMap,
          ),
          filterRowVisible: prev.filterRowVisible,
        };
        return areTablePreferencesEqual(prev, nextPreferences) ? prev : nextPreferences;
      });
    }

    void loadRemotePreferences();

    return () => {
      canceled = true;
    };
  }, [columnSettingMap, columns, preferencesClient, tableKey]);

  useEffect(() => {
    if (!preferencesDirtyRef.current) {
      return;
    }
    preferencesDirtyRef.current = false;
    writeStoragePreferences(tableKey, preferences);
    void preferencesClient?.saveTablePreferences?.(tableKey, preferences);
  }, [preferences, preferencesClient, tableKey]);

  const effectiveColumnVisibility = useMemo(
    () => normalizeColumnSettings(columns, undefined, preferences.columnVisibility, columnSettingMap),
    [columnSettingMap, columns, preferences.columnVisibility],
  );

  const setColumnVisible = useCallback(
    (key: string, visible: boolean) => {
      const column = columnByKey.get(key);
      const setting = columnSettingMap.get(key);
      if (column?.required || setting?.required || effectiveColumnVisibility[key] === visible) {
        return;
      }

      setPreferences((prev) => {
        const nextVisibility = {
          ...(prev.columnVisibility ?? {}),
          [key]: visible,
        };
        if (areColumnVisibilityEqual(prev.columnVisibility, nextVisibility)) {
          return prev;
        }
        preferencesDirtyRef.current = true;
        return {
          ...prev,
          columnVisibility: nextVisibility,
        };
      });
    },
    [columnByKey, columnSettingMap, effectiveColumnVisibility],
  );

  const setFilterRowVisible = useCallback((visible: boolean) => {
    setPreferences((prev) => {
      if (Boolean(prev.filterRowVisible) === visible) {
        return prev;
      }
      preferencesDirtyRef.current = true;
      return { ...prev, filterRowVisible: visible };
    });
  }, []);

  const setFilterValue = useCallback(
    (key: string, value: unknown) => {
      const nextFilters = { ...(filters ?? {}) };
      if (isActiveFilterValue(value)) {
        nextFilters[key] = value;
      } else {
        delete nextFilters[key];
      }
      onFiltersChange?.(nextFilters);
    },
    [filters, onFiltersChange],
  );

  const clearFilters = useCallback(() => {
    onFiltersChange?.({});
    globalSearch?.onChange("");
  }, [globalSearch, onFiltersChange]);

  const resetColumnVisibility = useCallback(() => {
    const nextColumnVisibility = normalizeColumnSettings(columns, undefined, undefined, columnSettingMap);
    setPreferences((prev) => {
      if (areColumnVisibilityEqual(prev.columnVisibility, nextColumnVisibility)) {
        return prev;
      }
      preferencesDirtyRef.current = true;
      return {
        ...prev,
        columnVisibility: nextColumnVisibility,
      };
    });
  }, [columnSettingMap, columns]);

  const columnDescriptors = useMemo<HeadlampTableColumnDescriptor[]>(() => {
    return columns.map((column) => {
      const setting = columnSettingMap.get(column.key);
      const required = column.required ?? setting?.required ?? false;
      return {
        key: column.key,
        title: column.title,
        required,
        hideable: !required,
        visible: required || effectiveColumnVisibility[column.key] !== false,
      };
    });
  }, [columnSettingMap, columns, effectiveColumnVisibility]);

  const visibleColumnKeys = useMemo(
    () => columnDescriptors.filter((column) => column.visible).map((column) => column.key),
    [columnDescriptors],
  );
  const visibleColumnKeySet = useMemo(
    () => new Set(visibleColumnKeys),
    [visibleColumnKeys],
  );

  const tableColumns = useMemo<ColumnsType<T>>(() => {
    return columns
      .filter((column) => visibleColumnKeySet.has(column.key))
      .map((column) => ({
        ...column,
        title: renderStackedColumnTitle(
          column,
          Boolean(preferences.filterRowVisible),
          filters?.[column.key],
          (value) => setFilterValue(column.key, value),
        ),
        className: [
          preferences.filterRowVisible ? "resource-table-has-filter-header" : undefined,
          column.className,
        ]
          .filter(Boolean)
          .join(" "),
        sortOrder: sort?.sortBy === column.key ? toAntdSortOrder(sort.sortOrder) : column.sortOrder,
        sorter: column.sorter ?? (sort?.onChange ? true : undefined),
      }));
  }, [columns, filters, preferences.filterRowVisible, setFilterValue, sort, visibleColumnKeySet]);

  const resolvedFilters = filters ?? EMPTY_FILTERS;
  const activeFilterCount = useMemo(
    () => Object.values(resolvedFilters).filter(isActiveFilterValue).length + (globalSearch?.value ? 1 : 0),
    [globalSearch?.value, resolvedFilters],
  );

  return {
    tableKey,
    columns: tableColumns,
    columnDescriptors,
    visibleColumnKeys,
    filterRowVisible: preferences.filterRowVisible ?? initialFilterRowVisible,
    setFilterRowVisible,
    toggleFilterRowVisible: () => setFilterRowVisible(!(preferences.filterRowVisible ?? initialFilterRowVisible)),
    globalSearch,
    filters: resolvedFilters,
    setFilterValue,
    clearFilters,
    hasActiveFilters: activeFilterCount > 0,
    activeFilterCount,
    setColumnVisible,
    resetColumnVisibility,
  };
}
