export const PLATFORM_HOME_PATH = "/";

export type ConsoleSurface = "public" | "portal" | "cluster-workspace" | "legacy-workspace";

export type PlatformNavigationItem = {
  key: "platform-overview" | "platform-clusters" | "platform-access" | "platform-applications" | "platform-settings";
  label: string;
  path: string;
  icon: "home" | "clusters" | "authorization" | "applications" | "settings";
  requiredRole?: "admin";
};

const PLATFORM_NAVIGATION: readonly PlatformNavigationItem[] = [
  { key: "platform-overview", label: "概览", path: "/", icon: "home" },
  { key: "platform-clusters", label: "集群", path: "/clusters", icon: "clusters" },
  { key: "platform-access", label: "授权管理", path: "/authorization", icon: "authorization", requiredRole: "admin" },
  { key: "platform-applications", label: "应用中心", path: "/applications", icon: "applications" },
  { key: "platform-settings", label: "系统设置", path: "/settings", icon: "settings", requiredRole: "admin" },
];

const PORTAL_PREFIXES = ["/clusters", "/authorization", "/applications", "/settings"] as const;

export function getPlatformNavigation(userRole: string, disabledPaths?: ReadonlySet<string> | null) {
  const normalizedRole = userRole.trim().toLowerCase();
  const canManagePlatform = normalizedRole === "admin" || normalizedRole === "platform-admin";
  return PLATFORM_NAVIGATION.filter(
    (item) => (!item.requiredRole || canManagePlatform) && !disabledPaths?.has(item.path),
  );
}

export function getConsoleSurface(pathname: string): ConsoleSurface {
  if (pathname === "/login" || pathname === "/login-new") return "public";
  if (/^\/clusters\/[^/?#]+\/[^/?#]+/.test(pathname)) {
    return "cluster-workspace";
  }
  if (pathname === PLATFORM_HOME_PATH || PORTAL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return "portal";
  }
  return "legacy-workspace";
}

export function getPlatformTitle(pathname: string) {
  if (pathname === PLATFORM_HOME_PATH) return "概览";
  const item = PLATFORM_NAVIGATION.find(({ path }) => pathname === path || pathname.startsWith(`${path}/`));
  return item?.label ?? "KubeNova";
}
