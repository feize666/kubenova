"use client";

import { DownOutlined, FilterOutlined } from "@ant-design/icons";
import { Badge, Button, Divider, Popover, Select, Space, Typography } from "antd";
import type { SelectProps } from "antd";
import { useMemo, useState } from "react";

type ResourceFacetFilterButtonProps = {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
  allLabel?: string;
  panelTitle?: string;
  selectPlaceholder?: string;
};

export function ResourceFacetFilterButton({
  label,
  value,
  options,
  onChange,
  allLabel,
  panelTitle,
  selectPlaceholder,
}: ResourceFacetFilterButtonProps) {
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);

  const optionByValue = useMemo(() => {
    const map = new Map<string, string>();
    options.forEach((option) => map.set(option.value, option.label));
    return map;
  }, [options]);

  const summary = value ? optionByValue.get(value) ?? value : allLabel ?? `全部${label}`;
  const activeCount = value ? 1 : 0;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraftValue(value);
    }
    setOpen(nextOpen);
  };

  const applyDraft = () => {
    onChange(draftValue);
    setOpen(false);
  };

  const resetAndApply = () => {
    setDraftValue("");
    onChange("");
    setOpen(false);
  };

  const selectOptions: SelectProps["options"] = options;
  const content = (
    <div className="resource-facet-filter-panel">
      <div className="resource-scope-filter-panel-title">
        <Typography.Text strong>{panelTitle ?? label}</Typography.Text>
        <Typography.Text type="secondary">应用后刷新列表</Typography.Text>
      </div>
      <Typography.Text className="resource-scope-filter-label">{label}</Typography.Text>
      <Select
        className="resource-filter-select"
        value={draftValue}
        options={selectOptions}
        placeholder={selectPlaceholder ?? allLabel ?? `全部${label}`}
        onChange={setDraftValue}
        style={{ width: "100%" }}
      />
      <Divider style={{ margin: "14px 0 12px" }} />
      <Space className="resource-scope-filter-actions">
        <Button onClick={resetAndApply}>重置</Button>
        <Button type="primary" onClick={applyDraft}>
          应用
        </Button>
      </Space>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      trigger="click"
      placement="bottomLeft"
      content={content}
      overlayClassName="resource-scope-filter-popover"
    >
      <Badge count={activeCount} size="small" offset={[-4, 4]}>
        <Button className="resource-scope-filter-button resource-facet-filter-button">
          <span className="resource-scope-filter-icon" aria-hidden>
            <FilterOutlined />
          </span>
          <span className="resource-scope-filter-copy">
            <span className="resource-scope-filter-field-label">{label} /</span>
            <span className="resource-scope-filter-value">
              <span className="resource-scope-filter-summary">{summary}</span>
            </span>
          </span>
          <span className="resource-scope-filter-affordance" aria-hidden>
            <DownOutlined className="resource-scope-filter-caret" aria-hidden />
          </span>
        </Button>
      </Badge>
    </Popover>
  );
}
