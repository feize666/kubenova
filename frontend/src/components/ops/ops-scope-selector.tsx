"use client";

import { ClusterOutlined, GlobalOutlined } from "@ant-design/icons";
import { Select, Space, Typography } from "antd";
import type { SelectProps } from "antd";
import type { ReactNode } from "react";

export type OpsScopeSelectorOption = {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

export type OpsScopeSelectorProps = Omit<SelectProps<string>, "options" | "value" | "onChange"> & {
  value?: string;
  allLabel?: ReactNode;
  allDescription?: ReactNode;
  options: OpsScopeSelectorOption[];
  onChange: (value?: string) => void;
};

export function OpsScopeSelector({
  value,
  allLabel = "全部集群",
  allDescription = "全局态势",
  options,
  onChange,
  className,
  ...props
}: OpsScopeSelectorProps) {
  const selectOptions: SelectProps<string>["options"] = [
    {
      value: "__all__",
      label: (
        <Space size={8} className="ops-scope-selector__option">
          <GlobalOutlined aria-hidden />
          <span>
            <Typography.Text strong>{allLabel}</Typography.Text>
            <Typography.Text type="secondary" className="ops-scope-selector__description">
              {allDescription}
            </Typography.Text>
          </span>
        </Space>
      ),
    },
    ...options.map((item) => ({
      value: item.value,
      disabled: item.disabled,
      label: (
        <Space size={8} className="ops-scope-selector__option">
          <ClusterOutlined aria-hidden />
          <span>
            <Typography.Text strong>{item.label}</Typography.Text>
            {item.description ? (
              <Typography.Text type="secondary" className="ops-scope-selector__description">
                {item.description}
              </Typography.Text>
            ) : null}
          </span>
        </Space>
      ),
    })),
  ];

  return (
    <Select
      {...props}
      className={["ops-scope-selector", className].filter(Boolean).join(" ")}
      value={value || "__all__"}
      options={selectOptions}
      onChange={(next) => onChange(next === "__all__" ? undefined : next)}
    />
  );
}
