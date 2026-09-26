"use client";

import { Tooltip } from "antd";
import type { ReactNode } from "react";
import type { TopologyGraphSource } from "@/lib/api/topology-graph";

export interface SourceChip {
  id: TopologyGraphSource;
  label: string;
  icon: ReactNode;
  count: number;
  warningCount: number;
  color: string;
  darkColor: string;
}

export interface TopologySourceChipsProps {
  items: SourceChip[];
  selected: ReadonlySet<TopologyGraphSource> | TopologyGraphSource[];
  onToggle: (id: TopologyGraphSource) => void;
}

export function TopologySourceChips({ items, selected, onToggle }: TopologySourceChipsProps) {
  return (
    <div className="topology-source-chips" role="group" aria-label="数据源筛选">
      {items.map((item) => {
        const isActive = "has" in selected ? (selected as ReadonlySet<TopologyGraphSource>).has(item.id) : (selected as TopologyGraphSource[]).includes(item.id);
        return (
          <Tooltip
            key={item.id}
            title={`${item.label}：${item.count} 资源${item.warningCount > 0 ? `，${item.warningCount} 异常` : ""}`}
          >
            <button
              type="button"
              className={`topology-source-chip ${isActive ? "is-active" : ""}`}
              style={{ "--source-color": item.color, "--source-color-dark": item.darkColor } as React.CSSProperties}
              aria-pressed={isActive}
              onClick={() => onToggle(item.id)}
            >
              <span className="topology-source-chip__icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="topology-source-chip__copy">
                <span>{item.label}</span>
              </span>
              <span className="topology-source-chip__metrics">
                <strong className="topology-source-chip__count">{item.count}</strong>
                {item.warningCount > 0 && (
                  <small>{item.warningCount} 异常</small>
                )}
              </span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
