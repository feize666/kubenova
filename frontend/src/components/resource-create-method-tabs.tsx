"use client";

import { UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Select, Space, Tabs, Typography, Upload, message } from "antd";
import type { UploadProps } from "antd";
import type { ReactNode } from "react";

export type ResourceCreateMode = "form" | "yaml";

export interface ResourceCreateMethodTabsProps {
  mode: ResourceCreateMode;
  onModeChange: (mode: ResourceCreateMode) => void;
  formContent: ReactNode;
  yaml: string;
  onYamlChange: (yaml: string) => void;
  clusterId?: string;
  onClusterIdChange: (clusterId: string) => void;
  namespace?: string;
  onNamespaceChange?: (namespace: string) => void;
  clusterOptions: Array<{ label: string; value: string }>;
  clusterLoading?: boolean;
  clusterUnavailable?: boolean;
  namespaceDisabled?: boolean;
  kindHint?: string;
  disabled?: boolean;
}

export function ResourceCreateMethodTabs({
  mode,
  onModeChange,
  formContent,
  yaml,
  onYamlChange,
  clusterId,
  onClusterIdChange,
  namespace,
  onNamespaceChange,
  clusterOptions,
  clusterLoading,
  clusterUnavailable,
  namespaceDisabled,
  kindHint,
  disabled,
}: ResourceCreateMethodTabsProps) {
  const uploadProps: UploadProps = {
    accept: ".yaml,.yml,text/yaml,text/x-yaml,application/x-yaml",
    maxCount: 1,
    showUploadList: false,
    beforeUpload: async (file) => {
      try {
        const text = await file.text();
        onYamlChange(text);
        message.success(`已读取 ${file.name}`);
      } catch {
        message.error("YAML 文件读取失败");
      }
      return false;
    },
  };

  return (
    <Tabs
      activeKey={mode}
      onChange={(key) => onModeChange(key === "yaml" ? "yaml" : "form")}
      items={[
        {
          key: "form",
          label: "表单",
          children: formContent,
        },
        {
          key: "yaml",
          label: "YAML / 上传",
          children: (
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Alert
                type="info"
                showIcon
                message={kindHint ? `支持创建 ${kindHint} 或 YAML 中声明的其它资源` : "支持 YAML 中声明的资源"}
                description="按 Kubernetes 原生 apiVersion、kind、metadata.name 识别资源；表单未覆盖的高级字段请写入 YAML。"
              />
              <Form layout="vertical">
                <Form.Item label="集群" required>
                  <Select
                    value={clusterId}
                    onChange={onClusterIdChange}
                    placeholder={clusterUnavailable ? "集群状态不可用" : "请选择集群"}
                    options={clusterOptions}
                    loading={clusterLoading}
                    disabled={disabled || clusterUnavailable || (!clusterLoading && clusterOptions.length === 0)}
                    notFoundContent={clusterUnavailable ? "集群状态不可用" : undefined}
                    showSearch
                    filterOption={(input, option) =>
                      String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())
                    }
                  />
                </Form.Item>
                {onNamespaceChange ? (
                  <Form.Item label="默认名称空间">
                    <Input
                      value={namespace}
                      onChange={(event) => onNamespaceChange(event.target.value)}
                      placeholder="YAML 未写 namespace 时使用"
                      disabled={disabled || namespaceDisabled}
                    />
                  </Form.Item>
                ) : null}
                <Form.Item
                  label={
                    <Space size={8}>
                      <span>YAML</span>
                      <Upload {...uploadProps} disabled={disabled}>
                        <Button size="small" icon={<UploadOutlined />} disabled={disabled}>
                          上传
                        </Button>
                      </Upload>
                    </Space>
                  }
                  required
                >
                  <Input.TextArea
                    value={yaml}
                    onChange={(event) => onYamlChange(event.target.value)}
                    placeholder="apiVersion: v1&#10;kind: ConfigMap&#10;metadata:&#10;  name: example&#10;  namespace: default"
                    autoSize={{ minRows: 12, maxRows: 22 }}
                    style={{ fontFamily: "\"JetBrains Mono\", \"IBM Plex Mono\", SFMono-Regular, monospace", fontSize: 12 }}
                    disabled={disabled}
                  />
                </Form.Item>
              </Form>
              <Typography.Text type="secondary">
                上传仅读取本地文件内容，不会自动提交；点击创建后才应用。
              </Typography.Text>
            </Space>
          ),
        },
      ]}
    />
  );
}
