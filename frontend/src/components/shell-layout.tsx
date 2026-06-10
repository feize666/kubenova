"use client";

import {
  ApartmentOutlined,
  AppstoreOutlined,
  BellOutlined,
  BranchesOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  HddOutlined,
  HomeOutlined,
  MenuOutlined,
  SafetyOutlined,
  MonitorOutlined,
  MoonFilled,
  NodeIndexOutlined,
  PartitionOutlined,
  RadarChartOutlined,
  ReloadOutlined,
  SearchOutlined,
  SunFilled,
  ToolOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Avatar, Breadcrumb, Dropdown, Input, Layout, Menu, Popover, Skeleton, Space } from "antd";
import type { MenuProps } from "antd";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { useAuth } from "@/components/auth-context";
import { getNavDisplayLabel, getTitleFromPath, filterNavSectionsByRole, navSections } from "@/config/navigation";
import { useThemeMode } from "@/components/theme-context";
import { listCapabilities } from "@/lib/api/capabilities";
import { buildLoginRoute, buildInternalReturnTo } from "@/lib/login-return";
import { BootstrapScreen } from "@/components/bootstrap-screen";
import { OpsIconActionButton } from "@/components/ops";
import { QUERY_CACHE_TIMINGS, queryKeys } from "@/lib/query";

const { Header, Sider, Content } = Layout;
const SIDEBAR_OPEN_SECTION_KEY = "kubenova.nav.sidebar.openSection.v2";
const SIDEBAR_SECTION_ORDER = [
  "section-overview",
  "section-resource-panorama",
  "section-cluster-domain",
  "section-workloads",
  "section-network",
  "section-storage-config",
  "section-configs",
  "section-app-delivery",
  "section-observability",
  "section-intelligence",
  "section-iam-security",
  "section-system-management",
] as const;
const PREFETCHABLE_NAV_PATHS = new Set(navSections.flatMap((section) => [section.path, ...section.items.map((item) => item.path)].filter(Boolean) as string[]));
const MAX_REMEMBERED_PREFETCH_PATHS = 48;
const MAX_IDLE_PREFETCH_PATHS = 5;
const MAX_OPEN_SIDEBAR_SECTIONS = 1;
const ROUTE_TRANSITION_QUIET_MS = 650;

type SidebarOpenSectionKey = string | null;

type StoredSidebarOpenState = {
  openSectionKey: SidebarOpenSectionKey;
  openSectionKeys?: string[];
  updatedAt?: number;
};

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

const sectionIconMap: Record<string, React.ReactNode> = {
  "section-overview": <HomeOutlined />,
  "section-resource-panorama": <AppstoreOutlined />,
  "section-cluster-domain": <NodeIndexOutlined />,
  "section-workloads": <DeploymentUnitOutlined />,
  "section-network": <ApartmentOutlined />,
  "section-storage-config": <HddOutlined />,
  "section-configs": <DatabaseOutlined />,
  "section-app-delivery": <BranchesOutlined />,
  "section-observability": <MonitorOutlined />,
  "section-intelligence": <RadarChartOutlined />,
  "section-iam-security": <SafetyOutlined />,
  "section-system-management": <ToolOutlined />,
};

function getSectionOrder(key: string) {
  const index = SIDEBAR_SECTION_ORDER.indexOf(key as (typeof SIDEBAR_SECTION_ORDER)[number]);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function matchesPath(pathname: string, candidate: string) {
  return pathname === candidate || pathname.startsWith(`${candidate}/`);
}

function findActiveSectionKey(
  pathname: string,
  sections: Array<{ key: string; path?: string; items: Array<{ path: string }> }>,
) {
  for (const section of sections) {
    if (section.path && matchesPath(pathname, section.path)) {
      return section.key;
    }
    if (section.items.some((item) => matchesPath(pathname, item.path))) {
      return section.key;
    }
  }
  return undefined;
}

function readStoredSidebarOpenState(): StoredSidebarOpenState | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(SIDEBAR_OPEN_SECTION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSidebarOpenState>;
    if (Array.isArray(parsed.openSectionKeys)) {
      return {
        openSectionKey: typeof parsed.openSectionKey === "string" || parsed.openSectionKey === null ? parsed.openSectionKey : null,
        openSectionKeys: parsed.openSectionKeys.filter((item): item is string => typeof item === "string"),
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : undefined,
      };
    }
    if (typeof parsed.openSectionKey === "string" || parsed.openSectionKey === null) {
      return {
        openSectionKey: parsed.openSectionKey,
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : undefined,
      };
    }
  } catch {
    return { openSectionKey: raw };
  }
  return null;
}

function writeStoredSidebarOpenKeys(openSectionKeys: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    SIDEBAR_OPEN_SECTION_KEY,
    JSON.stringify({
      openSectionKey: openSectionKeys[openSectionKeys.length - 1] ?? null,
      openSectionKeys,
      updatedAt: Date.now(),
    }),
  );
}

function normalizeOpenSectionKeys(keys: string[], sectionKeySet: Set<string>) {
  const next = keys.filter((key, index) => sectionKeySet.has(key) && keys.indexOf(key) === index);
  return next.slice(-MAX_OPEN_SIDEBAR_SECTIONS);
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
  const visibleSections = useMemo(
    () =>
      [...filterNavSectionsByRole(userRole, disabledPaths)].sort(
        (left, right) => getSectionOrder(left.key) - getSectionOrder(right.key),
      ),
    [disabledPaths, userRole],
  );
  const sectionKeys = useMemo(
    () =>
      visibleSections
        .filter((section) => section.items.length > 0)
        .map((section) => section.key),
    [visibleSections],
  );
  const sectionKeySet = useMemo(() => new Set(sectionKeys), [sectionKeys]);
  const activeSectionKey = useMemo(
    () => findActiveSectionKey(pathname, visibleSections),
    [pathname, visibleSections],
  );
  const activeExpandableSectionKey =
    activeSectionKey && sectionKeySet.has(activeSectionKey) ? activeSectionKey : undefined;
  const [openSectionKeys, setOpenSectionKeys] = useState<string[]>([]);
  const [sidebarStateRestored, setSidebarStateRestored] = useState(false);
  const previousPathnameRef = useRef(pathname);
  const prefetchedPathsRef = useRef(new Set<string>());
  const pendingPrefetchPathsRef = useRef(new Set<string>());
  const router = useRouter();
  const expandedSectionKeys = useMemo(
    () => normalizeOpenSectionKeys(openSectionKeys, sectionKeySet),
    [openSectionKeys, sectionKeySet],
  );
  const prefetchPath = useCallback((path: string, timeout = 700) => {
    if (
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
  const prefetchPaths = useCallback((paths: readonly string[], timeout = 700, stepMs = 120) => {
    paths.forEach((path, index) => {
      prefetchPath(path, timeout + index * stepMs);
    });
  }, [prefetchPath]);
  const activeSectionPrefetchPaths = useMemo(() => {
    if (!activeSectionKey) {
      return [];
    }
    const section = visibleSections.find((item) => item.key === activeSectionKey);
    if (!section) {
      return [];
    }
    const paths = section.items.length > 0 ? section.items.map((item) => item.path) : section.path ? [section.path] : [];
    return paths.filter((path) => path !== pathname).slice(0, MAX_IDLE_PREFETCH_PATHS);
  }, [activeSectionKey, pathname, visibleSections]);

  // items 根据 role 过滤后生成
  const items: MenuProps["items"] = useMemo(
    () =>
      visibleSections.map((section) => {
        const icon = sectionIconMap[section.key] ?? <PartitionOutlined />;
        const sectionClassName = `app-sidebar-menu__section app-sidebar-menu__section--${section.key}`;

        // 顶级直跳 section（items 为空，有 path 字段）
        if (section.items.length === 0 && section.path) {
          return {
            key: section.path,
            className: sectionClassName,
            icon,
            label: (
              <Link
                className="app-sidebar-menu__link app-sidebar-menu__link--section"
                href={section.path}
                prefetch={false}
                style={{ display: "block" }}
                onMouseEnter={() => prefetchPath(section.path as string, 250)}
                onFocus={() => prefetchPath(section.path as string, 250)}
              >
                <span className="app-sidebar-menu__label">{section.label}</span>
              </Link>
            ),
          };
        }

        // 普通含子菜单的 section
        return {
          key: section.key,
          className: sectionClassName,
          icon,
          label: (
            <span
              className="app-sidebar-menu__label"
              onMouseEnter={() => prefetchPaths(section.items.map((item) => item.path).slice(0, MAX_IDLE_PREFETCH_PATHS), 250)}
              onFocus={() => prefetchPaths(section.items.map((item) => item.path).slice(0, MAX_IDLE_PREFETCH_PATHS), 250)}
            >
              {section.label}
            </span>
          ),
          children: section.items.map((item) => ({
            key: item.path,
            // Link 包裹 label：鼠标悬停自动触发 Next.js prefetch，点击由 Link 接管导航
            label: (
              <Link
                className="app-sidebar-menu__link app-sidebar-menu__link--nested"
                href={item.path}
                prefetch={false}
                style={{ display: "block" }}
                onMouseEnter={() => prefetchPath(item.path, 250)}
                onFocus={() => prefetchPath(item.path, 250)}
              >
                <span className="app-sidebar-menu__label app-sidebar-menu__label--nested">
                  {getNavDisplayLabel(item)}
                </span>
              </Link>
            ),
          })),
        };
      }),
    [prefetchPath, prefetchPaths, visibleSections],
  );

  useEffect(() => {
    if (sidebarStateRestored) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const storedState = readStoredSidebarOpenState();
      const storedOpenSectionKeys = storedState?.openSectionKeys;
      const storedOpenSectionKey = storedState?.openSectionKey;
      if (activeExpandableSectionKey) {
        setOpenSectionKeys([activeExpandableSectionKey]);
      } else if (storedOpenSectionKeys?.length) {
        setOpenSectionKeys(normalizeOpenSectionKeys(storedOpenSectionKeys, sectionKeySet));
      } else if (storedOpenSectionKey && sectionKeySet.has(storedOpenSectionKey)) {
        setOpenSectionKeys(normalizeOpenSectionKeys([storedOpenSectionKey], sectionKeySet));
      } else if (storedOpenSectionKey === null) {
        setOpenSectionKeys([]);
      } else {
        setOpenSectionKeys([]);
      }
      setSidebarStateRestored(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeExpandableSectionKey, sectionKeySet, sidebarStateRestored]);

  useEffect(() => {
    if (!sidebarStateRestored) {
      return undefined;
    }
    const nextOpenSectionKeys = normalizeOpenSectionKeys(openSectionKeys, sectionKeySet);
    if (nextOpenSectionKeys.length === openSectionKeys.length && nextOpenSectionKeys.every((key, index) => key === openSectionKeys[index])) {
      return undefined;
    }
    const timer = window.setTimeout(() => setOpenSectionKeys(nextOpenSectionKeys), 0);
    return () => window.clearTimeout(timer);
  }, [activeExpandableSectionKey, openSectionKeys, sectionKeySet, sidebarStateRestored]);

  useEffect(() => {
    if (!sidebarStateRestored) {
      return undefined;
    }
    const previousPathname = previousPathnameRef.current;
    if (previousPathname === pathname) {
      return undefined;
    }
    previousPathnameRef.current = pathname;
    const timer = window.setTimeout(() => {
      setOpenSectionKeys(activeExpandableSectionKey ? [activeExpandableSectionKey] : []);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeExpandableSectionKey, pathname, sectionKeySet, sidebarStateRestored]);

  useEffect(() => {
    if (!sidebarStateRestored || activeSectionPrefetchPaths.length === 0) {
      return undefined;
    }
    return scheduleIdleTask(() => {
      prefetchPaths(activeSectionPrefetchPaths, 450);
    }, 1400);
  }, [activeSectionPrefetchPaths, prefetchPaths, sidebarStateRestored]);

  useEffect(() => {
    if (!sidebarStateRestored) {
      return undefined;
    }
    const visiblePaths = visibleSections.flatMap((section) =>
      section.items.length > 0 ? section.items.map((item) => item.path) : section.path ? [section.path] : [],
    );
    const currentIndex = visiblePaths.findIndex((path) => matchesPath(pathname, path));
    const sectionIndex = activeSectionKey ? visibleSections.findIndex((section) => section.key === activeSectionKey) : -1;
    const candidates = new Set<string>();
    activeSectionPrefetchPaths.forEach((path) => candidates.add(path));
    [currentIndex - 1, currentIndex + 1].forEach((index) => {
      const path = visiblePaths[index];
      if (path) candidates.add(path);
    });
    [sectionIndex - 1, sectionIndex + 1].forEach((index) => {
      const section = visibleSections[index];
      const path = section?.path ?? section?.items[0]?.path;
      if (path) candidates.add(path);
    });
    const paths = [...candidates].filter((path) => path !== pathname).slice(0, MAX_IDLE_PREFETCH_PATHS);
    if (paths.length === 0) {
      return undefined;
    }
    return scheduleIdleTask(() => {
      prefetchPaths(paths, 650);
    }, 1800);
  }, [activeSectionKey, activeSectionPrefetchPaths, pathname, prefetchPath, prefetchPaths, sidebarStateRestored, visibleSections]);

  useEffect(() => {
    if (!sidebarStateRestored) {
      return;
    }
    writeStoredSidebarOpenKeys(expandedSectionKeys);
  }, [expandedSectionKeys, sidebarStateRestored]);

  return (
    <Sider
      width={232}
      className="app-sidebar kn-glass-surface"
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
              fontSize: 16,
              color: "var(--kn-primary)",
              letterSpacing: "0.08em",
              lineHeight: 1.2,
            }}
          >
            KubeNova
          </div>
          <div className="logo-caption" style={{ fontSize: 11, color: "var(--kn-text-muted)", letterSpacing: "0.16em" }}>
            CLOUD NATIVE OPS
          </div>
        </div>
      </div>
      <Menu
        className="app-sidebar-menu"
        mode="inline"
        theme={mode as "dark" | "light"}
        selectedKeys={[pathname]}
        openKeys={expandedSectionKeys}
        items={items}
        // Link 已接管导航，无需 onClick 处理路由跳转
        onOpenChange={(keys) => {
          markRouteTransitionQuietWindow();
          const expandedRaw = (keys as string[]).filter((key) => sectionKeySet.has(key));
          const latestOpenKey = expandedRaw.find((key) => !expandedSectionKeys.includes(key)) ?? expandedRaw.at(-1);
          setOpenSectionKeys(latestOpenKey ? [latestOpenKey] : []);
        }}
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
  const isLoginPage = pathname === "/login";
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
    const visibleSections = [...filterNavSectionsByRole(role, disabledPaths)].sort(
      (left, right) => getSectionOrder(left.key) - getSectionOrder(right.key),
    );
    return visibleSections.map((section) => {
      const icon = sectionIconMap[section.key] ?? <PartitionOutlined />;
      if (section.items.length === 0 && section.path) {
        return {
          key: section.path,
          icon,
          label: section.label,
        };
      }
      return {
        key: section.key,
        icon,
        label: section.label,
        children: section.items.map((item) => ({
          key: item.path,
          label: getNavDisplayLabel(item),
        })),
      };
    });
  }, [disabledPaths, role]);
  const shellScope = useMemo(
    () => ({
      cluster: searchParams.get("clusterName")?.trim() || searchParams.get("clusterId")?.trim() || "全部集群",
      namespace: searchParams.get("namespace")?.trim() || "全部名称空间",
    }),
    [searchParams],
  );
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
          className="app-header kn-glass-surface"
          data-shell-region="topbar"
          style={{
            background: "color-mix(in srgb, var(--kn-surface) 94%, transparent)",
            borderBottom: "1px solid var(--kn-border)",
            boxShadow: "var(--kn-shadow-subtle)",
          }}
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
            <span className="shell-status-chip shell-status-chip--scope">
              <span>集群</span>
              <strong>{shellScope.cluster}</strong>
            </span>
            <span className="shell-status-chip shell-status-chip--scope">
              <span>命名空间</span>
              <strong>{shellScope.namespace}</strong>
            </span>
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
          <div className="shell-mobile-scope" aria-label="当前移动端工作区范围">
            <span>{shellScope.cluster}</span>
            <strong>{shellScope.namespace}</strong>
          </div>
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
            <OpsIconActionButton className="shell-topbar-action" icon={<BellOutlined />}>通知中心</OpsIconActionButton>
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
