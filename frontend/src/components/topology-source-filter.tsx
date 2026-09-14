"use client";

import { FilterOutlined } from "@ant-design/icons";
import { Button, Checkbox, Popover, Space } from "antd";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";

export type TopologySourceFilterItem = {
  id: string;
  label: string;
  icon: ReactNode;
  count: number;
  warningCount?: number;
  color?: string;
  darkColor?: string;
};

type TopologySourceFilterProps<T extends string> = {
  items: Array<TopologySourceFilterItem & { id: T }>;
  selected: ReadonlySet<T>;
  onToggle: (id: T) => void;
};

function sourceSummary(items: TopologySourceFilterItem[], selected: ReadonlySet<string>) {
  const active = items.filter((item) => selected.has(item.id));
  if (!active.length) return "无资源域";
  if (active.length === items.length) return "全部资源域";
  if (active.length <= 2) return active.map((item) => item.label).join("、");
  return `${active[0].label}、${active[1].label} +${active.length - 2}`;
}

export function TopologySourceFilter<T extends string>({
  items,
  selected,
  onToggle,
}: TopologySourceFilterProps<T>) {
  const [open, setOpen] = useState(false);
  const selectedCount = items.filter((item) => selected.has(item.id)).length;
  const summary = sourceSummary(items, selected);
  const content = (
    <div className="topology-source-filter-menu" role="group" aria-label="资源域筛选列表">
      <div className="topology-source-filter-menu__header">
        <strong>资源域</strong>
        <span>{selectedCount}/{items.length}</span>
      </div>
      <div className="topology-source-filter-menu__items">
        {items.map((item) => (
          <label
            key={item.id}
            className="topology-source-filter-menu__item"
            style={{
              "--source-color-light": item.color,
              "--source-color-dark": item.darkColor ?? item.color,
            } as CSSProperties}
          >
            <Checkbox
              checked={selected.has(item.id)}
              onChange={() => onToggle(item.id)}
            />
            <span className="topology-source-filter-menu__icon" aria-hidden="true">{item.icon}</span>
            <span className="topology-source-filter-menu__label">{item.label}</span>
            <span className="topology-source-filter-menu__count">{item.count}</span>
            {item.warningCount ? <span className="topology-source-filter-menu__warning">{item.warningCount}</span> : null}
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomLeft"
      content={content}
      overlayClassName="topology-source-filter-popover"
    >
      <Button
        className="topology-source-filter-trigger"
        icon={<FilterOutlined />}
        aria-label={`资源域筛选：${summary}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Space size={5}>
          <span>资源域</span>
          <span className="topology-source-filter-trigger__summary">{summary}</span>
        </Space>
      </Button>
    </Popover>
  );
}
