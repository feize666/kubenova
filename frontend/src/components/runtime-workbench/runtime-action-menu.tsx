"use client";

import { MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown, type MenuProps } from "antd";

export function RuntimeActionMenu({ items }: { items: MenuProps["items"] }) {
  return (
    <Dropdown menu={{ items }} trigger={["click"]} placement="bottomRight">
      <Button type="text" aria-label="更多操作" icon={<MoreOutlined />} />
    </Dropdown>
  );
}
