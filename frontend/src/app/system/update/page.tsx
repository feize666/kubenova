"use client";

import { CheckCircleOutlined, CloudDownloadOutlined, ClockCircleOutlined, LinkOutlined, ReloadOutlined, RollbackOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Empty, Progress, Result, Skeleton } from "antd";
import { Select } from "antd";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { useAuth } from "@/components/auth-context";
import { OpsIconActionButton, OpsStatusTag, OpsSurface } from "@/components/ops";
import { isPlatformAdmin } from "@/lib/console-routing";
import { checkSystemUpdate, getSystemReleases, getSystemUpdateHistory, getSystemUpdateStatus } from "@/lib/api/system-update";
import { installSystemUpdate, rollbackSystemUpdate } from "@/lib/api/system-update";
import styles from "./release-center.module.css";

const dateLabel = (value?: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未检查";

const isLaterVersion = (candidate: string, current: string) => {
  const left = candidate.replace(/^v/, "").split(".").map(Number);
  const right = current.replace(/^v/, "").split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) > (right[index] ?? 0);
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
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [selectedVersion, setSelectedVersion] = useState<string>();
  const [rollbackVersion, setRollbackVersion] = useState<string>();
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
  const historyQuery = useQuery({ queryKey: ["system-update", "history", accessToken], queryFn: () => getSystemUpdateHistory(accessToken), staleTime: 30_000, refetchInterval: 10_000 });
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
    onSuccess: (data) => { queryClient.setQueryData(["system-update", "status", accessToken], data); void historyQuery.refetch(); },
    onError: (error: Error) => message.error(error.message || "升级任务提交失败"),
  });
  const rollbackMutation = useMutation({
    mutationFn: (targetVersion: string) => rollbackSystemUpdate({ confirm: true, targetVersion }, accessToken),
    onSuccess: (data) => { queryClient.setQueryData(["system-update", "status", accessToken], data); void historyQuery.refetch(); },
    onError: (error: Error) => message.error(error.message || "回滚任务提交失败"),
  });
  const status = statusQuery.data;
  const issue = statusQuery.error?.message || status?.updateCheckError;
  const releaseValidation = status?.releaseValidationMessage;
  const state = issue ? "error" : status?.checkState ?? "checking";
  const checking = checkMutation.isPending || state === "checking";
  const stateLabels = { checking: "正在检查", current: "已是最新版本", available: "发现新版本", "migration-required": "需要迁移版本编号", ahead: "运行版本高于发布版本", error: "检查失败" };
  const tone = state === "error" ? "danger" : state === "migration-required" ? "warning" : state === "current" ? "success" : "info";
  const releasesError = releasesQuery.error?.message || releasesQuery.data?.error;
  const taskActive = Boolean(status && !["idle", "installed", "failed"].includes(status.installStatus));
  const taskBusy = taskActive || installMutation.isPending || rollbackMutation.isPending;
  const targetVersion = selectedVersion || status?.latestVersion;
  const selectedRelease = releasesQuery.data?.items.find((release) => release.tag === targetVersion);
  const targetIsLatest = targetVersion === status?.latestVersion;
  const targetDownload = selectedRelease?.downloadUrl ?? (targetIsLatest ? status?.downloadUrl : null);
  const targetChecksum = selectedRelease?.checksumUrl ?? (targetIsLatest ? status?.checksumUrl : null);
  const targetUrl = selectedRelease?.url ?? (targetIsLatest ? status?.latestReleaseUrl : null);
  const targetNotes = selectedRelease ? selectedRelease.notes : targetIsLatest ? status?.releaseNotes : null;
  const rollbackTarget = rollbackVersion || status?.backupVersion || status?.rollbackCandidates?.[0]?.version;
  const targetReady = !issue && Boolean(targetDownload && targetChecksum && (selectedRelease?.manifestUrl ?? status?.manifestUrl)) && (!selectedVersion || Boolean(selectedRelease));
  const installLabels: Record<string, string> = { queued: "等待执行", installing: "准备升级", "backing-up": "备份数据库", downloading: "获取发布清单", verifying: "校验版本与镜像", switching: "切换服务", "health-check": "检查服务健康", rollbacking: "恢复旧版本", "installed-not-active": "等待新版本服务就绪" };
  const installNow = () => {
    if (!targetVersion) return;
    modal.confirm({
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
      <OpsIconActionButton aria-label="检查更新" icon={<ReloadOutlined />} loading={checking} onClick={() => checkMutation.mutate()}>检查更新</OpsIconActionButton>
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
    {!issue && releaseValidation && <Alert type="warning" showIcon title="已发现正式版本，但暂不可在线升级" description={releaseValidation + "可打开发布记录查看详情，待管理员补齐发布资产后再执行升级。"} />}
    {state === "migration-required" && <Alert type="warning" showIcon title="版本编号已调整" description="旧编号系列已统一重整为 v1.1。请备份后按下方指引手动迁移；这不是自动降级，也不会修改当前服务。" />}
    {state === "ahead" && <Alert type="info" showIcon title="当前构建高于正式发布" description="可能正在使用开发构建或其他发布渠道。不会自动降级，请核对部署来源。" />}
    <OpsSurface as="section" title="在线升级" subtitle="仅超级管理员可执行；升级由宿主机执行器完成，页面持续显示进度。" padding="md">
      <div className={styles.upgradeActions}>
        <Select aria-label="选择升级版本" value={targetVersion} onChange={setSelectedVersion} disabled={taskBusy} loading={releasesQuery.isPending} options={(releasesQuery.data?.items ?? []).map((release) => ({ value: release.tag, label: release.tag + (release.releaseReady ? " · 正式版本" : " · 资产不完整"), disabled: !release.releaseReady }))} style={{ minWidth: 220, maxWidth: "100%" }} />
        <Button type="primary" icon={<CloudDownloadOutlined />} loading={installMutation.isPending} disabled={!targetReady || !targetVersion || !status?.installable || taskBusy || !status || !isLaterVersion(targetVersion, status.runningVersion)} onClick={installNow}>立即升级到 {targetVersion ?? "最新版本"}</Button>
        {!!status?.rollbackCandidates?.length && rollbackTarget && <><Select aria-label="选择回滚版本" value={rollbackTarget} onChange={setRollbackVersion} disabled={taskBusy} options={status.rollbackCandidates.map((candidate) => ({ value: candidate.version, label: candidate.version }))} /><Button loading={rollbackMutation.isPending} disabled={taskBusy || !!statusQuery.error} onClick={() => modal.confirm({ title: `回滚到 ${rollbackTarget}？`, content: "系统将切换到已验证的应用镜像并执行健康检查，数据库不会自动恢复。", okText: "确认回滚", cancelText: "取消", onOk: () => rollbackMutation.mutateAsync(rollbackTarget) })}>回滚到 {rollbackTarget}</Button></>}
      </div>
      <div className={styles.updateFacts} aria-label="升级环境状态">
        <span><CheckCircleOutlined /> 发布资产：{status?.releaseReady ? "清单完整" : releaseValidation ? "待补齐" : "待确认"}</span>
        <span><ClockCircleOutlined /> 执行器：{status?.installable ? "已就绪" : "未接入"}</span>
        <span><RollbackOutlined /> 回滚：{status?.rollbackCandidates?.length ? `可恢复 ${status.rollbackCandidates.length} 个版本` : "暂无可恢复版本"}</span>
      </div>
      {!status?.installable && <p className={styles.meta}>在线升级暂不可用：{status?.manualUpdateReason ?? "未配置宿主机升级执行器"}</p>}
      {statusQuery.error && taskActive && <Alert type="warning" showIcon title="正在重新连接升级任务" description="服务切换期间可能短暂断开，恢复连接后将继续显示任务进度。请勿重复提交。" />}
      {status?.installProgress && <div className={styles.progressPanel} role="status" aria-live="polite"><div><strong>{installLabels[status.installProgress.phase] ?? "任务执行中"}</strong><span className={styles.meta}>{status.installProgress.message ?? "任务执行中"}</span></div><Progress percent={status.installProgress.percent ?? undefined} status={status.installStatus === "failed" ? "exception" : undefined} /><span className={styles.meta}>任务 {status.installProgress.taskId} · 开始于 {dateLabel(status.installProgress.startedAt)}</span></div>}
      {status?.installStatus === "installed" && <Alert type="success" showIcon title="升级完成" description={`当前运行版本：${status.runningVersion}`} />}
      {status?.installStatus === "failed" && <Alert type="error" showIcon title="升级失败" description={status.installProgress?.message ?? "执行器已终止任务，可查看审计记录后重试或回滚。"} />}
    </OpsSurface>
    <OpsSurface as="section" title="操作记录" subtitle="升级、回滚与发布后审计均会写入审计记录。" padding="md">
      {historyQuery.isError && <Alert type="warning" showIcon title="操作记录读取失败" description="无法确认当前记录，请重试。" action={<Button onClick={() => void historyQuery.refetch()}>重试</Button>} />}
      {historyQuery.isPending ? <Skeleton active paragraph={{ rows: 2 }} /> : historyQuery.data?.items.length ? <ul className={styles.history}>{historyQuery.data.items.slice(0, 8).map((item, index) => { const resultLabel = item.result === "success" ? "成功" : item.result === "failed" ? "失败" : item.result === "running" ? "执行中" : "已提交"; const resultTone = item.result === "success" ? "success" : item.result === "failed" ? "danger" : "info"; return <li key={`${item.timestamp}-${index}`}><div><strong>{item.operationType === "install" ? "在线升级" : item.operationType === "rollback" ? "版本回滚" : "发布后审计"}</strong><span className={styles.meta}>{item.targetVersion ? `目标 ${item.targetVersion} · ` : ""}{dateLabel(item.timestamp)} · {item.operator}</span><span>{item.message}</span></div><OpsStatusTag tone={resultTone}>{resultLabel}</OpsStatusTag></li>; })}</ul> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无操作记录" />}
    </OpsSurface>
    <OpsSurface as="section" title="发布说明" subtitle="修复内容与升级注意事项来自正式 Release" padding="md">
      <OpsStatusTag tone="info">{targetVersion ?? "尚无可用版本"}</OpsStatusTag>
      {targetNotes ? <ReleaseNotes>{targetNotes}</ReleaseNotes> : <p className={styles.meta}>{checking ? "正在读取发布信息…" : "暂无发布说明，请在 GitHub 查看该版本记录。"}</p>}
      <div className={styles.downloads}>
        <Button type="primary" icon={<CloudDownloadOutlined />} href={targetReady ? targetDownload ?? undefined : undefined} disabled={!targetReady}>下载 Linux x64 发布包</Button>
        <Button href={targetReady ? targetChecksum ?? undefined : undefined} disabled={!targetReady}>SHA256 校验文件</Button>
        {targetUrl && <Button type="link" icon={<LinkOutlined />} href={targetUrl} target="_blank" rel="noopener noreferrer">GitHub Release</Button>}
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
