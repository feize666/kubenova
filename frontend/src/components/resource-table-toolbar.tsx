"use client";

import { Checkbox, Input, Popover, Segmented, Space, Tooltip } from "antd";
import {
  ClearOutlined,
  ColumnWidthOutlined,
  FilterOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { CheckboxChangeEvent } from "antd/es/checkbox";
import type { ReactNode } from "react";
import type { HeadlampTableState } from "@/lib/table/headlamp-table";
import { OpsIconActionButton, OpsPopoverPanel } from "@/components/ops";
import type { TableDensity } from "@/lib/table/density";

export type ResourceTableToolbarProps<T extends object> = {
  table: Pick<
    HeadlampTableState<T>,
    | "columnDescriptors"
    | "filterRowVisible"
    | "globalSearch"
    | "hasActiveFilters"
    | "setColumnVisible"
    | "setFilterRowVisible"
    | "clearFilters"
    | "activeFilterCount"
    | "resetColumnVisibility"
  >;
  resetColumnWidths?: () => void;
  extra?: ReactNode;
  primary?: ReactNode;
  density?: TableDensity;
  onDensityChange?: (density: TableDensity) => void;
};

export function ResourceTableToolbar<T extends object>({ table, resetColumnWidths, extra, primary, density, onDensityChange }: ResourceTableToolbarProps<T>) {
  const activeFilterCount = table.activeFilterCount + (table.globalSearch?.value ? 1 : 0);
  const searchPanel = table.globalSearch ? (
      <Input
        allowClear
        aria-label="搜索资源"
        className="resource-table-global-search"
        prefix={<SearchOutlined />}
        placeholder={table.globalSearch.placeholder ?? "搜索"}
        value={table.globalSearch.value}
        onChange={(event) => table.globalSearch?.onChange(event.target.value)}
      />
  ) : null;

  const columnPanel = (
    <OpsPopoverPanel
      title="显示列"
      onReset={() => {
        table.resetColumnVisibility();
        resetColumnWidths?.();
      }}
      resetText="重置"
      className="resource-table-column-panel"
    >
      <div className="resource-table-column-panel-header">
      </div>
      <div className="resource-table-column-list">
        {table.columnDescriptors.map((column) => (
          <Checkbox
            checked={column.visible}
            disabled={!column.hideable}
            key={column.key}
            onChange={(event: CheckboxChangeEvent) => table.setColumnVisible(column.key, event.target.checked)}
          >
            {column.title}
          </Checkbox>
        ))}
      </div>
    </OpsPopoverPanel>
  );

  return (
    <div
      className={[
        "resource-table-toolbar",
        activeFilterCount > 0 ? "resource-table-toolbar--has-active-filters" : undefined,
      ].filter(Boolean).join(" ")}
      data-active-filter-count={activeFilterCount}
      data-resource-table-toolbar=""
    >
      <div className="resource-table-toolbar-left">{primary}{extra}{searchPanel}</div>
      <Space className="resource-table-toolbar-actions" size={8} wrap>
        {onDensityChange ? (
          <Segmented<TableDensity>
            aria-label="表格密度"
            options={[{ label: "标准", value: "standard" }, { label: "紧凑", value: "compact" }]}
            value={density ?? "standard"}
            onChange={onDensityChange}
          />
        ) : null}
        <Tooltip title="过滤">
          <OpsIconActionButton
            className={["resource-table-icon-action", table.hasActiveFilters ? "is-active" : ""]
              .filter(Boolean)
              .join(" ")}
            icon={<FilterOutlined />}
            aria-label="过滤"
            onClick={() => table.setFilterRowVisible(!table.filterRowVisible)}
          >
            筛选
            {table.activeFilterCount > 0 ? (
              <span className="resource-table-action-badge">{table.activeFilterCount}</span>
            ) : null}
          </OpsIconActionButton>
        </Tooltip>
        <Tooltip title="清空搜索和过滤">
          <OpsIconActionButton
            className="resource-table-icon-action resource-table-icon-action-compact"
            disabled={!table.hasActiveFilters}
            icon={<ClearOutlined />}
            aria-label="清空搜索和过滤"
            onClick={table.clearFilters}
          />
        </Tooltip>
        <Popover
          content={columnPanel}
          overlayClassName="resource-table-column-popover"
          placement="bottomRight"
          trigger="click"
        >
          <Tooltip title="列设置">
            <OpsIconActionButton className="resource-table-icon-action" icon={<ColumnWidthOutlined />} aria-label="列设置">
              列
            </OpsIconActionButton>
          </Tooltip>
        </Popover>
      </Space>
    </div>
  );
}
