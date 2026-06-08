'use client';
import { Input, Space } from 'antd';
import { useState } from 'react';
import { OpsFilterChip } from "@/components/ops";

interface LabelFilterProps {
  // labels format: ["app=nginx", "env=prod"]
  value: string[];
  onChange: (labels: string[]) => void;
}

export function LabelFilter({ value, onChange }: LabelFilterProps) {
  const [inputValue, setInputValue] = useState('');

  const handleAdd = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
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
          <span
            style={{ fontSize: 11, color: 'var(--surface-muted, var(--color-text-muted, #94a3b8))', cursor: 'pointer' }}
            onClick={handleAdd}
          >
            添加
          </span>
        }
      />
      {value.map((label) => (
        <OpsFilterChip key={label} closable onClose={() => handleRemove(label)} tone="info">
          {label}
        </OpsFilterChip>
      ))}
    </Space>
  );
}
