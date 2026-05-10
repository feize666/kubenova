export type NavItem = {
  key: string;
  path: string;
  label: string;
  canonicalNameEn?: string;
  canonicalNameZh?: string;
  description?: string;
  domain?: "workloads" | "network" | "storage" | "configs";
  /** 需要的最低角色权限，不设置表示所有人可见 */
  requiredRole?: "admin";
};

export type NavSection = {
  key: string;
  label: string;
  icon?: string;
  /** 顶级直接跳转时 path 有值，items 为空数组 */
  path?: string;
  items: NavItem[];
  /** 需要的最低角色权限，不设置表示所有人可见 */
  requiredRole?: "admin";
};

export const navSections: NavSection[] = [
  {
    key: "section-overview",
    label: "总览",
    path: "/",
    items: [],
  },
  {
    key: "section-resource-panorama",
    label: "资源全景图",
    path: "/network/topology",
    requiredRole: "admin",
    items: [],
  },
  {
    key: "section-clusters",
    label: "集群管理",
    path: "/clusters",
    requiredRole: "admin",
    items: [],
  },
  {
    key: "section-workloads",
    label: "工作负载",
    items: [
      {
        key: "workloads-pods",
        path: "/workloads/pods",
        label: "Pod（容器组）",
        canonicalNameEn: "Pod",
        canonicalNameZh: "容器组",
        description: "查看和管理集群中运行的 Pod 实例。",
        domain: "workloads",
      },
      {
        key: "workloads-deployments",
        path: "/workloads/deployments",
        label: "Deployment（无状态部署）",
        canonicalNameEn: "Deployment",
        canonicalNameZh: "无状态部署",
        description: "管理无状态应用发布、滚动更新与扩缩容。",
        domain: "workloads",
      },
      {
        key: "workloads-statefulsets",
        path: "/workloads/statefulsets",
        label: "StatefulSet（有状态部署）",
        canonicalNameEn: "StatefulSet",
        canonicalNameZh: "有状态部署",
        description: "管理有状态应用副本顺序与稳定标识。",
        domain: "workloads",
      },
      {
        key: "workloads-daemonsets",
        path: "/workloads/daemonsets",
        label: "DaemonSet（守护进程集）",
        canonicalNameEn: "DaemonSet",
        canonicalNameZh: "守护进程集",
        description: "确保每个节点按策略运行守护进程 Pod。",
        domain: "workloads",
      },
      {
        key: "workloads-replicasets",
        path: "/workloads/replicasets",
        label: "ReplicaSet（副本集）",
        canonicalNameEn: "ReplicaSet",
        canonicalNameZh: "副本集",
        description: "维护指定数量的 Pod 副本并支持副本巡检。",
        domain: "workloads",
      },
      {
        key: "workloads-jobs",
        path: "/workloads/jobs",
        label: "Job（一次性任务）",
        canonicalNameEn: "Job",
        canonicalNameZh: "一次性任务",
        description: "管理一次性批处理任务执行与重试策略。",
        domain: "workloads",
      },
      {
        key: "workloads-cronjobs",
        path: "/workloads/cronjobs",
        label: "CronJob（定时任务）",
        canonicalNameEn: "CronJob",
        canonicalNameZh: "定时任务",
        description: "管理周期性任务调度计划与执行历史。",
        domain: "workloads",
      },
      {
        key: "workloads-namespaces",
        path: "/namespaces",
        label: "Namespace（名称空间）",
        canonicalNameEn: "Namespace",
        canonicalNameZh: "名称空间",
        description: "管理集群租户隔离边界与资源配额作用域。",
        domain: "workloads",
        requiredRole: "admin",
      },
    ],
  },
  {
    key: "section-network",
    label: "网络管理",
    items: [
      {
        key: "network-services",
        path: "/network/services",
        label: "Service（网络服务）",
        canonicalNameEn: "Service",
        canonicalNameZh: "网络服务",
        description: "管理集群 Service 访问策略、端口映射与服务暴露方式。",
        domain: "network",
      },
      {
        key: "network-endpoints",
        path: "/network/endpoints",
        label: "Endpoints（服务端点）",
        canonicalNameEn: "Endpoints",
        canonicalNameZh: "服务端点",
        description: "查看 Service 后端地址集合、端口与实际连通目标。",
        domain: "network",
      },
      {
        key: "network-endpointslices",
        path: "/network/endpointslices",
        label: "Endpoint Slices（端点切片）",
        canonicalNameEn: "Endpoint Slices",
        canonicalNameZh: "端点切片",
        description: "查看 Kubernetes EndpointSlice 分片、地址状态与端口分布。",
        domain: "network",
      },
      {
        key: "network-ingress",
        path: "/network/ingress",
        label: "Ingress（网络入口）",
        canonicalNameEn: "Ingress",
        canonicalNameZh: "网络入口",
        description: "管理集群 Ingress 入口规则与域名路由。",
        domain: "network",
      },
      {
        key: "network-ingressroute",
        path: "/network/ingressroute",
        label: "IngressRoute（Traefik 路由）",
        canonicalNameEn: "IngressRoute",
        canonicalNameZh: "Traefik 路由",
        description: "管理 Traefik IngressRoute 入口规则、匹配表达式与中间件。",
        domain: "network",
      },
      {
        key: "network-networkpolicy",
        path: "/network/networkpolicy",
        label: "NetworkPolicy（网络策略）",
        canonicalNameEn: "NetworkPolicy",
        canonicalNameZh: "网络策略",
        description: "管理 Kubernetes NetworkPolicy 访问控制策略。",
        domain: "network",
      },
      {
        key: "network-gateway-api",
        path: "/network/gateway-api",
        label: "Gateway API（网关 API）",
        canonicalNameEn: "Gateway API",
        canonicalNameZh: "网关 API",
        description: "管理 GatewayClass、Gateway 与 HTTPRoute 资源。",
        domain: "network",
      },
    ],
  },
  {
    key: "section-storage-config",
    label: "存储管理",
    items: [
      {
        key: "storage-pv",
        path: "/storage/pv",
        label: "PersistentVolume（持久卷）",
        canonicalNameEn: "PersistentVolume",
        canonicalNameZh: "持久卷",
        description: "管理集群可用持久化卷与生命周期状态。",
        domain: "storage",
      },
      {
        key: "storage-pvc",
        path: "/storage/pvc",
        label: "PersistentVolumeClaim（持久卷声明）",
        canonicalNameEn: "PersistentVolumeClaim",
        canonicalNameZh: "持久卷声明",
        description: "管理工作负载对存储卷的申请与绑定。",
        domain: "storage",
      },
      {
        key: "storage-sc",
        path: "/storage/sc",
        label: "StorageClass（存储类）",
        canonicalNameEn: "StorageClass",
        canonicalNameZh: "存储类",
        description: "管理动态供给策略与存储后端参数。",
        domain: "storage",
      },
    ],
  },
  {
    key: "section-configs",
    label: "配置管理",
    items: [
      {
        key: "configs-configmaps",
        path: "/configs/configmaps",
        label: "ConfigMap（配置映射）",
        canonicalNameEn: "ConfigMap",
        canonicalNameZh: "配置映射",
        description: "管理应用配置键值与环境注入引用。",
        domain: "configs",
      },
      {
        key: "configs-secrets",
        path: "/configs/secrets",
        label: "Secret（密钥）",
        canonicalNameEn: "Secret",
        canonicalNameZh: "密钥",
        description: "管理敏感配置数据与凭据引用。",
        domain: "configs",
      },
      {
        key: "configs-serviceaccounts",
        path: "/configs/serviceaccounts",
        label: "ServiceAccount（服务账户）",
        canonicalNameEn: "ServiceAccount",
        canonicalNameZh: "服务账户",
        description: "管理工作负载访问 Kubernetes API 的身份。",
        domain: "configs",
        requiredRole: "admin",
      },
    ],
  },
  {
    key: "section-autoscaling",
    label: "弹性伸缩",
    items: [
      {
        key: "workloads-autoscaling-hpa",
        path: "/workloads/autoscaling/hpa",
        label: "HorizontalPodAutoscaler（水平自动扩缩容）",
        canonicalNameEn: "HorizontalPodAutoscaler",
        canonicalNameZh: "水平自动扩缩容",
        description: "按指标自动调整工作负载副本数。",
        domain: "workloads",
      },
      {
        key: "workloads-autoscaling-vpa",
        path: "/workloads/autoscaling/vpa",
        label: "VerticalPodAutoscaler（垂直自动扩缩容）",
        canonicalNameEn: "VerticalPodAutoscaler",
        canonicalNameZh: "垂直自动扩缩容",
        description: "按建议自动调整容器 CPU 与内存请求。",
        domain: "workloads",
      },
    ],
  },
  {
    key: "section-helm",
    label: "Helm",
    items: [
      { key: "helm-apps", path: "/workloads/helm", label: "Helm 应用" },
      { key: "helm-repositories", path: "/workloads/helm/repositories", label: "Helm 仓库" },
    ],
  },
  {
    key: "section-iam-security",
    label: "身份与安全",
    requiredRole: "admin",
    items: [
      { key: "users", path: "/users", label: "用户管理", requiredRole: "admin" },
      { key: "users-rbac", path: "/users/rbac", label: "访问控制", requiredRole: "admin" },
      { key: "security", path: "/security", label: "安全管理", requiredRole: "admin" },
    ],
  },
  {
    key: "section-observability",
    label: "可观测性",
    items: [
      { key: "cluster-health", path: "/observability/cluster-health", label: "集群健康", requiredRole: "admin" },
      { key: "inspection", path: "/inspection", label: "资源巡检" },
    ],
  },
  {
    key: "section-intelligence",
    label: "AIOps中台",
    path: "/ai-assistant",
    requiredRole: "admin",
    items: [],
  },
  {
    key: "section-system-management",
    label: "系统管理",
    requiredRole: "admin",
    items: [
      {
        key: "system-update-management",
        path: "/system/update",
        label: "更新管理",
        requiredRole: "admin",
      },
    ],
  },
];

/** 根据用户角色过滤可见的 sections */
export function filterNavSectionsByRole(
  role: string,
  disabledPaths?: Set<string> | null,
): NavSection[] {
  const normalizedRole = role.trim().toLowerCase();
  const hasAdminRole =
    normalizedRole === "admin" || normalizedRole === "platform-admin";
  const canAccess = (requiredRole?: "admin") =>
    !requiredRole || (requiredRole === "admin" && hasAdminRole);
  const isPathEnabled = (path?: string) =>
    !path || !disabledPaths || !disabledPaths.has(path);

  return navSections
    .filter(
      (section) =>
        canAccess(section.requiredRole) &&
        (section.items.length > 0 || isPathEnabled(section.path)),
    )
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => canAccess(item.requiredRole) && isPathEnabled(item.path),
      ),
    }));
}

export const navItems: NavItem[] = navSections.flatMap((section) => section.items);

function getCanonicalTitle(item: NavItem): string {
  if (item.canonicalNameEn && item.canonicalNameZh) {
    return `${item.canonicalNameEn}（${item.canonicalNameZh}）`;
  }
  return item.label;
}

export function getNavDisplayLabel(item: NavItem): string {
  return item.canonicalNameEn ?? item.label;
}

// 顶级直跳 section 单独加入 pathTitleMap
const topLevelEntries: [string, string][] = navSections
  .filter((s) => s.path)
  .map((s) => [s.path!, s.label]);

export const pathTitleMap = new Map<string, string>([
  ...topLevelEntries,
  ...navItems.map((i) => [i.path, getCanonicalTitle(i)] as [string, string]),
  // 根路径显示"智能仪表盘"而非分组标题"总览"
  ["/", "智能仪表盘"],
]);

export const pathSectionMap = new Map<string, string>([
  // 顶级直跳 section：路径映射到自身 key
  ...navSections
    .filter((s) => s.path)
    .map((s) => [s.path!, s.key] as [string, string]),
  // 子菜单项：路径映射到所属 section key
  ...navSections.flatMap((section) =>
    section.items.map((item) => [item.path, section.key] as [string, string]),
  ),
]);

const navItemMap = new Map<string, NavItem>(navItems.map((item) => [item.path, item]));

export function getTitleFromPath(pathname: string): string {
  return pathTitleMap.get(pathname) ?? "控制台";
}

export function getSectionKeyFromPath(pathname: string): string | undefined {
  return pathSectionMap.get(pathname);
}

export function getNavItemByPath(pathname: string): NavItem | undefined {
  return navItemMap.get(pathname);
}

const ENFORCED_CANONICAL_SECTION_KEYS = new Set([
  "section-workloads",
  "section-autoscaling",
  "section-storage-config",
  "section-configs",
]);

function validateNavigationContract(): void {
  const errors: string[] = [];

  for (const section of navSections) {
    if (!ENFORCED_CANONICAL_SECTION_KEYS.has(section.key)) {
      continue;
    }
    for (const item of section.items) {
      const missingFields: string[] = [];
      if (!item.canonicalNameEn?.trim()) missingFields.push("canonicalNameEn");
      if (!item.canonicalNameZh?.trim()) missingFields.push("canonicalNameZh");
      if (!item.description?.trim()) missingFields.push("description");
      if (missingFields.length > 0) {
        errors.push(
          `[${section.key}] ${item.path} missing required fields: ${missingFields.join(", ")}`,
        );
        continue;
      }
      const expectedTitle = `${item.canonicalNameEn}（${item.canonicalNameZh}）`;
      const actualTitle = pathTitleMap.get(item.path);
      if (actualTitle !== expectedTitle) {
        errors.push(
          `[${section.key}] ${item.path} header title mismatch: expected "${expectedTitle}", got "${actualTitle ?? ""}"`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Navigation contract validation failed.\n${errors.join("\n")}\n` +
        "Please provide canonicalNameEn/canonicalNameZh/description for required sections.",
    );
  }
}

validateNavigationContract();
