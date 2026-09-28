"use client";

import { CloudDownloadOutlined, LinkOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Empty, Modal, Progress, Result, Skeleton } from "antd";
import { Select } from "antd";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { useAuth } from "@/components/auth-context";
import { OpsIconActionButton, OpsStatusTag, OpsSurface } from "@/components/ops";
import { isPlatformAdmin } from "@/lib/console-routing";
import { checkSystemUpdate, getSystemReleases, getSystemUpdateStatus } from "@/lib/api/system-update";
import { installSystemUpdate, rollbackSystemUpdate } from "@/lib/api/system-update";
import styles from "./release-center.module.css";

const dateLabel = (value?: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未检查";

const isLaterVersion = (candidate: string, current: string) => {
  const left = candidate.replace(/^v/, "").split(".").map(Number);
  const right = current.replace(/^v/, "").split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
};

function ReleaseNotes({ children }: { children: string }) {
  return <div className={styles.notes}><ReactMarkdown
    allowedElements={["p", "h1", "h2", "h3", "h4", "ul", "ol", "li", "strong", "em", "code", "pre", "a", "br", "blockquote", "hr"]}
    components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}
  >{children}</ReactMarkdown></div>;
}

export default function SystemUpdatePage() {
  const { isInitializing, role, accessToken } = useAuth();
  if (isInitializing) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (!accessToken || !isPlatformAdmin(role)) return <Result status="403" title="仅超级管理员可访问" subTitle="系统更新包含平台发布与升级信息，请联系超级管理员。" />;
  return <ReleaseCenter accessToken={accessToken} />;
}

function ReleaseCenter({ accessToken }: { accessToken: string }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [selectedVersion, setSelectedVersion] = useState<string>();
  const statusQuery = useQuery({
    queryKey: ["system-update", "status", accessToken],
    queryFn: () => getSystemUpdateStatus(accessToken),
    staleTime: 60_000,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.checkState === "checking" || (data?.installStatus && !["idle", "installed", "failed"].includes(data.installStatus)) ? 2000 : 300_000;
    },
    refetchIntervalInBackground: false,
  });
  const releasesQuery = useQuery({ queryKey: ["system-update", "releases", accessToken], queryFn: () => getSystemReleases(accessToken), staleTime: 300_000 });
  const checkMutation = useMutation({
    mutationFn: () => checkSystemUpdate(accessToken),
    onSuccess: (data) => {
      queryClient.setQueryData(["system-update", "status", accessToken], data);
      void queryClient.invalidateQueries({ queryKey: ["system-update", "releases", accessToken] });
    },
    onError: (error: Error) => message.error(error.message || "检查失败，请稍后重试"),
  });
  const installMutation = useMutation({
    mutationFn: (targetVersion: string) => installSystemUpdate({ confirm: true, targetVersion }, accessToken),
    onSuccess: (data) => queryClient.setQueryData(["system-update", "status", accessToken], data),
    onError: (error: Error) => message.error(error.message || "升级任务提交失败"),
  });
  const rollbackMutation = useMutation({
    mutationFn: (targetVersion: string) => rollbackSystemUpdate({ confirm: true, targetVersion }, accessToken),
    onSuccess: (data) => queryClient.setQueryData(["system-update", "status", accessToken], data),
    onError: (error: Error) => message.error(error.message || "回滚任务提交失败"),
  });
  const status = statusQuery.data;
  const issue = statusQuery.error?.message || status?.updateCheckError;
  const state = issue ? "error" : status?.checkState ?? "checking";
  const checking = checkMutation.isPending || state === "checking";
  const stateLabels = { checking: "正在检查", current: "已是最新版本", available: "发现新版本", "migration-required": "需要迁移版本编号", ahead: "运行版本高于发布版本", error: "检查失败" };
  const tone = state === "error" ? "danger" : state === "migration-required" ? "warning" : state === "current" ? "success" : "info";
  const ready = Boolean(status?.releaseReady && !issue && status?.latestVersion);
  const releasesError = releasesQuery.error?.message || releasesQuery.data?.error;
  const taskActive = Boolean(status && !["idle", "installed", "failed"].includes(status.installStatus));
  const taskBusy = taskActive || installMutation.isPending || rollbackMutation.isPending;
  const targetVersion = selectedVersion || status?.latestVersion;
  const installNow = () => {
    if (!targetVersion) return;
    Modal.confirm({
      title: "升级到 " + targetVersion + "？",
      content: "系统将先备份 PostgreSQL，再切换 Docker Compose 镜像并执行健康检查。失败时自动回滚应用镜像，数据库不会自动回滚。",
      okText: "立即升级",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => installMutation.mutateAsync(targetVersion),
    });
  };

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><h1>系统更新</h1><p>正式发布、版本检测与在线升级。升级任务由受保护的宿主机执行器处理。</p></div>
      <OpsIconActionButton icon={<ReloadOutlined />} loading={checking} onClick={() => checkMutation.mutate()}>检查更新</OpsIconActionButton>
    </header>
    <OpsSurface as="section" padding="md" aria-label="版本状态">
      {statusQuery.isPending ? <Skeleton active paragraph={{ rows: 2 }} /> : <>
        <div className={styles.versions}>
          <div><span className={styles.label}>当前运行版本</span><strong>{status?.runningVersion ?? "无法读取"}</strong><span className={styles.meta}>{status?.buildType === "release" ? "发布构建" : status ? "源码构建" : "请重新检查"}</span></div>
          <div><span className={styles.label}>最新正式版本</span><strong>{status?.latestReleaseUrl ? status.latestVersion : "待确认"}</strong><span className={styles.meta}>{status?.latestReleasePublishedAt ? "发布于 " + dateLabel(status.latestReleasePublishedAt) : "以完整 GitHub Release 为准"}</span></div>
        </div>
        <div className={styles.statusLine} role="status" aria-live="polite"><OpsStatusTag tone={tone}>{stateLabels[state]}</OpsStatusTag><span>最近检查：{dateLabel(status?.lastUpdateCheckAt)}</span></div>
      </>}
    </OpsSurface>
    {issue && <Alert type="error" showIcon title="未能确认最新版本" description={issue} />}
    {state === "migration-required" && <Alert type="warning" showIcon title="版本编号已调整" description="旧编号系列已统一重整为 v1.1。请备份后按下方指引手动迁移；这不是自动降级，也不会修改当前服务。" />}
    {state === "ahead" && <Alert type="info" showIcon title="当前构建高于正式发布" description="可能正在使用开发构建或其他发布渠道。不会自动降级，请核对部署来源。" />}
    <OpsSurface as="section" title="在线升级" subtitle="仅超级管理员可执行；升级由宿主机执行器完成，页面持续显示进度。" padding="md">
      <div className={styles.upgradeActions}>
        <Select aria-label="选择升级版本" value={targetVersion} onChange={setSelectedVersion} options={(releasesQuery.data?.items ?? []).filter((release) => release.releaseReady).map((release) => ({ value: release.tag, label: release.tag + " · " + (release.name || "正式版本") }))} style={{ minWidth: 220 }} />
        <Button type="primary" danger icon={<CloudDownloadOutlined />} loading={installMutation.isPending} disabled={!ready || !targetVersion || !status?.installable || taskBusy || !status || !isLaterVersion(targetVersion, status.runningVersion)} onClick={installNow}>立即升级到 {targetVersion ?? "最新版本"}</Button>
        {status?.backupAvailable && status.backupVersion && <Button loading={rollbackMutation.isPending} disabled={taskBusy} onClick={() => Modal.confirm({ title: `回滚到 ${status.backupVersion}？`, content: "仅回滚应用镜像，不会自动恢复数据库。", okText: "确认回滚", cancelText: "取消", onOk: () => rollbackMutation.mutateAsync(status.backupVersion!) })}>回滚到 {status.backupVersion}</Button>}
      </div>
      {!status?.installable && <p className={styles.meta}>在线升级暂不可用：{status?.manualUpdateReason ?? "未配置宿主机升级执行器"}</p>}
      {status?.installProgress && <div className={styles.progressPanel} role="status" aria-live="polite"><div><strong>{status.installProgress.phase}</strong><span className={styles.meta}>{status.installProgress.message ?? "任务执行中"}</span></div><Progress percent={status.installProgress.percent ?? undefined} status={status.installStatus === "failed" ? "exception" : undefined} /><span className={styles.meta}>任务 {status.installProgress.taskId} · 开始于 {dateLabel(status.installProgress.startedAt)}</span></div>}
      {status?.installStatus === "installed" && <Alert type="success" showIcon title="升级完成" description={`当前运行版本：${status.runningVersion}`} />}
      {status?.installStatus === "failed" && <Alert type="error" showIcon title="升级失败" description={status.installProgress?.message ?? "执行器已终止任务，可查看审计记录后重试或回滚。"} />}
    </OpsSurface>
    <OpsSurface as="section" title="发布说明" subtitle="修复内容与升级注意事项来自正式 Release" padding="md">
      {status?.releaseNotes ? <ReleaseNotes>{status.releaseNotes}</ReleaseNotes> : <p className={styles.meta}>{checking ? "正在读取发布信息…" : "暂无发布说明，请在 GitHub 查看该版本记录。"}</p>}
      <div className={styles.downloads}>
        <Button type="primary" icon={<CloudDownloadOutlined />} href={ready ? status?.downloadUrl ?? undefined : undefined} disabled={!ready || !status?.downloadUrl}>下载 Linux x64 发布包</Button>
        <Button href={ready ? status?.checksumUrl ?? undefined : undefined} disabled={!ready || !status?.checksumUrl}>SHA256 校验文件</Button>
        {status?.latestReleaseUrl && <Button type="link" icon={<LinkOutlined />} href={status.latestReleaseUrl} target="_blank" rel="noopener noreferrer">GitHub Release</Button>}
      </div>
      <p className={styles.meta}>原生包：Ubuntu 24.04 x64 · Node.js 22+。容器镜像：Linux amd64。未配置执行器时仍可下载并手动部署。</p>
    </OpsSurface>
    <OpsSurface as="section" title="正式发布记录" subtitle="最近 10 个稳定 Release；发布记录不代表本机已经安装" padding="md">
      {releasesQuery.isPending ? <Skeleton active paragraph={{ rows: 3 }} /> : releasesError ? <Alert type="warning" showIcon title="发布记录读取失败" description={releasesError} action={<Button size="small" onClick={() => void releasesQuery.refetch()}>重试</Button>} /> : releasesQuery.data?.items.length ?
        <ul className={styles.releases}>{releasesQuery.data.items.map((release) => <li key={release.tag}>
          <div><a href={release.url} target="_blank" rel="noopener noreferrer">{release.name || release.tag} <LinkOutlined /></a><span className={styles.meta}>{release.publishedAt ? dateLabel(release.publishedAt) : "发布时间未提供"}</span></div>
          <OpsStatusTag tone={release.releaseReady ? "neutral" : "warning"}>{release.releaseReady ? "产物完整" : "产物不完整"}</OpsStatusTag>
        </li>)}</ul> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无正式 Release；仅推送 tag 不会产生可安装版本" />}
    </OpsSurface>
  </div>;
}
