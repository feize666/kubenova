'use client';
import { Input, Tag, Space } from 'antd';
import { useState } from 'react';

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
    <Space wrap style={{ width: '100%' }}>
      <Input
        style={{ width: 160 }}
        placeholder="app=nginx"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onPressEnter={handleAdd}
        suffix={
          <span
            style={{ fontSize: 11, color: '#94a3b8', cursor: 'pointer' }}
            onClick={handleAdd}
          >
            添加
          </span>
        }
      />
      {value.map((label) => (
        <Tag key={label} closable onClose={() => handleRemove(label)} color="blue">
          {label}
        </Tag>
      ))}
    </Space>
  );
}
