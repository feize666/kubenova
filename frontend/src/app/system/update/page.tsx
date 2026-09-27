"use client";

import { CloudDownloadOutlined, LinkOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Collapse, Empty, Result, Segmented, Skeleton, Typography } from "antd";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { useAuth } from "@/components/auth-context";
import { OpsIconActionButton, OpsStatusTag, OpsSurface } from "@/components/ops";
import { isPlatformAdmin } from "@/lib/console-routing";
import { checkSystemUpdate, getSystemReleases, getSystemUpdateStatus } from "@/lib/api/system-update";
import { buildUpdateGuide } from "@/lib/system-update-guide";
import styles from "./release-center.module.css";

const dateLabel = (value?: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未检查";

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
  const [mode, setMode] = useState<"compose" | "systemd">("compose");
  const statusQuery = useQuery({
    queryKey: ["system-update", "status", accessToken],
    queryFn: () => getSystemUpdateStatus(accessToken),
    staleTime: 60_000,
    refetchInterval: (query) => query.state.data?.checkState === "checking" ? 2000 : 300_000,
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
  const status = statusQuery.data;
  const issue = statusQuery.error?.message || status?.updateCheckError;
  const state = issue ? "error" : status?.checkState ?? "checking";
  const checking = checkMutation.isPending || state === "checking";
  const stateLabels = { checking: "正在检查", current: "已是最新版本", available: "发现新版本", "migration-required": "需要迁移版本编号", ahead: "运行版本高于发布版本", error: "检查失败" };
  const tone = state === "error" ? "danger" : state === "migration-required" ? "warning" : state === "current" ? "success" : "info";
  const ready = Boolean(status?.releaseReady && !issue && status?.latestVersion);
  const guide = ready ? buildUpdateGuide(status!.latestVersion, mode) : "";
  const releasesError = releasesQuery.error?.message || releasesQuery.data?.error;

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><h1>系统更新</h1><p>正式发布、版本检测与升级指引。此页面不执行服务器升级。</p></div>
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
    <OpsSurface as="section" title="发布说明" subtitle="修复内容与升级注意事项来自正式 Release" padding="md">
      {status?.releaseNotes ? <ReleaseNotes>{status.releaseNotes}</ReleaseNotes> : <p className={styles.meta}>{checking ? "正在读取发布信息…" : "暂无发布说明，请在 GitHub 查看该版本记录。"}</p>}
      <div className={styles.downloads}>
        <Button type="primary" icon={<CloudDownloadOutlined />} href={ready ? status?.downloadUrl ?? undefined : undefined} disabled={!ready || !status?.downloadUrl}>下载 Linux x64 发布包</Button>
        <Button href={ready ? status?.checksumUrl ?? undefined : undefined} disabled={!ready || !status?.checksumUrl}>SHA256 校验文件</Button>
        {status?.latestReleaseUrl && <Button type="link" icon={<LinkOutlined />} href={status.latestReleaseUrl} target="_blank" rel="noopener noreferrer">GitHub Release</Button>}
      </div>
      <p className={styles.meta}>原生包：Ubuntu 24.04 x64 · Node.js 22+。容器镜像：Linux amd64。下载后先校验，再部署。</p>
    </OpsSurface>
    <Collapse items={[{ key: "guide", label: "手动升级指引", children: <div className={styles.guide}>
      <Segmented aria-label="部署方式" value={mode} onChange={(value) => setMode(value as typeof mode)} options={[{ value: "compose", label: "Docker Compose" }, { value: "systemd", label: "Binary / systemd" }]} />
      <p>在维护窗口执行。先备份数据库和配置，确认备份可恢复；保留原 AI 加密密钥。命令仅供复制，网页不会执行。</p>
      {guide ? <div className={styles.code}><div className={styles.codeHeader}><span>备份 → 升级 → 健康检查</span><Typography.Text copyable={{ text: guide }}>复制命令</Typography.Text></div><pre>{guide}</pre></div> : <Alert type="info" title="检测到完整正式 Release 后才生成升级命令" showIcon />}
      <div className={styles.recovery}><h3>失败时如何恢复</h3><p>{mode === "compose" ? "先查看容器日志，确认旧镜像仍可用、旧程序兼容当前数据库，再执行下面的回滚命令。数据库恢复需单独安排，不执行 down -v。" : "switch 在重启或健康检查失败时会尝试恢复旧版本指针；若仍异常，保留现场并检查 journalctl。确认数据库兼容后，按备份中的旧版本执行回滚。current 为实体目录的旧安装必须先按部署文档迁移，不能直接覆盖。"}</p>
        <pre>{["# 请先设置 PREVIOUS_TAG 为备份对应的旧版本", mode === "compose" ? "test -n \"$PREVIOUS_TAG\" && bash scripts/compose-release.sh rollback \"$PREVIOUS_TAG\" --env-file deploy/docker/.env" : "test -n \"$PREVIOUS_TAG\" && sudo bash /opt/kubenova/current/scripts/prod.sh rollback \"$PREVIOUS_TAG\""].join(String.fromCharCode(10))}</pre>
        <p>应用回滚不等于数据库回滚。健康接口通过后，还需登录验证集群、资源详情、授权、日志与终端。</p>
      </div>
    </div> }]} />
    <OpsSurface as="section" title="正式发布记录" subtitle="最近 10 个稳定 Release；发布记录不代表本机已经安装" padding="md">
      {releasesQuery.isPending ? <Skeleton active paragraph={{ rows: 3 }} /> : releasesError ? <Alert type="warning" showIcon title="发布记录读取失败" description={releasesError} action={<Button size="small" onClick={() => void releasesQuery.refetch()}>重试</Button>} /> : releasesQuery.data?.items.length ?
        <ul className={styles.releases}>{releasesQuery.data.items.map((release) => <li key={release.tag}>
          <div><a href={release.url} target="_blank" rel="noopener noreferrer">{release.name || release.tag} <LinkOutlined /></a><span className={styles.meta}>{release.publishedAt ? dateLabel(release.publishedAt) : "发布时间未提供"}</span></div>
          <OpsStatusTag tone={release.releaseReady ? "neutral" : "warning"}>{release.releaseReady ? "产物完整" : "产物不完整"}</OpsStatusTag>
        </li>)}</ul> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无正式 Release；仅推送 tag 不会产生可安装版本" />}
    </OpsSurface>
  </div>;
}
