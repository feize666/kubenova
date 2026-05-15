"use client";

import {
  BellOutlined,
  BranchesOutlined,
  CodeOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  HomeOutlined,
  SafetyOutlined,
  MonitorOutlined,
  MoonFilled,
  NodeIndexOutlined,
  PartitionOutlined,
  RobotOutlined,
  SearchOutlined,
  SettingOutlined,
  SunFilled,
} from "@ant-design/icons";
import { Avatar, Breadcrumb, Button, Dropdown, Input, Layout, Menu, Skeleton, Space } from "antd";
import type { MenuProps } from "antd";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState, memo } from "react";
import { useAuth } from "@/components/auth-context";
import { getNavDisplayLabel, getTitleFromPath, filterNavSectionsByRole } from "@/config/navigation";
import { useThemeMode } from "@/components/theme-context";
import { listCapabilities } from "@/lib/api/capabilities";
import { buildLoginRoute, buildInternalReturnTo } from "@/lib/login-return";
import { BootstrapScreen } from "@/components/bootstrap-screen";

const { Header, Sider, Content } = Layout;
const SIDEBAR_OPEN_SECTION_KEY = "kubenova.nav.sidebar.openSection.v2";
const SIDEBAR_SECTION_ORDER = [
  "section-overview",
  "section-resource-panorama",
  "section-clusters",
  "section-workloads",
  "section-network",
  "section-configs",
  "section-storage-config",
  "section-autoscaling",
  "section-helm",
  "section-iam-security",
  "section-observability",
  "section-intelligence",
  "section-system-management",
] as const;

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
  "section-resource-panorama": <PartitionOutlined />,
  "section-clusters": <NodeIndexOutlined />,
  "section-workloads": <DeploymentUnitOutlined />,
  "section-network": <PartitionOutlined />,
  "section-autoscaling": <DeploymentUnitOutlined />,
  "section-helm": <DeploymentUnitOutlined />,
  "section-storage-config": <DatabaseOutlined />,
  "section-configs": <SettingOutlined />,
  "section-iam-security": <SafetyOutlined />,
  "section-observability": <MonitorOutlined />,
  "section-intelligence": <BranchesOutlined />,
  "section-system-management": <SettingOutlined />,
};

function areStringSetsEqual(left: Set<string> | null, right: Set<string> | null) {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

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
  const elements = root.querySelectorAll<HTMLElement>("body *");
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
  const [openSectionKey, setOpenSectionKey] = useState<string | undefined>(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    return window.localStorage.getItem(SIDEBAR_OPEN_SECTION_KEY) || undefined;
  });
  const effectiveOpenSectionKey =
    openSectionKey && sectionKeySet.has(openSectionKey)
      ? openSectionKey
      : activeSectionKey && sectionKeySet.has(activeSectionKey)
        ? activeSectionKey
        : undefined;
  const expandedSectionKeys = effectiveOpenSectionKey ? [effectiveOpenSectionKey] : [];

  // items 根据 role 过滤后生成
  const items: MenuProps["items"] = useMemo(
    () =>
      visibleSections.map((section) => {
        const icon = sectionIconMap[section.key] ?? <PartitionOutlined />;

        // 顶级直跳 section（items 为空，有 path 字段）
        if (section.items.length === 0 && section.path) {
          return {
            key: section.path,
            icon,
            label: (
              <Link href={section.path} prefetch={false} style={{ display: "block" }}>
                <span className="app-sidebar-menu__label">{section.label}</span>
              </Link>
            ),
          };
        }

        // 普通含子菜单的 section
        return {
          key: section.key,
          icon,
          label: section.label,
          children: section.items.map((item) => ({
            key: item.path,
            icon:
              item.path === "/ai-assistant"
                ? <RobotOutlined />
                : item.path === "/terminal"
                ? <CodeOutlined />
                : undefined,
            // Link 包裹 label：鼠标悬停自动触发 Next.js prefetch，点击由 Link 接管导航
            label: (
              <Link href={item.path} prefetch={false} style={{ display: "block" }}>
                <span className="app-sidebar-menu__label app-sidebar-menu__label--nested">
                  {getNavDisplayLabel(item)}
                </span>
              </Link>
            ),
          })),
        };
      }),
    [visibleSections],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (effectiveOpenSectionKey) {
      window.localStorage.setItem(SIDEBAR_OPEN_SECTION_KEY, effectiveOpenSectionKey);
      return;
    }
    window.localStorage.removeItem(SIDEBAR_OPEN_SECTION_KEY);
  }, [effectiveOpenSectionKey]);

  return (
    <Sider
      width={260}
      theme={mode as "dark" | "light"}
      style={{ borderRight: "1px solid rgba(59,130,246,0.15)" }}
    >
      <div
        className="logo-wrap"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "18px 16px 14px",
          borderBottom: "1px solid rgba(59,130,246,0.2)",
        }}
      >
        <div style={{ flexShrink: 0 }}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <path
              d="M16 2L28 9V23L16 30L4 23V9L16 2Z"
              fill="url(#grad1)"
              stroke="#3b82f6"
              strokeWidth="1.5"
            />
            <circle cx="16" cy="16" r="5" fill="none" stroke="#60a5fa" strokeWidth="1.5" />
            <line x1="16" y1="8" x2="16" y2="11" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="16" y1="21" x2="16" y2="24" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="8" y1="16" x2="11" y2="16" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="21" y1="16" x2="24" y2="16" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="10.3" y1="10.3" x2="12.5" y2="12.5" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="19.5" y1="19.5" x2="21.7" y2="21.7" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="21.7" y1="10.3" x2="19.5" y2="12.5" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="12.5" y1="19.5" x2="10.3" y2="21.7" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
            <defs>
              <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#1e3a5f" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#0a1628" stopOpacity="0.9" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div>
          <div
            style={{
              fontWeight: 800,
              fontSize: 16,
              color: "#3b82f6",
              letterSpacing: "0.08em",
              lineHeight: 1.2,
            }}
          >
            KubeNova
          </div>
          <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.16em" }}>
            CLOUD NATIVE AIOps
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
          const expandedRaw = (keys as string[]).filter((key) => sectionKeySet.has(key));
          const latestKey = expandedRaw[expandedRaw.length - 1];
          setOpenSectionKey(latestKey);
        }}
        onClick={({ key }) => {
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
  const { mode, toggleTheme } = useThemeMode();
  const { accessToken, isAuthenticated, isInitializing, username, role, logout } = useAuth();
  const isLoginPage = pathname === "/login";
  const [disabledPaths, setDisabledPaths] = useState<Set<string> | null>(null);
  const currentReturnTo = useMemo(
    () => buildInternalReturnTo(pathname, searchParams.toString()),
    [pathname, searchParams],
  );

  const userItems: MenuProps["items"] = [
    { key: "profile", label: "个人中心" },
    { key: "logout", label: "退出登录" },
  ];

  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated || !accessToken) {
      return () => {
        cancelled = true;
      };
    }

    const refreshCapabilities = async () => {
      try {
        const capabilities = await listCapabilities(accessToken);
        if (cancelled) return;
        const nextDisabledPaths = new Set(
          capabilities
            .filter((item) => !item.enabled)
            .map((item) => item.route)
            .filter(Boolean),
        );
        setDisabledPaths((current) =>
          areStringSetsEqual(current, nextDisabledPaths) ? current : nextDisabledPaths,
        );
      } catch {
        if (cancelled) return;
        // Fail-open to avoid blocking navigation due to transient backend loss.
      }
    };

    const initialTimer = window.setTimeout(() => {
      void refreshCapabilities();
    }, 2500);
    const timer = window.setInterval(() => {
      void refreshCapabilities();
    }, 60_000);
    const handleFocus = () => {
      void refreshCapabilities();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshCapabilities();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    void refreshCapabilities();

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [accessToken, isAuthenticated]);

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
    hideIssueLaunchers();
    const observer = new MutationObserver(() => {
      hideIssueLaunchers();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
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
    if (isLoginPage || isInitializing || isAuthenticated) {
      return;
    }
    window.location.replace(buildLoginRoute(currentReturnTo));
  }, [currentReturnTo, isAuthenticated, isInitializing, isLoginPage]);

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
    <Layout style={{ minHeight: "100vh" }}>
      {/* AppSider 用 memo 隔离，pathname 变化时只有 selectedKeys/openKeys 更新，父级其余 state 不会触发它重渲染 */}
      <AppSider pathname={pathname} mode={mode} userRole={role} disabledPaths={disabledPaths} />
      <Layout>
        <Header
          className="app-header"
          style={
            mode === "dark"
              ? {
                  background: "rgba(10,14,26,0.95)",
                  borderBottom: "1px solid rgba(59,130,246,0.3)",
                  boxShadow: "0 1px 20px rgba(59,130,246,0.08)",
                }
              : {
                  background: "#ffffff",
                  borderBottom: "1px solid rgba(59,130,246,0.15)",
                  boxShadow: "0 1px 8px rgba(37,99,235,0.06)",
                }
          }
        >
          <Breadcrumb
            items={[
              {
                title: (
                  <span
                    style={{
                      color: mode === "dark" ? "#64748b" : "#94a3b8",
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
                      color: mode === "dark" ? "#e2e8f0" : "#1e293b",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    {getTitleFromPath(pathname)}
                  </span>
                ),
              },
            ]}
          />
          <Space size={12}>
            <Input allowClear prefix={<SearchOutlined />} placeholder="搜索资源、日志或告警" style={{ width: 280 }} />
            <Button icon={<BellOutlined />}>通知中心</Button>
            <Button
              onClick={toggleTheme}
              style={{
                background:
                  mode === "dark"
                    ? "linear-gradient(135deg, #1e3a5f, #0a1628)"
                    : "linear-gradient(135deg, #dbeafe, #eff6ff)",
                border: `1px solid ${mode === "dark" ? "#3b82f6" : "#93c5fd"}`,
                color: mode === "dark" ? "#60a5fa" : "#1d4ed8",
                display: "flex",
                alignItems: "center",
                gap: 6,
                borderRadius: 20,
                padding: "0 14px",
                height: 34,
              }}
            >
              {mode === "dark" ? (
                <><MoonFilled style={{ color: "#818cf8", fontSize: 14 }} /> 深色</>
              ) : (
                <><SunFilled style={{ color: "#f59e0b", fontSize: 14 }} /> 浅色</>
              )}
            </Button>
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
              <Avatar style={{ cursor: "pointer", background: "#3b82f6", color: "#ffffff" }}>
                {(username || "管").slice(0, 1).toUpperCase()}
              </Avatar>
            </Dropdown>
          </Space>
        </Header>
        {/* Suspense 边界：路由切换时保持旧内容可见直到新页面就绪，同时提供骨架屏兜底 */}
        <Content className="app-content">
          <Suspense fallback={<LoadingSkeleton />}>{children}</Suspense>
        </Content>
      </Layout>
    </Layout>
  );
}
