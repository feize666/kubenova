"use client";

import {
  ArrowLeftOutlined,
  BellOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  FileTextOutlined,
  HomeOutlined,
  MenuOutlined,
  NodeIndexOutlined,
  ReloadOutlined,
  SettingOutlined,
  ShareAltOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Avatar, Breadcrumb, Dropdown, Layout, Menu, Space, Typography } from "antd";
import type { MenuProps } from "antd";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useAuth } from "@/components/auth-context";
import { BootstrapScreen } from "@/components/bootstrap-screen";
import { ClusterWorkspaceProvider } from "@/components/cluster-workspace-context";
import { OpsIconActionButton } from "@/components/ops";
import { getClusterDetail } from "@/lib/api/clusters";
import { getClusterIdFromPathname, getClusterWorkspaceNavigation } from "@/lib/cluster-workspace";
import { queryKeys, QUERY_CACHE_TIMINGS } from "@/lib/query";
import { buildInternalReturnTo, buildLoginRoute } from "@/lib/login-return";

const { Header, Sider, Content } = Layout;

const sectionIcons: Record<string, React.ReactNode> = {
  overview: <HomeOutlined />,
  "base-resources": <CloudServerOutlined />,
  workloads: <DeploymentUnitOutlined />,
  network: <ShareAltOutlined />,
  storage: <DatabaseOutlined />,
  configs: <FileTextOutlined />,
  operations: <ToolOutlined />,
};

export function ClusterWorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { accessToken, isAuthenticated, isInitializing, username, logout } = useAuth();
  const clusterId = getClusterIdFromPathname(pathname);
  const clusterQuery = useQuery({
    queryKey: [...queryKeys.clusters.detail(clusterId ?? ""), accessToken],
    queryFn: () => getClusterDetail(clusterId!, accessToken || undefined),
    enabled: Boolean(accessToken && clusterId),
    staleTime: QUERY_CACHE_TIMINGS.listStaleTimeMs,
    gcTime: QUERY_CACHE_TIMINGS.listGcTimeMs,
    retry: 1,
  });
  const navigation = useMemo(
    () => (clusterId ? getClusterWorkspaceNavigation(clusterId) : []),
    [clusterId],
  );
  const menuItems = useMemo<MenuProps["items"]>(
    () => navigation.map((section) => ({
      key: section.key,
      icon: sectionIcons[section.key] ?? <SettingOutlined />,
      label: section.items.length === 1 ? (
        <Link href={section.items[0].href} className="app-sidebar-menu__link app-sidebar-menu__link--section">
          {section.label}
        </Link>
      ) : section.label,
      children: section.items.length > 1 ? section.items.map((item) => ({
        key: item.href,
        label: <Link href={item.href} className="app-sidebar-menu__link app-sidebar-menu__link--nested">{item.label}</Link>,
      })) : undefined,
    })),
    [navigation],
  );
  const selectedKeys = useMemo(
    () => navigation.flatMap((section) => section.items.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)).map((item) => item.href)),
    [navigation, pathname],
  );
  const openKeys = useMemo(
    () => navigation.filter((section) => section.items.length > 1 && section.items.some((item) => selectedKeys.includes(item.href))).map((section) => section.key),
    [navigation, selectedKeys],
  );
  const mobileItems = useMemo<MenuProps["items"]>(() => navigation.map((section) => ({
    key: section.items[0]?.href ?? section.key,
    icon: sectionIcons[section.key] ?? <SettingOutlined />,
    label: section.label,
  })), [navigation]);

  useEffect(() => {
    if (isInitializing || isAuthenticated) return;
    const search = typeof window === "undefined" ? "" : window.location.search;
    window.location.replace(buildLoginRoute(buildInternalReturnTo(pathname, search)));
  }, [isAuthenticated, isInitializing, pathname]);

  if (isInitializing) return <BootstrapScreen description="正在恢复集群工作区..." />;
  if (!isAuthenticated) return <BootstrapScreen description="正在跳转到登录页..." />;
  if (!clusterId) return <BootstrapScreen description="集群地址无效，正在返回集群列表..." />;

  const cluster = clusterQuery.data;
  const clusterName = cluster?.displayName || cluster?.name || `集群 ${clusterId.slice(0, 8)}`;
  const statusLabel = cluster?.runtimeStatus === "running" ? "运行中" : cluster?.runtimeStatus === "checking" ? "探测中" : cluster ? "离线" : "加载中";
  const statusTone = cluster?.runtimeStatus === "running" ? "workspace-status--ok" : cluster?.runtimeStatus === "checking" ? "workspace-status--checking" : "workspace-status--offline";
  const currentTitle = navigation.flatMap((section) => section.items).find((item) => selectedKeys.includes(item.href))?.label ?? "集群信息";

  return (
    <ClusterWorkspaceProvider clusterId={clusterId}>
      <Layout className="kubenova-shell cluster-workspace-shell" style={{ minHeight: "100dvh" }}>
        <Sider width={248} className="app-sidebar cluster-workspace-shell__sidebar" theme="light">
          <div className="cluster-workspace-brand">
            <Link href="/clusters" className="cluster-workspace-brand__back" aria-label="返回集群列表">
              <ArrowLeftOutlined />
              <span>返回集群列表</span>
            </Link>
            <div className="cluster-workspace-brand__identity">
              <NodeIndexOutlined />
              <div>
                <strong>{clusterName}</strong>
                <span>单集群工作区</span>
              </div>
            </div>
          </div>
          <Menu className="app-sidebar-menu cluster-workspace-menu" mode="inline" items={menuItems} selectedKeys={selectedKeys} defaultOpenKeys={openKeys} />
        </Sider>
        <Layout>
          <Header className="app-header cluster-workspace-shell__header">
            <Dropdown menu={{ items: mobileItems, onClick: ({ key }) => { if (typeof key === "string" && key.startsWith("/")) router.push(key); } }} trigger={["click"]}>
              <OpsIconActionButton aria-label="打开集群工作区导航" className="shell-mobile-nav-trigger" icon={<MenuOutlined />} />
            </Dropdown>
            <Breadcrumb items={[{ title: <Link href="/clusters">集群</Link> }, { title: clusterName }, { title: currentTitle }]} />
            <div className="cluster-workspace-header__context" aria-label="当前集群上下文">
              <span className={`workspace-status ${statusTone}`}><i aria-hidden="true" />{statusLabel}</span>
              <Typography.Text className="cluster-workspace-header__id">{clusterId}</Typography.Text>
            </div>
            <Space size={10} className="shell-topbar-actions">
              <OpsIconActionButton className="shell-topbar-action" icon={<BellOutlined />} aria-label="打开通知中心" />
              <OpsIconActionButton className="shell-topbar-action" icon={<ReloadOutlined />} aria-label="刷新页面" onClick={() => window.location.reload()} />
              <Dropdown menu={{ items: [{ key: "logout", label: "退出登录" }], onClick: async ({ key }) => { if (key === "logout") { await logout(); window.location.replace("/login"); } } }} trigger={["click"]}>
                <Avatar style={{ cursor: "pointer", background: "var(--kn-primary)", color: "var(--ops-on-primary)" }}>{(username || "管").slice(0, 1).toUpperCase()}</Avatar>
              </Dropdown>
            </Space>
          </Header>
          <Content id="kubenova-main-content" className="app-content cluster-workspace-shell__content" tabIndex={-1}>
            {children}
          </Content>
        </Layout>
      </Layout>
    </ClusterWorkspaceProvider>
  );
}
