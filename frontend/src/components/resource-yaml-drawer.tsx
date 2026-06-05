"use client";

import { DownloadOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { Alert, Input, Space, Typography } from "antd";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  getDynamicResourceDetail,
  getResourceYaml,
  updateDynamicResourceYaml,
  updateResourceYaml,
  type DynamicResourceIdentity,
  type ResourceIdentity,
} from "@/lib/api/resources";

import { getClusters } from "@/lib/api/clusters";

import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { OpsDrawerShell, OpsIconActionButton } from "@/components/ops";

interface ResourceYamlDrawerProps {
  open: boolean;
  onClose: () => void;
  token?: string;
  identity: ResourceIdentity | null;
  dynamicIdentity?: DynamicResourceIdentity | null;
  onUpdated?: () => void;
}

function sanitizeFilenameSegment(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[\\/:*?"<>|\s]+/g, "-");
  return normalized || fallback;
}

function buildYamlFilename(identity: ResourceIdentity): string {
  const namespace = identity.namespace ? sanitizeFilenameSegment(identity.namespace, "default") : "cluster";
  const kind = sanitizeFilenameSegment(identity.kind, "resource");
  const name = sanitizeFilenameSegment(identity.name, "item");
  return `${namespace}-${kind}-${name}.yaml`;
}

function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "application/x-yaml;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export function ResourceYamlDrawer({
  open,
  onClose,
  token,
  identity,
  dynamicIdentity,
  onUpdated,
}: ResourceYamlDrawerProps) {
  const [yamlText, setYamlText] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const isDynamic = Boolean(dynamicIdentity);

  const query = useQuery({
    queryKey: [
      "resource-yaml",
      isDynamic ? "dynamic" : "core",
      dynamicIdentity?.clusterId ?? identity?.clusterId,
      dynamicIdentity?.group,
      dynamicIdentity?.version,
      dynamicIdentity?.resource ?? identity?.kind,
      dynamicIdentity?.namespace ?? identity?.namespace,
      dynamicIdentity?.name ?? identity?.name,
      token,
    ],
    queryFn: async ({ signal }) => {
      if (dynamicIdentity) {
        const detail = await getDynamicResourceDetail(dynamicIdentity, token, { signal });
        return {
          clusterId: detail.clusterId,
          namespace: detail.namespace,
          kind: detail.kind || dynamicIdentity.resource,
          name: detail.name,
          yaml: detail.yaml,
          updatedAt: detail.timestamp,
        };
      }
      return getResourceYaml(identity!, token, { signal });
    },
    enabled:
      open &&
      (dynamicIdentity
        ? Boolean(dynamicIdentity.clusterId && dynamicIdentity.version && dynamicIdentity.resource && dynamicIdentity.name)
        : Boolean(identity?.clusterId && identity?.namespace && identity?.kind && identity?.name)),
  });
  const clusterQuery = useQuery({
    queryKey: ["resource-yaml", "clusters", token],
    queryFn: ({ signal }) => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, token!, { signal }),
    enabled: open && Boolean(token),
  });
  const clusterMap = useMemo(
    () => Object.fromEntries((clusterQuery.data?.items ?? []).map((item) => [item.id, item.name])),
    [clusterQuery.data?.items],
  );

  useEffect(() => {
    const nextYaml = query.data?.yaml;
    if (nextYaml === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      setYamlText(nextYaml);
      setLocalError(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [query.data]);

  useEffect(() => {
    if (open) {
      return;
    }
    const timer = setTimeout(() => {
      setLocalError(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!identity && !dynamicIdentity) {
        throw new Error("资源标识缺失，无法提交 YAML");
      }
      const normalized = yamlText.trim();
      if (!normalized) {
        throw new Error("YAML 内容不能为空");
      }
      if (dynamicIdentity) {
        return updateDynamicResourceYaml({ ...dynamicIdentity, yaml: normalized }, token);
      }
      if (!identity) {
        throw new Error("资源标识缺失，无法提交 YAML");
      }
      return updateResourceYaml({ ...identity, yaml: normalized }, token);
    },
    onSuccess: () => {
      onUpdated?.();
      onClose();
    },
  });

  const title = useMemo(() => {
    if (!identity) {
      return "YAML";
    }
    return `YAML · ${identity.kind}/${identity.name}`;
  }, [identity]);

  const errorMessage =
    localError ??
    (query.error instanceof Error
      ? query.error.message
      : mutation.error instanceof Error
      ? mutation.error.message
      : null);
  const downloadDisabled = query.isLoading || !identity || !yamlText.trim();

  return (
    <OpsDrawerShell
      title={title}
      size="large"
      open={open}
      destroyOnHidden
      variant="editor"
      styles={{
        body: { padding: 24 },
      }}
      onClose={() => {
        mutation.reset();
        setLocalError(null);
        onClose();
      }}
      extra={
        <Space>
          <OpsIconActionButton
            icon={<DownloadOutlined />}
            disabled={downloadDisabled}
            onClick={() => {
              if (!identity || !yamlText.trim()) {
                return;
              }
              downloadTextFile(yamlText, buildYamlFilename(identity));
            }}
          >
            下载 YAML
          </OpsIconActionButton>
          <OpsIconActionButton onClick={() => void query.refetch()} loading={query.isFetching}>
            重新加载
          </OpsIconActionButton>
          <OpsIconActionButton opsTone="primary" loading={mutation.isPending} onClick={() => void mutation.mutateAsync()}>
            保存 YAML
          </OpsIconActionButton>
        </Space>
      }
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        {identity ? (
          <Typography.Text type="secondary">
            集群 {getClusterDisplayName(clusterMap, identity.clusterId)} · 名称空间 {identity.namespace} · 资源 {identity.kind}/{identity.name}
          </Typography.Text>
        ) : null}
        {errorMessage ? <Alert type="error" showIcon title={errorMessage} /> : null}
        <Input.TextArea
          value={yamlText}
          onChange={(e) => setYamlText(e.target.value)}
          autoSize={{ minRows: 20, maxRows: 30 }}
          placeholder="YAML 内容"
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          spellCheck={false}
          disabled={query.isLoading}
        />
      </Space>
    </OpsDrawerShell>
  );
}
