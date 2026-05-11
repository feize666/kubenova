"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Input, Space, Typography } from "antd";
import { useMutation, useQuery } from "@tanstack/react-query";
//import {
//  getClusters,
//  getResourceYaml,
//  updateResourceYaml,
//  type ResourceIdentity,
//} from "@/lib/api/resources";

import {
  getResourceYaml,
  updateResourceYaml,
  type ResourceIdentity,
} from "@/lib/api/resources";

import { getClusters } from "@/lib/api/clusters";

import { getClusterDisplayName } from "@/lib/cluster-display-name";

interface ResourceYamlDrawerProps {
  open: boolean;
  onClose: () => void;
  token?: string;
  identity: ResourceIdentity | null;
  onUpdated?: () => void;
}

export function ResourceYamlDrawer({
  open,
  onClose,
  token,
  identity,
  onUpdated,
}: ResourceYamlDrawerProps) {
  const [yamlText, setYamlText] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["resource-yaml", identity?.clusterId, identity?.namespace, identity?.kind, identity?.name, token],
    queryFn: () => getResourceYaml(identity!, token),
    enabled: open && Boolean(identity?.clusterId && identity?.namespace && identity?.kind && identity?.name),
  });
  const clusterQuery = useQuery({
    queryKey: ["resource-yaml", "clusters", token],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, token!),
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
      if (!identity) {
        throw new Error("资源标识缺失，无法提交 YAML");
      }
      const normalized = yamlText.trim();
      if (!normalized) {
        throw new Error("YAML 内容不能为空");
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

  return (
    <Drawer
      title={title}
      size="large"
      open={open}
      destroyOnHidden
      onClose={() => {
        mutation.reset();
        setLocalError(null);
        onClose();
      }}
      extra={
        <Space>
          <Button onClick={() => void query.refetch()} loading={query.isFetching}>
            重新加载
          </Button>
          <Button type="primary" loading={mutation.isPending} onClick={() => void mutation.mutateAsync()}>
            保存 YAML
          </Button>
        </Space>
      }
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        {identity ? (
          <Typography.Text type="secondary">
            集群 {getClusterDisplayName(clusterMap, identity.clusterId)} · 名称空间 {identity.namespace} · 资源 {identity.kind}/{identity.name}
          </Typography.Text>
        ) : null}
        {errorMessage ? <Alert type="error" showIcon message={errorMessage} /> : null}
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
    </Drawer>
  );
}
