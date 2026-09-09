"use client";

import {
  AppstoreOutlined,
  BellOutlined,
  HomeOutlined,
  MenuOutlined,
  MoonFilled,
  NodeIndexOutlined,
  ReloadOutlined,
  SearchOutlined,
  SafetyOutlined,
  SunFilled,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { App, Avatar, Badge, Breadcrumb, Button, Dropdown, Input, Layout, Menu, Popover, Skeleton, Space } from "antd";
import type { MenuProps } from "antd";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { useAuth } from "@/components/auth-context";
import { getTitleFromPath } from "@/config/navigation";
import { useThemeMode } from "@/components/theme-context";
import { getClusters } from "@/lib/api/clusters";
import { listCapabilities } from "@/lib/api/capabilities";
import { getClusterDisplayName, rememberClusterDisplayNames } from "@/lib/cluster-display-name";
import { getSystemUpdateStatus, type SystemUpdateStatusPayload } from "@/lib/api/system-update";
import { buildLoginRoute, buildInternalReturnTo } from "@/lib/login-return";
import { RESOURCE_SCOPE_CHANGE_EVENT, type ResourceScopeChangeDetail } from "@/lib/resource-scope-events";
import { BootstrapScreen } from "@/components/bootstrap-screen";
import { OpsIconActionButton } from "@/components/ops";
import { QUERY_CACHE_TIMINGS, queryKeys } from "@/lib/query";

const { Header, Sider, Content } = Layout;
const MAX_REMEMBERED_PREFETCH_PATHS = 48;
const ROUTE_TRANSITION_QUIET_MS = 650;
const ENABLE_ROUTE_PREFETCH = process.env.NODE_ENV === "production";
const UPDATE_NOTICE_VERSION_KEY = "kubenova.system-update.notice-version";

type PlatformNavigationItem = {
  key: "platform-overview" | "platform-clusters" | "platform-access" | "platform-applications";
  label: string;
  path: string;
  icon: React.ReactNode;
  requiredRole?: "admin";
};

const PLATFORM_NAVIGATION: readonly PlatformNavigationItem[] = [
  { key: "platform-overview", label: "概览", path: "/", icon: <HomeOutlined /> },
  { key: "platform-clusters", label: "集群", path: "/clusters", icon: <NodeIndexOutlined /> },
  { key: "platform-access", label: "授权管理", path: "/users", icon: <SafetyOutlined />, requiredRole: "admin" },
  // 应用中心将随着集群工作台路由迁移；过渡期先落到已有的应用发布入口。
  { key: "platform-applications", label: "应用中心", path: "/workloads/deployments", icon: <AppstoreOutlined /> },
];

const PREFETCHABLE_NAV_PATHS = new Set(PLATFORM_NAVIGATION.map((item) => item.path));

function logNavigationMetric(name: string, detail: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") return;
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent("kubenova:navigation-metric", {
        detail: { name, ...detail },
      }),
    );
  }, 0);
}

function matchesPath(pathname: string, candidate: string) {
  return pathname === candidate || pathname.startsWith(`${candidate}/`);
}

function getVisiblePlatformNavigation(userRole: string, disabledPaths?: Set<string> | null) {
  const normalizedRole = userRole.trim().toLowerCase();
  const canManagePlatform = normalizedRole === "admin" || normalizedRole === "platform-admin";
  return PLATFORM_NAVIGATION.filter(
    (item) => (!item.requiredRole || canManagePlatform) && !disabledPaths?.has(item.path),
  );
}

function scheduleIdleTask(task: () => void, timeout = 900) {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (idleWindow.requestIdleCallback) {
    const id = idleWindow.requestIdleCallback(task, { timeout });
    return () => idleWindow.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(task, Math.min(timeout, 250));
  return () => window.clearTimeout(id);
}

function markRouteTransitionQuietWindow() {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const routeWindow = window as Window & {
    __KUBENOVA_ROUTE_TRANSITION_MARKER_ID?: number;
    __KUBENOVA_ROUTE_TRANSITION_UNTIL?: number;
  };
  const markerId = (routeWindow.__KUBENOVA_ROUTE_TRANSITION_MARKER_ID ?? 0) + 1;
  routeWindow.__KUBENOVA_ROUTE_TRANSITION_MARKER_ID = markerId;
  routeWindow.__KUBENOVA_ROUTE_TRANSITION_UNTIL = performance.now() + ROUTE_TRANSITION_QUIET_MS;
  document.documentElement.dataset.routeTransitionQuiet = "true";
  document.body.dataset.routeTransitionQuiet = "true";
  document.body.classList.add("kubenova-route-transitioning");

  const clearQuietMarker = (force = false) => {
    if (routeWindow.__KUBENOVA_ROUTE_TRANSITION_MARKER_ID !== markerId) {
      return;
    }
    if (!force && (routeWindow.__KUBENOVA_ROUTE_TRANSITION_UNTIL ?? 0) > performance.now()) {
      return;
    }
    routeWindow.__KUBENOVA_ROUTE_TRANSITION_UNTIL = 0;
    document.body.classList.remove("kubenova-route-transitioning");
    delete document.documentElement.dataset.routeTransitionQuiet;
    delete document.body.dataset.routeTransitionQuiet;
  };

  const timer = window.setTimeout(() => {
    clearQuietMarker();
  }, ROUTE_TRANSITION_QUIET_MS + 50);
  return () => {
    window.clearTimeout(timer);
    clearQuietMarker(true);
  };
}

function rememberPrefetchedPath(paths: Set<string>, path: string) {
  paths.add(path);
  while (paths.size > MAX_REMEMBERED_PREFETCH_PATHS) {
    const oldest = paths.values().next().value;
    if (!oldest) break;
    paths.delete(oldest);
  }
}

function shouldHideIssueLauncher(node: HTMLElement) {
  const text = (node.innerText || node.textContent || "").trim().toLowerCase();
  if (!text || !/issues?/.test(text)) {
    return false;
  }
  const style = window.getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  const fixedLike = style.position === "fixed" || style.position === "sticky";
  const nearBottomLeft = rect.left < 160 && window.innerHeight - rect.bottom < 160;
  return fixedLike && nearBottomLeft;
}

function hideIssueLaunchers(root: ParentNode = document) {
  if (typeof window === "undefined") {
    return;
  }
  const elements =
    root instanceof HTMLElement
      ? [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]
      : Array.from(root.querySelectorAll<HTMLElement>("body *"));
  elements.forEach((element) => {
    if (!shouldHideIssueLauncher(element)) {
      return;
    }
    element.style.display = "none";
    element.style.visibility = "hidden";
    element.style.pointerEvents = "none";
  });
}

// 把 Sider/Menu 提取为独立组件，React.memo 保证 pathname 以外的父级 state 变化时不重渲染
const AppSider = memo(function AppSider({
  pathname,
  mode,
  userRole,
  disabledPaths,
}: {
  pathname: string;
  mode: string;
  userRole: string;
  disabledPaths?: Set<string> | null;
}) {
  const visibleNavigation = useMemo(
    () => getVisiblePlatformNavigation(userRole, disabledPaths),
    [disabledPaths, userRole],
  );
  const prefetchedPathsRef = useRef(new Set<string>());
  const pendingPrefetchPathsRef = useRef(new Set<string>());
  const router = useRouter();
  const prefetchPath = useCallback((path: string, timeout = 700) => {
    if (
      !ENABLE_ROUTE_PREFETCH ||
      !PREFETCHABLE_NAV_PATHS.has(path) ||
      prefetchedPathsRef.current.has(path) ||
      pendingPrefetchPathsRef.current.has(path)
    ) {
      return;
    }
    pendingPrefetchPathsRef.current.add(path);
    scheduleIdleTask(() => {
      pendingPrefetchPathsRef.current.delete(path);
      try {
        router.prefetch(path);
        rememberPrefetchedPath(prefetchedPathsRef.current, path);
      } catch {
        prefetchedPathsRef.current.delete(path);
      }
    }, timeout);
  }, [router]);

  // 平台入口只保留一级直达项；资源域导航由后续的集群工作台提供。
  const items: MenuProps["items"] = useMemo(
    () =>
      visibleNavigation.map((item) => ({
          key: item.path,
          className: `app-sidebar-menu__section app-sidebar-menu__section--${item.key}`,
          icon: item.icon,
          label: (
            <Link
              className="app-sidebar-menu__link app-sidebar-menu__link--section"
              href={item.path}
              prefetch={false}
              onMouseEnter={() => prefetchPath(item.path, 250)}
              onFocus={() => prefetchPath(item.path, 250)}
            >
              <span className="app-sidebar-menu__label">{item.label}</span>
            </Link>
          ),
        })),
    [prefetchPath, visibleNavigation],
  );

  return (
    <Sider
      width={280}
      className="app-sidebar"
      data-shell-region="sidebar"
      theme={mode as "dark" | "light"}
      style={{ borderRight: "1px solid var(--kn-border)" }}
    >
      <div
        className="logo-wrap kn-halo-focus"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "18px 16px 14px",
          borderBottom: "1px solid var(--kn-border)",
        }}
      >
        <div style={{ flexShrink: 0 }}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <path
              d="M16 2L28 9V23L16 30L4 23V9L16 2Z"
              fill="url(#grad1)"
              stroke="var(--kn-primary)"
              strokeWidth="1.5"
            />
            <circle cx="16" cy="16" r="5" fill="none" stroke="var(--kn-accent)" strokeWidth="1.5" />
            <line x1="16" y1="8" x2="16" y2="11" stroke="var(--kn-accent)" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="16" y1="21" x2="16" y2="24" stroke="var(--kn-accent)" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="8" y1="16" x2="11" y2="16" stroke="var(--kn-accent)" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="21" y1="16" x2="24" y2="16" stroke="var(--kn-accent)" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="10.3" y1="10.3" x2="12.5" y2="12.5" stroke="var(--kn-accent)" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="19.5" y1="19.5" x2="21.7" y2="21.7" stroke="var(--kn-accent)" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="21.7" y1="10.3" x2="19.5" y2="12.5" stroke="var(--kn-accent)" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="12.5" y1="19.5" x2="10.3" y2="21.7" stroke="var(--kn-accent)" strokeWidth="1.5" strokeLinecap="round" />
            <defs>
              <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--kn-surface-raised)" stopOpacity="0.9" />
                <stop offset="100%" stopColor="var(--kn-sider)" stopOpacity="0.9" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div>
          <div
            className="logo-wordmark"
            style={{
              fontWeight: 800,
              fontSize: 17,
              color: "var(--kn-primary)",
              letterSpacing: "0.08em",
              lineHeight: 1.2,
            }}
          >
            KubeNova
          </div>
          <div className="logo-caption" style={{ fontSize: 11, color: "var(--kn-text-muted)", letterSpacing: "0.12em" }}>
            CLOUD NATIVE OPS
          </div>
        </div>
      </div>
      <Menu
        className="app-sidebar-menu"
        mode="inline"
        theme={mode as "dark" | "light"}
        selectedKeys={visibleNavigation.filter((item) => matchesPath(pathname, item.path)).map((item) => item.path)}
        items={items}
        onClick={({ key }) => {
          markRouteTransitionQuietWindow();
          logNavigationMetric("sidebar-click", { key, pathname });
        }}
        style={{
          borderInlineEnd: "none",
        }}
      />
    </Sider>
  );
});

function LoadingSkeleton() {
  return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 24 }} />;
}

export function ShellLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { mode, toggleTheme } = useThemeMode();
  const { accessToken, isAuthenticated, isInitializing, username, role, logout } = useAuth();
  const { notification } = App.useApp();
  const [notificationOpen, setNotificationOpen] = useState(false);
  const isLoginPage = pathname === "/login";
  const isTopologyRoute = pathname === "/network/topology";
  const currentTitle = getTitleFromPath(pathname);
  const capabilitiesQuery = useQuery({
    queryKey: queryKeys.capabilities.list(accessToken),
    queryFn: () => listCapabilities(accessToken),
    enabled: !isLoginPage && !isInitializing && isAuthenticated && Boolean(accessToken),
    staleTime: QUERY_CACHE_TIMINGS.shellCapabilityStaleTimeMs,
    gcTime: QUERY_CACHE_TIMINGS.shellCapabilityGcTimeMs,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnMount: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
  });
  const shellClustersQuery = useQuery({
    queryKey: queryKeys.clusters.list({ scope: "shell" }),
    queryFn: () => getClusters({ page: 1, pageSize: 500 }, accessToken),
    enabled: !isLoginPage && !isInitializing && isAuthenticated && Boolean(accessToken),
    staleTime: QUERY_CACHE_TIMINGS.shellCapabilityStaleTimeMs,
    gcTime: QUERY_CACHE_TIMINGS.shellCapabilityGcTimeMs,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnMount: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
  });
  const updateStatusQuery = useQuery<SystemUpdateStatusPayload>({
    queryKey: ["system-update", "shell-status", accessToken],
    queryFn: () => getSystemUpdateStatus(accessToken ?? undefined),
    enabled: !isLoginPage && !isInitializing && isAuthenticated && Boolean(accessToken) && ["admin", "platform-admin"].includes(role.toLowerCase()),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const updateStatus = updateStatusQuery.data;
  const updateAvailable = Boolean(updateStatus?.updateAvailable);

  useEffect(() => {
    const version = updateStatus?.latestVersion?.trim();
    if (!updateAvailable || !version || typeof window === "undefined") return;
    const previousNoticeVersion = window.localStorage.getItem(UPDATE_NOTICE_VERSION_KEY);
    if (previousNoticeVersion === version) return;
    window.localStorage.setItem(UPDATE_NOTICE_VERSION_KEY, version);
    notification.info({
      key: `system-update-${version}`,
      message: `发现新版本 ${version}`,
      description: "KubeNova 已检测到可用更新，进入更新管理即可查看并一键升级。",
      placement: "topRight",
      duration: 8,
      btn: (
        <Button type="link" size="small" onClick={() => {
          notification.destroy(`system-update-${version}`);
          router.push("/system/update");
        }}>
          查看更新
        </Button>
      ),
    });
  }, [notification, notificationOpen, router, updateAvailable, updateStatus?.latestVersion]);
  const userItems: MenuProps["items"] = [
    { key: "profile", label: "个人中心" },
    { key: "logout", label: "退出登录" },
  ];

  const disabledPaths = useMemo(() => {
    if (!isAuthenticated || !accessToken) {
      return null;
    }
    if (!capabilitiesQuery.data) {
      return null;
    }
    return new Set(
      capabilitiesQuery.data
        .filter((item) => !item.enabled)
        .map((item) => item.route)
        .filter(Boolean),
    );
  }, [accessToken, capabilitiesQuery.data, isAuthenticated]);
  const mobileNavItems = useMemo<MenuProps["items"]>(() => {
    return getVisiblePlatformNavigation(role, disabledPaths).map((item) => ({
      key: item.path,
      icon: item.icon,
      label: item.label,
    }));
  }, [disabledPaths, role]);
  const shellClusterMap = useMemo(
    () => {
      const items = shellClustersQuery.data?.items ?? [];
      rememberClusterDisplayNames(items);
      return Object.fromEntries(items.map((item) => [item.id, item.name]));
    },
    [shellClustersQuery.data?.items],
  );
  const [resourceScopeOverride, setResourceScopeOverride] = useState<
    (ResourceScopeChangeDetail & { pathname: string }) | null
  >(null);
  useEffect(() => {
    const handleResourceScopeChange = (event: Event) => {
      const detail = (event as CustomEvent<ResourceScopeChangeDetail>).detail;
      if (!detail || typeof detail.clusterId !== "string") {
        return;
      }
      setResourceScopeOverride({
        clusterId: detail.clusterId,
        clusterName: detail.clusterName,
        namespace: detail.namespace,
        pathname,
      });
    };
    window.addEventListener(RESOURCE_SCOPE_CHANGE_EVENT, handleResourceScopeChange);
    return () => window.removeEventListener(RESOURCE_SCOPE_CHANGE_EVENT, handleResourceScopeChange);
  }, [pathname]);
  const shellScope = useMemo(() => {
    const activeOverride = resourceScopeOverride?.pathname === pathname ? resourceScopeOverride : null;
    const clusterId = searchParams.get("clusterId")?.trim() || activeOverride?.clusterId?.trim() || "";
    const clusterName = searchParams.get("clusterName")?.trim() || activeOverride?.clusterName?.trim() || "";
    const namespace = searchParams.get("namespace")?.trim() || activeOverride?.namespace?.trim() || "";
    return {
      cluster: clusterId || clusterName ? getClusterDisplayName(shellClusterMap, clusterId, clusterName) : "全部集群",
      namespace: namespace || "全部名称空间",
    };
  }, [pathname, resourceScopeOverride, searchParams, shellClusterMap]);
  const capabilityStats = useMemo(() => {
    const items = capabilitiesQuery.data ?? [];
    const enabled = items.filter((item) => item.enabled).length;
    const disabled = items.length - enabled;
    return { enabled, disabled, total: items.length };
  }, [capabilitiesQuery.data]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") {
      return;
    }
    const controller = new AbortController();
    void fetch("/__nextjs_disable_dev_indicator", {
      method: "POST",
      signal: controller.signal,
    }).catch(() => {
      // Ignore dev overlay disable failures.
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") {
      return;
    }
    let frame = 0;
    const scheduleHide = (root?: ParentNode) => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        hideIssueLaunchers(root);
      });
    };
    scheduleHide();
    const observer = new MutationObserver(() => {
      scheduleHide();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: false,
    });
    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ name?: string; detail?: Record<string, unknown> }>;
      if (!customEvent.detail?.name) return;
      void customEvent.detail;
    };
    window.addEventListener("kubenova:navigation-metric", handler);
    return () => window.removeEventListener("kubenova:navigation-metric", handler);
  }, []);

  useEffect(() => {
    if (isLoginPage) {
      return undefined;
    }
    return markRouteTransitionQuietWindow();
  }, [isLoginPage, pathname]);

  useEffect(() => {
    if (isLoginPage || isInitializing || isAuthenticated) {
      return;
    }
    const currentSearch = typeof window === "undefined" ? "" : window.location.search;
    const currentReturnTo = buildInternalReturnTo(pathname, currentSearch);
    window.location.replace(buildLoginRoute(currentReturnTo));
  }, [isAuthenticated, isInitializing, isLoginPage, pathname]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (isInitializing) {
    return <BootstrapScreen description="正在校验登录态并恢复工作区..." />;
  }

  if (!isAuthenticated) {
    return <BootstrapScreen description="正在跳转到登录页..." />;
  }

  return (
    <>
      <a className="shell-skip-link" href="#kubenova-main-content">
        跳到主内容
      </a>
      <Layout className="kubenova-shell" style={{ minHeight: "100dvh" }}>
        {/* AppSider 用 memo 隔离，pathname 变化时只有 selectedKeys/openKeys 更新，父级其余 state 不会触发它重渲染 */}
        <AppSider pathname={pathname} mode={mode} userRole={role} disabledPaths={disabledPaths} />
        <Layout>
        <Header
          className="app-header"
          data-shell-region="topbar"
        >
          <Dropdown
            menu={{
              items: mobileNavItems,
              selectedKeys: [pathname],
              onClick: ({ key }) => {
                if (typeof key !== "string" || !key.startsWith("/")) return;
                markRouteTransitionQuietWindow();
                router.push(key);
              },
            }}
            classNames={{ root: "shell-mobile-nav-dropdown" }}
            trigger={["click"]}
          >
            <OpsIconActionButton
              aria-label="打开移动端导航"
              className="shell-mobile-nav-trigger"
              icon={<MenuOutlined />}
            />
          </Dropdown>
          <Breadcrumb
            items={[
              {
                title: (
                  <span
                    style={{
                      color: "var(--kn-text-muted)",
                      fontSize: 13,
                    }}
                  >
                    控制台
                  </span>
                ),
              },
              {
                title: (
                  <span
                    style={{
                      color: "var(--kn-text)",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    {currentTitle}
                  </span>
                ),
              },
            ]}
          />
          <div className="shell-status-band" aria-label="当前工作区状态">
            {!isTopologyRoute ? (
              <>
                <span className="shell-status-chip shell-status-chip--scope">
                  <span>集群</span>
                  <strong>{shellScope.cluster}</strong>
                </span>
                <span className="shell-status-chip shell-status-chip--scope">
                  <span>命名空间</span>
                  <strong>{shellScope.namespace}</strong>
                </span>
              </>
            ) : null}
            <span className="shell-status-chip shell-status-chip--success">
              <i aria-hidden="true" />
              <span>能力</span>
              <strong>{capabilityStats.total ? `${capabilityStats.enabled}/${capabilityStats.total}` : "同步中"}</strong>
            </span>
            <span className="shell-status-chip shell-status-chip--warning">
              <span>告警</span>
              <strong>{capabilityStats.disabled}</strong>
            </span>
            <span className="shell-status-chip shell-status-chip--neutral">
              <span>角色</span>
              <strong>{role || "user"}</strong>
            </span>
          </div>
          {!isTopologyRoute ? (
            <div className="shell-mobile-scope" aria-label="当前移动端工作区范围">
              <span>{shellScope.cluster}</span>
              <strong>{shellScope.namespace}</strong>
            </div>
          ) : null}
          <Space size={12} className="shell-topbar-actions">
            <Input
              id="shell-global-search"
              name="shell-global-search"
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索资源、日志或告警"
              style={{ width: 340 }}
            />
            <Popover
              content={
                <div className="shell-mobile-search-panel">
                  <Input
                    id="shell-mobile-global-search"
                    name="shell-mobile-global-search"
                    allowClear
                    prefix={<SearchOutlined />}
                    placeholder="搜索资源、日志或告警"
                  />
                </div>
              }
              overlayClassName="shell-mobile-search-popover"
              placement="bottomRight"
              trigger="click"
            >
              <OpsIconActionButton
                aria-label="打开移动端搜索"
                className="shell-mobile-search-trigger"
                icon={<SearchOutlined />}
              />
            </Popover>
            <Popover
              open={notificationOpen}
              onOpenChange={setNotificationOpen}
              trigger="click"
              placement="bottomRight"
              overlayClassName="shell-notification-popover"
              content={(
                <div className="shell-notification-center" role="status" aria-live="polite">
                  <div className="shell-notification-center__header">
                    <strong>通知中心</strong>
                    {updateAvailable ? <Badge count={1} size="small" /> : null}
                  </div>
                  {updateAvailable && updateStatus ? (
                    <div className="shell-notification-center__item">
                      <div className="shell-notification-center__item-title">
                        <Badge status="processing" />
                        <strong>系统更新可用</strong>
                      </div>
                      <span>最新版本 {updateStatus.latestVersion}，当前运行 {updateStatus.runningVersion}</span>
                      <Link href="/system/update" onClick={() => setNotificationOpen(false)}>
                        查看并升级
                      </Link>
                    </div>
                  ) : (
                    <div className="shell-notification-center__empty">暂无新通知</div>
                  )}
                </div>
              )}
            >
              <Badge dot={updateAvailable} offset={[-3, 3]}>
                <OpsIconActionButton className="shell-topbar-action" icon={<BellOutlined />} aria-label="打开通知中心">
                  通知中心
                </OpsIconActionButton>
              </Badge>
            </Popover>
            <OpsIconActionButton className="shell-topbar-action" icon={<ReloadOutlined />} onClick={() => window.location.reload()}>
              刷新
            </OpsIconActionButton>
            <OpsIconActionButton
              className={`shell-theme-toggle shell-theme-toggle--${mode}`}
              onClick={toggleTheme}
              aria-pressed={mode === "dark"}
              aria-label={`切换到${mode === "dark" ? "浅色" : "深色"}主题`}
              data-mode={mode}
            >
              <span className={`shell-theme-segment ${mode === "light" ? "is-active" : ""}`}>
                <SunFilled />
                浅色
              </span>
              <span className={`shell-theme-segment ${mode === "dark" ? "is-active" : ""}`}>
                <MoonFilled />
                深色
              </span>
            </OpsIconActionButton>
            <Dropdown
              menu={{
                items: userItems,
                onClick: async ({ key }) => {
                  if (key === "logout") {
                    await logout();
                    window.location.replace("/login");
                  }
                },
              }}
              trigger={["click"]}
            >
              <Avatar style={{ cursor: "pointer", background: "var(--kn-primary)", color: "var(--ops-on-primary)" }}>
                {(username || "管").slice(0, 1).toUpperCase()}
              </Avatar>
            </Dropdown>
          </Space>
        </Header>
        {/* Suspense 边界：路由切换时保持旧内容可见直到新页面就绪，同时提供骨架屏兜底 */}
        <Content id="kubenova-main-content" className="app-content" tabIndex={-1}>
          <Suspense fallback={<LoadingSkeleton />}>{children}</Suspense>
        </Content>
      </Layout>
      </Layout>
    </>
  );
}
