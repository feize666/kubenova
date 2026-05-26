"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, Divider, Input, Row, Space, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { BusinessDetailDrawer, type BusinessDetailSection } from "@/components/business-detail-drawer";
import { ResourceTable } from "@/components/resource-table";
import type { HeadlampResourceTableColumn, HeadlampTableFilters } from "@/components/resource-table";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import {
  getSystemUpdateHistory,
  getSystemUpdateStatus,
  installSystemUpdate,
  restartSystemUpdate,
  rollbackSystemUpdate,
  triggerPostReleaseAudit,
  type SystemUpdateHistoryItem,
} from "@/lib/api/system-update";

function statusTag(status: string) {
  if (status === "installed") return <Tag color="success">已安装</Tag>;
  if (status === "installed-not-active") return <Tag color="warning">已安装未激活</Tag>;
  if (status === "installing" || status === "restarting" || status === "rollbacking") {
    return <Tag color="processing">进行中</Tag>;
  }
  if (status === "failed") return <Tag color="error">失败</Tag>;
  return <Tag>空闲</Tag>;
}

export default function SystemUpdatePage() {
  const { message } = App.useApp();
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const [targetVersion, setTargetVersion] = useState("v0.0.1");
  const [rollbackVersion, setRollbackVersion] = useState("");
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const [detailRecord, setDetailRecord] = useState<SystemUpdateHistoryItem | null>(null);

  const statusQuery = useQuery({
    queryKey: ["system-update", "status", accessToken],
    queryFn: () => getSystemUpdateStatus(accessToken ?? undefined),
    enabled: !isInitializing && Boolean(accessToken),
    refetchInterval: 5000,
  });

  const historyQuery = useQuery({
    queryKey: ["system-update", "history", accessToken],
    queryFn: () => getSystemUpdateHistory(accessToken ?? undefined),
    enabled: !isInitializing && Boolean(accessToken),
    refetchInterval: 5000,
  });

  const installMutation = useMutation({
    mutationFn: () =>
      installSystemUpdate(
        {
          confirm: true,
          targetVersion: targetVersion.trim(),
        },
        accessToken ?? undefined,
      ),
    onSuccess: async () => {
      message.success("安装已完成：当前为已安装未激活状态，请执行重启激活");
      await queryClient.invalidateQueries({ queryKey: ["system-update"] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "发布失败");
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: () =>
      rollbackSystemUpdate(
        {
          confirm: true,
          ...(rollbackVersion.trim() ? { targetVersion: rollbackVersion.trim() } : {}),
          message: "秒级回滚（指针切换）",
        },
        accessToken ?? undefined,
      ),
    onSuccess: async () => {
      message.success("回滚已完成（秒级指针切换）");
      await queryClient.invalidateQueries({ queryKey: ["system-update"] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "回滚失败");
    },
  });

  const restartMutation = useMutation({
    mutationFn: () =>
      restartSystemUpdate(
        {
          confirm: true,
          message: "激活已安装版本",
        },
        accessToken ?? undefined,
      ),
    onSuccess: async () => {
      message.success("重启完成，已尝试激活安装版本");
      await queryClient.invalidateQueries({ queryKey: ["system-update"] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "重启失败");
    },
  });

  const auditMutation = useMutation({
    mutationFn: () =>
      triggerPostReleaseAudit(
        {
          confirm: true,
          releaseVersion: statusQuery.data?.runningVersion,
        },
        accessToken ?? undefined,
      ),
    onSuccess: async () => {
      message.success("发布后审计已触发（异步执行）");
      await queryClient.invalidateQueries({ queryKey: ["system-update"] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "触发审计失败");
    },
  });

  const columns: Array<HeadlampResourceTableColumn<SystemUpdateHistoryItem>> = [
    {
      title: "时间",
      dataIndex: "timestamp",
      key: "timestamp",
      required: true,
      width: 180,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: "操作",
      dataIndex: "operationType",
      key: "operationType",
      width: 170,
      filter: { type: "text", placeholder: "以操作过滤" },
      render: (v: string, record) => (
        <Typography.Link onClick={() => setDetailRecord(record)}>
          <Tag>{v}</Tag>
        </Typography.Link>
      ),
    },
    {
      title: "目标版本",
      dataIndex: "targetVersion",
      key: "targetVersion",
      width: 160,
      filter: { type: "text", placeholder: "以版本过滤" },
      render: (v?: string) => v || "-",
    },
    {
      title: "结果",
      dataIndex: "result",
      key: "result",
      width: 100,
      filter: {
        type: "select",
        placeholder: "以结果过滤",
        options: [
          { label: "成功", value: "success" },
          { label: "失败", value: "failed" },
        ],
      },
      render: (v: string) => <Tag color={v === "success" ? "success" : "error"}>{v}</Tag>,
    },
    {
      title: "耗时(ms)",
      dataIndex: "durationMs",
      key: "durationMs",
      width: 120,
      render: (v?: number) => (typeof v === "number" ? v : "-"),
    },
    {
      title: "消息",
      dataIndex: "message",
      key: "message",
      filter: { type: "text", placeholder: "以消息过滤" },
    },
  ];

  const status = statusQuery.data;
  const historyRows = useMemo(() => {
    const operationFilter = typeof tableFilters.operationType === "string" ? tableFilters.operationType.toLowerCase() : "";
    const targetVersionFilter = typeof tableFilters.targetVersion === "string" ? tableFilters.targetVersion.toLowerCase() : "";
    const resultFilter = typeof tableFilters.result === "string" ? tableFilters.result : "";
    const messageFilter = typeof tableFilters.message === "string" ? tableFilters.message.toLowerCase() : "";
    return (historyQuery.data?.items ?? []).filter((item) => {
      const matchOperation = operationFilter ? item.operationType.toLowerCase().includes(operationFilter) : true;
      const matchVersion = targetVersionFilter ? (item.targetVersion ?? "").toLowerCase().includes(targetVersionFilter) : true;
      const matchResult = resultFilter ? item.result === resultFilter : true;
      const matchMessage = messageFilter ? item.message.toLowerCase().includes(messageFilter) : true;
      return matchOperation && matchVersion && matchResult && matchMessage;
    });
  }, [
    historyQuery.data?.items,
    tableFilters.message,
    tableFilters.operationType,
    tableFilters.result,
    tableFilters.targetVersion,
  ]);

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ marginBottom: 0 }}>
        更新管理
      </Typography.Title>
      <Typography.Text type="secondary">系统管理 / 更新管理</Typography.Text>

      <Alert
        showIcon
        type="success"
        message="更新策略：安装与激活分离"
        description="安装阶段只落盘新版本；重启阶段激活运行版本并异步触发发布后审计。回滚保持指针切换，目标秒级恢复。"
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="版本状态" bordered>
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              <div>
                <Typography.Text type="secondary">当前版本</Typography.Text>
                <div>
                  <Tag color="blue">{status?.runningVersion ?? "-"}</Tag>
                </div>
              </div>
              <div>
                <Typography.Text type="secondary">已安装版本</Typography.Text>
                <div>
                  <Tag color="geekblue">{status?.installedVersion ?? "-"}</Tag>
                </div>
              </div>
              <div>
                <Typography.Text type="secondary">最新版本</Typography.Text>
                <div>
                  <Tag color="gold">{status?.latestVersion ?? "-"}</Tag>
                </div>
              </div>
              <div>
                <Typography.Text type="secondary">备份版本（回滚指针）</Typography.Text>
                <div>
                  <Tag color="cyan">{status?.backupVersion ?? "-"}</Tag>
                </div>
              </div>
              <div>
                <Typography.Text type="secondary">安装状态</Typography.Text>
                <div>{status ? statusTag(status.installStatus) : <Tag>加载中</Tag>}</div>
              </div>
              <div>
                <Typography.Text type="secondary">可安装状态</Typography.Text>
                <div>
                  <Tag color={status?.installable ? "success" : "error"}>
                    {status?.installable ? "可安装" : "暂不可安装"}
                  </Tag>
                </div>
              </div>
              <Divider style={{ margin: "8px 0" }} />
              <div>
                <Typography.Text type="secondary">回滚模式</Typography.Text>
                <div>
                  <Tag color="purple">{status?.releaseMode ?? "pointer-swap"}</Tag>
                  <Typography.Text style={{ marginLeft: 8 }}>
                    目标 SLA: {status?.rollbackSlaTargetMs ?? 3000}ms
                  </Typography.Text>
                </div>
              </div>
              <div>
                <Typography.Text type="secondary">最近回滚耗时</Typography.Text>
                <div>
                  <Tag color={status?.rollbackSlaMet ? "success" : "error"}>
                    {status?.rollbackSlaLastMs ?? "-"} ms
                  </Tag>
                  {status?.rollbackSlaMet !== null && status?.rollbackSlaMet !== undefined ? (
                    <Typography.Text style={{ marginLeft: 8 }}>
                      {status.rollbackSlaMet ? "达标" : "未达标"}
                    </Typography.Text>
                  ) : null}
                </div>
              </div>
              <Divider style={{ margin: "8px 0" }} />
              <div>
                <Typography.Text type="secondary">发布后审计</Typography.Text>
                <div>
                  <Tag color={status?.postReleaseAudit.status === "failed" ? "error" : status?.postReleaseAudit.status === "passed" ? "success" : "processing"}>
                    {status?.postReleaseAudit.status ?? "idle"}
                  </Tag>
                  <Typography.Text style={{ marginLeft: 8 }}>
                    {status?.postReleaseAudit.lastSummary ?? "暂无结果"}
                  </Typography.Text>
                </div>
              </div>
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={12}>
          <Card title="操作区" bordered>
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              <Typography.Text type="secondary">
                安装不阻塞运行流量；重启后激活新版本并异步审计。回滚采用指针切换，目标秒级完成。
              </Typography.Text>
              <Input
                value={targetVersion}
                onChange={(e) => setTargetVersion(e.target.value)}
                placeholder="目标发布版本，例如 v1.4.2"
              />
              <Button type="primary" loading={installMutation.isPending} onClick={() => installMutation.mutate()}>
                安装更新（不立即激活）
              </Button>
              <Button loading={restartMutation.isPending} onClick={() => restartMutation.mutate()}>
                重启并激活已安装版本
              </Button>
              <Input
                value={rollbackVersion}
                onChange={(e) => setRollbackVersion(e.target.value)}
                placeholder="回滚到版本（可选，默认最近备份）"
              />
              <Button danger loading={rollbackMutation.isPending} onClick={() => rollbackMutation.mutate()}>
                秒级回滚（指针切换）
              </Button>
              <Button loading={auditMutation.isPending} onClick={() => auditMutation.mutate()}>
                手动触发发布后审计
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>

      <Card title="更新历史">
        <ResourceTable<SystemUpdateHistoryItem>
          rowKey={(row, idx) => `${row.timestamp}-${row.operationType}-${idx}`}
          tableKey="business.system.updateHistory"
          columns={columns as ColumnsType<SystemUpdateHistoryItem>}
          dataSource={historyRows}
          preferencesClient={createTablePreferencesClient(accessToken || undefined)}
          filters={tableFilters}
          onFiltersChange={setTableFilters}
          loading={statusQuery.isLoading || historyQuery.isLoading}
          pagination={false}
          scroll={{ x: 1100 }}
        />
      </Card>
      <BusinessDetailDrawer
        open={Boolean(detailRecord)}
        title={detailRecord ? `更新历史 · ${detailRecord.operationType}` : "更新历史"}
        subtitle={detailRecord?.targetVersion}
        onClose={() => setDetailRecord(null)}
        sections={buildSystemUpdateDetailSections(detailRecord)}
      />
    </Space>
  );
}

function buildSystemUpdateDetailSections(record: SystemUpdateHistoryItem | null): BusinessDetailSection[] {
  if (!record) {
    return [];
  }
  return [
    {
      key: "operation",
      title: "操作信息",
      items: [
        { key: "operationType", label: "操作", value: record.operationType },
        { key: "targetVersion", label: "目标版本", value: record.targetVersion || "-" },
        { key: "result", label: "结果", value: statusTag(record.result === "success" ? "installed" : "failed") },
        { key: "timestamp", label: "时间", value: new Date(record.timestamp).toLocaleString("zh-CN") },
      ],
    },
    {
      key: "detail",
      title: "执行详情",
      items: [
        { key: "durationMs", label: "耗时(ms)", value: typeof record.durationMs === "number" ? record.durationMs : "-" },
        { key: "message", label: "消息", value: record.message || "-" },
      ],
    },
  ];
}
