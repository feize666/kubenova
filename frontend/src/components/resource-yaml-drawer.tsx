"use client";

import { CodeOutlined, CopyOutlined, DownloadOutlined, EyeInvisibleOutlined, EyeOutlined, UndoOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { Input, Space, Typography } from "antd";
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
import { OpsDrawerShell, OpsErrorState, OpsFilterChip, OpsIconActionButton, OpsLoadingState } from "@/components/ops";

interface ResourceYamlDrawerProps {
  open: boolean;
  onClose: () => void;
  token?: string;
  identity: ResourceIdentity | null;
  dynamicIdentity?: DynamicResourceIdentity | null;
  onUpdated?: () => void;
  readOnly?: boolean;
  maskSensitive?: boolean;
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

function formatYamlText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trimEnd();
}

function maskSensitiveYaml(value: string): string {
  const lines = value.split("\n");
  let inSensitiveBlock = false;
  let blockIndent = 0;

  return lines.map((line) => {
    const blockMatch = line.match(/^(\s*)(data|stringData):\s*$/);
    if (blockMatch) {
      inSensitiveBlock = true;
      blockIndent = blockMatch[1].length;
      return line;
    }

    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (inSensitiveBlock && line.trim() && indent <= blockIndent) {
      inSensitiveBlock = false;
    }
    if (inSensitiveBlock && /^\s*[^#\s][^:]*:\s*.+$/.test(line)) {
      return line.replace(/(:\s*).+$/, "$1******");
    }
    return line;
  }).join("\n");
}

function isSensitiveYamlResource(input: {
  identity: ResourceIdentity | null;
  dynamicIdentity?: DynamicResourceIdentity | null;
  yamlText: string;
}) {
  const kind = input.identity?.kind ?? input.dynamicIdentity?.resource ?? "";
  return kind.toLowerCase().includes("secret") || /^kind:\s*Secret\b/im.test(input.yamlText);
}

export function ResourceYamlDrawer({
  open,
  onClose,
  token,
  identity,
  dynamicIdentity,
  onUpdated,
  readOnly = false,
  maskSensitive = true,
}: ResourceYamlDrawerProps) {
  const [yamlText, setYamlText] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [sensitiveVisible, setSensitiveVisible] = useState(false);
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
      setSensitiveVisible(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [query.data]);

  useEffect(() => {
    if (open) {
      return;
    }
    const timer = setTimeout(() => {
      setLocalError(null);
      setSensitiveVisible(false);
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
      if (readOnly) {
        throw new Error("当前 YAML 为只读状态，无法保存");
      }
      if (shouldMaskSensitive) {
        throw new Error("敏感内容已隐藏，请先显示敏感内容后再保存");
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
  const effectiveIdentity = identity ?? (query.data
    ? {
        clusterId: query.data.clusterId,
        namespace: query.data.namespace ?? "",
        kind: query.data.kind,
        name: query.data.name,
      }
    : null);
  const isDirty = Boolean(query.data?.yaml !== undefined && yamlText !== query.data.yaml);
  const isSensitiveResource = isSensitiveYamlResource({ identity, dynamicIdentity, yamlText });
  const shouldMaskSensitive = Boolean(maskSensitive && isSensitiveResource && !sensitiveVisible);
  const displayedYaml = shouldMaskSensitive ? maskSensitiveYaml(yamlText) : yamlText;
  const lineCount = yamlText ? yamlText.split("\n").length : 0;
  const downloadDisabled = query.isLoading || !effectiveIdentity || !yamlText.trim();
  const saveDisabled = query.isLoading || readOnly || shouldMaskSensitive || !yamlText.trim();

  return (
    <OpsDrawerShell
      title={title}
      size="large"
      open={open}
      destroyOnHidden
      variant="editor"
      styles={{
        body: { padding: 24, overflow: "auto" },
      }}
      extra={
        <Space wrap size={8}>
          {readOnly ? <OpsFilterChip tone="neutral">只读</OpsFilterChip> : <OpsFilterChip tone="info">可编辑</OpsFilterChip>}
          {isDirty ? <OpsFilterChip tone="warning">已修改</OpsFilterChip> : <OpsFilterChip tone="neutral">未修改</OpsFilterChip>}
          {isSensitiveResource ? <OpsFilterChip tone={shouldMaskSensitive ? "warning" : "danger"}>{shouldMaskSensitive ? "敏感已隐藏" : "敏感已显示"}</OpsFilterChip> : null}
          <OpsFilterChip tone="neutral">{lineCount} 行</OpsFilterChip>
        </Space>
      }
      onClose={() => {
        mutation.reset();
        setLocalError(null);
        setSensitiveVisible(false);
        onClose();
      }}
      footerActions={
        <Space wrap>
          <OpsIconActionButton
            icon={<DownloadOutlined />}
            disabled={downloadDisabled}
            disabledReason={downloadDisabled ? "没有可下载的 YAML" : undefined}
            onClick={() => {
              if (!effectiveIdentity || !yamlText.trim()) {
                return;
              }
              downloadTextFile(yamlText, buildYamlFilename(effectiveIdentity));
            }}
          >
            下载 YAML
          </OpsIconActionButton>
          <OpsIconActionButton
            icon={<CopyOutlined />}
            disabled={!yamlText.trim()}
            disabledReason={!yamlText.trim() ? "没有可复制的 YAML" : undefined}
            onClick={() => {
              void navigator.clipboard.writeText(yamlText).catch(() => setLocalError("复制 YAML 失败"));
            }}
          >
            复制
          </OpsIconActionButton>
          <OpsIconActionButton
            icon={<CodeOutlined />}
            disabled={readOnly || shouldMaskSensitive || !yamlText.trim()}
            disabledReason={readOnly ? "只读状态不可格式化" : shouldMaskSensitive ? "敏感内容隐藏时不可格式化" : undefined}
            onClick={() => setYamlText((value) => formatYamlText(value))}
          >
            格式化
          </OpsIconActionButton>
          <OpsIconActionButton
            icon={<UndoOutlined />}
            disabled={!isDirty}
            disabledReason={!isDirty ? "当前没有未保存修改" : undefined}
            onClick={() => {
              setYamlText(query.data?.yaml ?? "");
              setLocalError(null);
            }}
          >
            重置
          </OpsIconActionButton>
          {isSensitiveResource ? (
            <OpsIconActionButton
              icon={shouldMaskSensitive ? <EyeOutlined /> : <EyeInvisibleOutlined />}
              opsTone={shouldMaskSensitive ? "primary" : "danger"}
              onClick={() => setSensitiveVisible((value) => !value)}
            >
              {shouldMaskSensitive ? "显示敏感" : "隐藏敏感"}
            </OpsIconActionButton>
          ) : null}
          <OpsIconActionButton onClick={() => void query.refetch()} loading={query.isFetching}>
            重新加载
          </OpsIconActionButton>
          <OpsIconActionButton
            opsTone="primary"
            loading={mutation.isPending}
            disabled={saveDisabled}
            disabledReason={
              readOnly
                ? "当前 YAML 为只读状态"
                : shouldMaskSensitive
                  ? "敏感内容隐藏时不可保存"
                  : !yamlText.trim()
                    ? "YAML 内容不能为空"
                    : undefined
            }
            onClick={() => void mutation.mutateAsync()}
          >
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
        {query.isLoading ? (
          <OpsLoadingState compact title="正在加载 YAML" description="保持当前抽屉打开，加载完成后可继续查看或编辑。" />
        ) : null}
        {errorMessage ? <OpsErrorState compact title="YAML 操作失败" description={errorMessage} /> : null}
        <Input.TextArea
          value={displayedYaml}
          aria-label="YAML 内容"
          onChange={(e) => {
            if (shouldMaskSensitive || readOnly) {
              return;
            }
            setYamlText(e.target.value);
          }}
          autoSize={{ minRows: 20, maxRows: 30 }}
          placeholder="YAML 内容"
          style={{ fontFamily: "var(--kn-font-mono)", overflowX: "auto", whiteSpace: "pre" }}
          spellCheck={false}
          readOnly={readOnly || shouldMaskSensitive}
          disabled={query.isLoading}
        />
      </Space>
    </OpsDrawerShell>
  );
}
