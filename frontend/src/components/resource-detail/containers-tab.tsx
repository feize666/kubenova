"use client";

import { Table, Tag, Typography, Empty, Descriptions } from "antd";
import type { ResourceDetailResponse } from "@/lib/api/resources";

interface ContainerInfo {
  name: string;
  image: string;
  state?: string;
  restartCount?: number;
  ports?: string[];
  ready?: boolean;
  started?: boolean;
}

interface ContainersTabProps {
  detail: ResourceDetailResponse;
}

function extractContainers(detail: ResourceDetailResponse): ContainerInfo[] {
  const runtime = detail.runtime as unknown as Record<string, unknown>;
  const containers = runtime?.containers as Array<Record<string, unknown>> | undefined;
  if (containers && containers.length > 0) {
    return containers.map((c: Record<string, unknown>) => ({
      name: String(c.name ?? c.containerName ?? "-"),
      image: String(c.image ?? "-"),
      state: typeof c.state === "string" ? c.state : typeof c.status === "string" ? c.status : undefined,
      restartCount: typeof c.restartCount === "number" ? c.restartCount : undefined,
      ports: Array.isArray(c.ports) ? c.ports.map(String) : undefined,
      ready: Boolean(c.ready),
      started: Boolean(c.started ?? c.isStarted),
    }));
  }

  // Fallback: extract from runtime images
  const images = Array.isArray(runtime?.images) ? (runtime.images as string[]) : [];
  if (images.length > 0) {
    return images.map((img, idx) => ({
      name: `container-${idx}`,
      image: img,
    }));
  }

  return [];
}

export function ContainersTab({ detail }: ContainersTabProps) {
  const containers = extractContainers(detail);

  if (containers.length === 0) {
    return (
      <div style={{ padding: "40px 0" }}>
        <Empty description="暂无容器信息" />
      </div>
    );
  }

  if (containers.length === 1) {
    const c = containers[0];
    return (
      <div style={{ padding: "16px 0" }}>
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="名称">{c.name}</Descriptions.Item>
          <Descriptions.Item label="镜像">
            <Typography.Text code>{c.image}</Typography.Text>
          </Descriptions.Item>
          {c.state && (
            <Descriptions.Item label="状态">
              <Tag color={c.state === "running" ? "green" : c.state === "waiting" ? "orange" : "red"}>
                {c.state}
              </Tag>
            </Descriptions.Item>
          )}
          {c.restartCount !== undefined && (
            <Descriptions.Item label="重启次数">{c.restartCount}</Descriptions.Item>
          )}
          {c.ports && c.ports.length > 0 && (
            <Descriptions.Item label="端口">{c.ports.join(", ")}</Descriptions.Item>
          )}
        </Descriptions>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 0" }}>
      <Table
        dataSource={containers}
        rowKey="name"
        pagination={false}
        size="small"
        columns={[
          {
            title: "名称",
            dataIndex: "name",
            key: "name",
            width: 160,
          },
          {
            title: "镜像",
            dataIndex: "image",
            key: "image",
            ellipsis: true,
            render: (v: string) => (
              <Typography.Text code style={{ fontSize: 12 }}>
                {v}
              </Typography.Text>
            ),
          },
          {
            title: "状态",
            key: "state",
            width: 100,
            render: (_: unknown, r: ContainerInfo) =>
              r.state ? (
                <Tag color={r.state === "running" ? "green" : r.state === "waiting" ? "orange" : "red"}>
                  {r.state}
                </Tag>
              ) : (
                "-"
              ),
          },
          {
            title: "重启",
            dataIndex: "restartCount",
            key: "restartCount",
            width: 70,
            render: (v: number | undefined) => (v !== undefined ? v : "-"),
          },
          {
            title: "端口",
            dataIndex: "ports",
            key: "ports",
            width: 200,
            render: (v: string[] | undefined) => (v ? v.join(", ") : "-"),
          },
        ]}
      />
    </div>
  );
}
