'use client';
import { Button, Input, Space } from 'antd';
import { useState } from 'react';
import { OpsFilterChip } from "@/components/ops";

interface LabelFilterProps {
  // labels format: ["app=nginx", "env=prod"]
  value: string[];
  onChange: (labels: string[]) => void;
}

export function LabelFilter({ value, onChange }: LabelFilterProps) {
  const [inputValue, setInputValue] = useState('');
  const trimmedValue = inputValue.trim();
  const canAdd = Boolean(trimmedValue && !value.includes(trimmedValue));

  const handleAdd = () => {
    if (canAdd) {
      onChange([...value, trimmedValue]);
      setInputValue('');
    }
  };

  const handleRemove = (label: string) => {
    onChange(value.filter((l) => l !== label));
  };

  return (
    <Space className="label-filter-control" wrap>
      <Input
        className="label-filter-control__input"
        placeholder="app=nginx"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onPressEnter={handleAdd}
        suffix={
          <Button
            aria-label="添加标签筛选"
            className="label-filter-control__add"
            disabled={!canAdd}
            onClick={handleAdd}
            size="small"
            type="text"
          >
            添加
          </Button>
        }
      />
      {value.map((label) => (
        <OpsFilterChip key={label} closable closeLabel={`移除标签筛选 ${label}`} onClose={() => handleRemove(label)} tone="info">
          {label}
        </OpsFilterChip>
      ))}
    </Space>
  );
}
