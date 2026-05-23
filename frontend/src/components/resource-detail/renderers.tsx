"use client";

import { Card, Empty, Space, Tag, Typography } from "antd";
import { Fragment, useMemo } from "react";
import type { ReactNode } from "react";
import type {
  ResourceAssociation,
  ResourceDetailEvent,
  ResourceDetailNetworkEndpoint,
  ResourceDetailSection,
} from "@/lib/api/resources";
import { StatusTag } from "@/components/status-tag";
import {
  DetailDescriptions,
  DetailSection,
  TagList,
} from "./section-primitives";
import type { ResourceDetailRendererProps } from "./types";
import {
  buildOverviewFieldMap,
  buildRuntimeFieldMap,
  formatDateTime,
  formatValue,
  getOrderedFields,
  getRenderProfile,
  hasMetadataContent,
  humanizeFieldLabel,
  normalizeKind,
} from "./utils";

type NavigateRequest =
  NonNullable<ResourceDetailRendererProps["onNavigateRequest"]> extends (
    request: infer T,
  ) => void
    ? T
    : never;

const ASSOCIATION_TYPE_META: Record<string, { label: string; color: string }> =
  {
    "routes-to-service": { label: "Ingress 转发", color: "green" },
    "traefik-routes-to-service": { label: "IngressRoute 转发", color: "cyan" },
    "selects-service": { label: "后端发现", color: "orange" },
    "service-endpoints": { label: "服务端点", color: "gold" },
    "service-endpointslice": { label: "端点切片", color: "volcano" },
    "backend-service": { label: "后端服务", color: "blue" },
    "tls-secret": { label: "TLS 证书", color: "magenta" },
    "route-middleware": { label: "路由中间件", color: "geekblue" },
    "owned-pod": { label: "拥有 Pod", color: "purple" },
    owner: { label: "上级控制器", color: "purple" },
    "uses-configmap": { label: "使用 ConfigMap", color: "blue" },
    "uses-secret": { label: "使用 Secret", color: "magenta" },
    "secret-ref": { label: "Secret 引用", color: "purple" },
  };

function renderConditionsSection(
  items?: Array<{
    type?: string;
    status?: string;
    reason?: string;
    message?: string;
    lastTransitionTime?: string;
  }>,
) {
  if (!items || items.length === 0) {
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无状态条件" />
    );
  }

  return (
    <SimpleList
      items={items}
      renderItem={(item, index) => (
        <SimpleListItem>
          <Space orientation="vertical" size={2} style={{ width: "100%" }}>
            <Space wrap size={8}>
              {item.type ? <Tag color="blue">{item.type}</Tag> : null}
              {item.status ? <StatusTag state={item.status} /> : null}
              {item.reason ? <Tag color="geekblue">{item.reason}</Tag> : null}
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {[item.message, item.lastTransitionTime]
                .filter(Boolean)
                .join(" · ") || `条件 ${index + 1}`}
            </Typography.Text>
          </Space>
        </SimpleListItem>
      )}
    />
  );
}

const SECTION_PRIORITY: ResourceDetailSection[] = [
  "runtime",
  "associations",
  "network",
  "storage",
  "metadata",
  "events",
];

function SimpleListItem({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "8px 0",
        borderBottom: "1px solid var(--color-border, rgba(59, 130, 246, 0.12))",
      }}
    >
      {children}
    </div>
  );
}

function SimpleList<T>({
  items,
  renderItem,
}: {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
}) {
  return (
    <div>
      {items.map((item, index) => (
        <Fragment key={index}>{renderItem(item, index)}</Fragment>
      ))}
    </div>
  );
}

const RELATIONSHIP_ITEMS_VISIBLE_LIMIT = 8;

function LimitedList<T>({
  items,
  limit = RELATIONSHIP_ITEMS_VISIBLE_LIMIT,
  renderItem,
}: {
  items: T[];
  limit?: number;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const visibleItems = items.slice(0, limit);
  const hiddenCount = Math.max(items.length - visibleItems.length, 0);

  return (
    <Space orientation="vertical" size={8} style={{ width: "100%" }}>
      <SimpleList items={visibleItems} renderItem={renderItem} />
      {hiddenCount > 0 ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          另有 {hiddenCount} 项，已收起以减少渲染
        </Typography.Text>
      ) : null}
    </Space>
  );
}

const AUTOSCALING_KINDS = new Set([
  "horizontalpodautoscaler",
  "verticalpodautoscaler",
]);

const CONFIG_USAGE_META: Record<string, { label: string; color: string }> = {
  volume: { label: "volume", color: "blue" },
  env: { label: "env", color: "geekblue" },
  envFrom: { label: "envFrom", color: "cyan" },
  projected: { label: "projected", color: "gold" },
  imagePullSecret: { label: "imagePullSecret", color: "purple" },
  token: { label: "token", color: "volcano" },
  tls: { label: "tls", color: "magenta" },
  unknown: { label: "unknown", color: "default" },
};

const ASSOCIATION_GROUPS = [
  {
    key: "control",
    title: "控制关系",
    description: "Owner、控制器与被控制对象",
    types: new Set(["owner", "owned-pod"]),
  },
  {
    key: "network",
    title: "网络关系",
    description: "入口、路由、服务与端点",
    types: new Set([
      "routes-to-service",
      "traefik-routes-to-service",
      "selects-service",
      "service-endpoints",
      "service-endpointslice",
      "backend-service",
      "route-middleware",
    ]),
  },
  {
    key: "storage",
    title: "存储关系",
    description: "PVC、PV、StorageClass 与挂载使用方",
    types: new Set([
      "mount-claim",
      "uses-claim",
      "bound-volume",
      "bound-claim",
      "uses-storageclass",
      "uses-volume",
    ]),
  },
  {
    key: "config",
    title: "配置关系",
    description: "ConfigMap、Secret、ServiceAccount 引用",
    types: new Set([
      "config-ref",
      "secret-ref",
      "uses-configmap",
      "uses-secret",
      "tls-secret",
    ]),
  },
] as const;

function renderFieldValue(field: string, value: unknown) {
  if (
    (field === "state" || field === "phase") &&
    typeof value === "string" &&
    value
  ) {
    return <StatusTag state={value} />;
  }
  if (
    (field === "createdAt" || field === "updatedAt") &&
    typeof value === "string"
  ) {
    return formatDateTime(value);
  }
  if (field === "images" && Array.isArray(value)) {
    return (
      <TagList
        items={value.filter((item): item is string => typeof item === "string")}
        color="blue"
      />
    );
  }
  return formatValue(value);
}

function renderKeyValueSection(
  title: string,
  subtitle: string,
  fields: string[],
  values: Record<string, unknown>,
  emptyText = "暂无数据",
) {
  const items = fields
    .filter((field) => values[field] !== undefined && values[field] !== "")
    .map((field) => ({
      key: field,
      label: humanizeFieldLabel(field),
      value: renderFieldValue(field, values[field]),
    }));

  return (
    <DetailSection
      title={title}
      subtitle={subtitle}
      extra={
        items.length > 0 ? (
          <Typography.Text type="secondary">{items.length} 项</Typography.Text>
        ) : undefined
      }
    >
      <DetailDescriptions items={items} emptyText={emptyText} />
    </DetailSection>
  );
}

function formatStringMap(value?: Record<string, string>) {
  const entries = Object.entries(value ?? {});
  return entries.length > 0
    ? entries.map(([key, inner]) => `${key}=${inner}`).join(", ")
    : undefined;
}

function dedupeStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    ),
  );
}

function renderContainerSummaries(
  containers?: NonNullable<ResourceDetailRendererProps["detail"]["runtime"]["containerDetails"]>,
) {
  if (!containers || containers.length === 0) {
    return null;
  }
  return (
    <div>
      <Typography.Text strong>容器描述</Typography.Text>
      <SimpleList
        items={containers}
        renderItem={(container) => (
          <SimpleListItem>
            <Space orientation="vertical" size={4} style={{ width: "100%" }}>
              <Space wrap size={8}>
                <Tag color="geekblue">{container.name}</Tag>
                {container.image ? (
                  <Typography.Text strong>{container.image}</Typography.Text>
                ) : null}
                {container.probes && container.probes.length > 0 ? (
                  <Tag color="green">probes {container.probes.join("/")}</Tag>
                ) : null}
              </Space>
              <Space wrap size={[6, 6]}>
                {(container.ports ?? []).map((port, index) => (
                  <Tag key={`${container.name}-port-${index}`} color="blue">
                    {[
                      port.name,
                      port.protocol ?? "TCP",
                      port.containerPort,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  </Tag>
                ))}
                {(container.env ?? []).slice(0, 12).map((env) => (
                  <Tag key={`${container.name}-env-${env}`} color="cyan">
                    {env}
                  </Tag>
                ))}
              </Space>
            </Space>
          </SimpleListItem>
        )}
      />
    </div>
  );
}

function toNavigateRequest(
  kind?: string | null,
  id?: string | null,
): NavigateRequest | null {
  if (!kind || !id) {
    return null;
  }
  const safeKind = String(kind).trim();
  const safeId = String(id).trim();
  if (!safeKind || !safeId) {
    return null;
  }
  return { kind: safeKind, id: safeId };
}

function resolveAssociationNavigationByIdentity(
  detail: ResourceDetailRendererProps["detail"],
  kind?: string,
  name?: string,
  namespace?: string,
  id?: string,
): NavigateRequest | null {
  const direct = toNavigateRequest(kind, id);
  if (direct) {
    return direct;
  }
  if (!kind || !name) {
    return null;
  }
  if (
    normalizeKind(kind) === normalizeKind(detail.overview.kind) &&
    name === detail.overview.name &&
    (!namespace ||
      !detail.overview.namespace ||
      namespace === detail.overview.namespace)
  ) {
    return toNavigateRequest(detail.overview.kind, detail.overview.id);
  }
  const targetKind = normalizeKind(kind);
  const candidate = detail.associations.find((association) => {
    if (!association.id) return false;
    if (normalizeKind(association.kind) !== targetKind) return false;
    if (association.name !== name) return false;
    if (
      namespace &&
      association.namespace &&
      association.namespace !== namespace
    )
      return false;
    return true;
  });
  return toNavigateRequest(candidate?.kind, candidate?.id);
}

function renderPipelineObject(
  detail: ResourceDetailRendererProps["detail"],
  kind: string | undefined,
  name: string | undefined,
  namespace: string | undefined,
  id: string | undefined,
  color: string,
  onNavigateRequest?: ResourceDetailRendererProps["onNavigateRequest"],
) {
  if (!kind && !name) {
    return null;
  }
  const safeKind = kind || "Object";
  const safeName = name || "-";
  const target =
    onNavigateRequest && kind && name
      ? resolveAssociationNavigationByIdentity(
          detail,
          kind,
          name,
          namespace,
          id,
        )
      : null;
  return (
    <>
      <Tag color={color}>{safeKind}</Tag>
      {target && onNavigateRequest ? (
        <Typography.Link strong onClick={() => onNavigateRequest(target)}>
          {safeName}
        </Typography.Link>
      ) : (
        <Typography.Text strong>{safeName}</Typography.Text>
      )}
      {namespace ? (
        <Typography.Text type="secondary">{namespace}</Typography.Text>
      ) : null}
    </>
  );
}

function getIngressRouteEntryPoints(items: ResourceDetailNetworkEndpoint[]) {
  return dedupeStrings(
    items.flatMap((item) =>
      typeof item.host === "string"
        ? item.host
            .split(",")
            .map((entryPoint) => entryPoint.trim())
            .filter(Boolean)
        : [],
    ),
  );
}

function formatEndpointPortLabel(port: {
  port: number;
  protocol?: string;
  targetPort?: string;
}) {
  return `${port.protocol ?? "TCP"} ${port.port}${port.targetPort ? ` -> ${port.targetPort}` : ""}`;
}

function EndpointHighlightsSection({ detail }: ResourceDetailRendererProps) {
  const kind = normalizeKind(
    detail.descriptor.resourceKind || detail.overview.kind,
  );
  if (!["endpoints", "endpointslice"].includes(kind)) {
    return null;
  }

  const sourceKind = kind === "endpointslice" ? "EndpointSlice" : "Endpoints";
  const serviceAssociationType =
    kind === "endpointslice" ? "service-endpointslice" : "service-endpoints";
  const endpointItems = detail.network.endpoints.filter(
    (item) => item.sourceKind === sourceKind,
  );
  const serviceAssociations = detail.associations.filter(
    (item) =>
      item.kind === "Service" &&
      item.associationType === serviceAssociationType,
  );
  const addressLabels = dedupeStrings(
    endpointItems.map((item) => item.ip ?? item.name),
  );
  const hostnameLabels = dedupeStrings(
    endpointItems.map((item) => item.hostname),
  );
  const portLabels = dedupeStrings(
    endpointItems.flatMap((item) =>
      (item.ports ?? []).map((port) => formatEndpointPortLabel(port)),
    ),
  );
  const topologyLabels = dedupeStrings([
    ...detail.network.nodeNames.map((item) => `节点 ${item}`),
    ...Object.entries(detail.metadata.labels)
      .filter(([key]) =>
        [
          "kubernetes.io/service-name",
          "endpointslice.kubernetes.io/managed-by",
          "topology.kubernetes.io/zone",
          "topology.kubernetes.io/region",
          "kubernetes.io/hostname",
        ].includes(key),
      )
      .map(([key, value]) => `${key}=${value}`),
    ...Object.entries(detail.metadata.annotations)
      .filter(
        ([key]) =>
          key.includes("topology") ||
          key.includes("node") ||
          key.includes("hints"),
      )
      .map(([key, value]) => `${key}=${value}`),
  ]);

  const groupingMap = new Map<
    string,
    {
      key: string;
      label: string;
      addresses: string[];
      hostnames: string[];
      size: number;
    }
  >();
  endpointItems.forEach((item, index) => {
    const label =
      dedupeStrings(
        (item.ports ?? []).map((port) => formatEndpointPortLabel(port)),
      ).join(" · ") || "未声明端口";
    const entry = groupingMap.get(label) ?? {
      key: `${sourceKind}-${index}`,
      label,
      addresses: [],
      hostnames: [],
      size: 0,
    };
    if (item.ip) {
      entry.addresses.push(item.ip);
    }
    if (item.hostname) {
      entry.hostnames.push(item.hostname);
    }
    entry.size += 1;
    groupingMap.set(label, entry);
  });
  const groupedEndpoints = Array.from(groupingMap.values()).map((item) => ({
    ...item,
    addresses: dedupeStrings(item.addresses),
    hostnames: dedupeStrings(item.hostnames),
  }));

  const readyHint =
    kind === "endpointslice"
      ? "当前详情未下发 endpoint.conditions.ready / serving / terminating，无法精确区分 ready backends。"
      : "当前详情已将 addresses 与 notReadyAddresses 合并，无法精确区分 ready / notReady backends。";

  return (
    <DetailSection
      title={
        kind === "endpointslice" ? "EndpointSlice 高频区" : "Endpoints 高频区"
      }
      subtitle={
        kind === "endpointslice"
          ? "突出后端地址、端口定义、服务归属与可观测拓扑信号"
          : "突出 addresses、subset 近似分组、端口定义与服务归属"
      }
    >
      {endpointItems.length === 0 && serviceAssociations.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无端点高频信息"
        />
      ) : (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <DetailDescriptions
            items={
              [
                serviceAssociations.length > 0
                  ? {
                      key: "services",
                      label: "关联服务",
                      value: serviceAssociations.length,
                    }
                  : null,
                addressLabels.length > 0
                  ? {
                      key: "addresses",
                      label: "后端地址",
                      value: addressLabels.length,
                    }
                  : null,
                groupedEndpoints.length > 0
                  ? {
                      key: "groups",
                      label:
                        kind === "endpointslice" ? "地址分组" : "Subset 近似组",
                      value: groupedEndpoints.length,
                    }
                  : null,
                portLabels.length > 0
                  ? {
                      key: "ports",
                      label: "端口定义",
                      value: portLabels.length,
                    }
                  : null,
                hostnameLabels.length > 0
                  ? {
                      key: "hostnames",
                      label: "主机名",
                      value: hostnameLabels.length,
                    }
                  : null,
                topologyLabels.length > 0
                  ? {
                      key: "topology",
                      label: "拓扑信号",
                      value: topologyLabels.length,
                    }
                  : null,
              ].filter(Boolean) as Array<{
                key: string;
                label: string;
                value: ReactNode;
              }>
            }
            emptyText="暂无端点摘要"
          />

          {portLabels.length > 0 ? (
            <div>
              <Typography.Text strong>端口视图</Typography.Text>
              <div style={{ marginTop: 8 }}>
                <TagList
                  items={portLabels}
                  color={kind === "endpointslice" ? "volcano" : "gold"}
                />
              </div>
            </div>
          ) : null}

          {groupedEndpoints.length > 0 ? (
            <div>
              <Typography.Text strong>
                {kind === "endpointslice" ? "地址分组" : "Subset 近似分组"}
              </Typography.Text>
              <SimpleList
                items={groupedEndpoints}
                renderItem={(item) => (
                  <SimpleListItem>
                    <Space
                      orientation="vertical"
                      size={4}
                      style={{ width: "100%" }}
                    >
                      <Space wrap size={8}>
                        <Tag
                          color={kind === "endpointslice" ? "volcano" : "gold"}
                        >
                          {kind === "endpointslice"
                            ? "EndpointSlice"
                            : "Subset"}
                        </Tag>
                        <Typography.Text strong>{item.label}</Typography.Text>
                        <Typography.Text type="secondary">
                          {item.size} 个后端
                        </Typography.Text>
                      </Space>
                      {item.addresses.length > 0 ? (
                        <Typography.Text
                          type="secondary"
                          style={{ fontSize: 12 }}
                        >
                          地址: {item.addresses.join(", ")}
                        </Typography.Text>
                      ) : null}
                      {item.hostnames.length > 0 ? (
                        <Typography.Text
                          type="secondary"
                          style={{ fontSize: 12 }}
                        >
                          主机名: {item.hostnames.join(", ")}
                        </Typography.Text>
                      ) : null}
                    </Space>
                  </SimpleListItem>
                )}
              />
            </div>
          ) : null}

          <div>
            <Typography.Text strong>Ready 视图</Typography.Text>
            <Typography.Paragraph
              type="secondary"
              style={{ marginTop: 8, marginBottom: 0 }}
            >
              {readyHint}
            </Typography.Paragraph>
          </div>

          {topologyLabels.length > 0 ? (
            <div>
              <Typography.Text strong>Topology 视图</Typography.Text>
              <div style={{ marginTop: 8 }}>
                <TagList items={topologyLabels} color="cyan" />
              </div>
            </div>
          ) : (
            <div>
              <Typography.Text strong>Topology 视图</Typography.Text>
              <Typography.Paragraph
                type="secondary"
                style={{ marginTop: 8, marginBottom: 0 }}
              >
                当前详情仅能观测到 slice/资源级标签与主机名信号；若需节点级
                topology，需后端补充 endpoint nodeName / zone 字段。
              </Typography.Paragraph>
            </div>
          )}
        </Space>
      )}
    </DetailSection>
  );
}

function IngressHighlightsSection({ detail }: ResourceDetailRendererProps) {
  const kind = normalizeKind(
    detail.descriptor.resourceKind || detail.overview.kind,
  );
  if (!["ingress", "ingressroute"].includes(kind)) {
    return null;
  }

  const sourceKind = kind === "ingressroute" ? "IngressRoute" : "Ingress";
  const routeEndpoints = detail.network.endpoints.filter(
    (item) =>
      item.sourceKind === sourceKind &&
      (Boolean(item.path) ||
        Boolean(item.host) ||
        Boolean(item.sourceId) ||
        Boolean(item.ports?.length)),
  );
  const exposureEndpoints = detail.network.endpoints.filter(
    (item) =>
      item.sourceKind === sourceKind &&
      !item.path &&
      !item.host &&
      (item.ip || item.hostname),
  );
  const backendRefs = detail.associations.filter(
    (item) => item.associationType === "backend-service",
  );
  const tlsRefs = detail.associations.filter(
    (item) => item.associationType === "tls-secret",
  );
  const middlewareRefs = detail.associations.filter(
    (item) => item.associationType === "route-middleware",
  );
  const distinctHosts = dedupeStrings(routeEndpoints.map((item) => item.host));
  const distinctPaths = dedupeStrings(routeEndpoints.map((item) => item.path));
  const entryPoints =
    kind === "ingressroute" ? getIngressRouteEntryPoints(routeEndpoints) : [];

  return (
    <DetailSection
      title={kind === "ingressroute" ? "IngressRoute 高频区" : "Ingress 高频区"}
      subtitle={
        kind === "ingressroute"
          ? "突出入口点、匹配规则、后端服务、中间件与 TLS"
          : "突出 Host/Path、后端服务与 TLS 配置"
      }
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions
          items={
            [
              kind === "ingress" && distinctHosts.length > 0
                ? { key: "hosts", label: "Host", value: distinctHosts.length }
                : null,
              distinctPaths.length > 0
                ? {
                    key: "paths",
                    label: kind === "ingressroute" ? "匹配规则" : "Path",
                    value: distinctPaths.length,
                  }
                : null,
              kind === "ingressroute" && routeEndpoints.length > 0
                ? {
                    key: "routes",
                    label: "路由条目",
                    value: routeEndpoints.length,
                  }
                : null,
              entryPoints.length > 0
                ? {
                    key: "entryPoints",
                    label: "Entrypoints",
                    value: entryPoints.length,
                  }
                : null,
              backendRefs.length > 0
                ? {
                    key: "backends",
                    label: "后端服务",
                    value: `${backendRefs.length} 项（见关系导航）`,
                  }
                : null,
              tlsRefs.length > 0
                ? {
                    key: "tls",
                    label: "TLS",
                    value: `${tlsRefs.length} 项（见关系导航）`,
                  }
                : null,
              middlewareRefs.length > 0
                ? {
                    key: "middlewares",
                    label: "中间件",
                    value: `${middlewareRefs.length} 项（见关系导航）`,
                  }
                : null,
            ].filter(Boolean) as Array<{
              key: string;
              label: string;
              value: ReactNode;
            }>
          }
          emptyText={
            kind === "ingressroute"
              ? "暂无 IngressRoute 摘要"
              : "暂无 Ingress 摘要"
          }
        />

        {entryPoints.length > 0 ? (
          <div>
            <Typography.Text strong>Entrypoints</Typography.Text>
            <div style={{ marginTop: 8 }}>
              <TagList items={entryPoints} color="cyan" />
            </div>
          </div>
        ) : null}

        {routeEndpoints.length > 0 ? (
          <div>
            <Typography.Text strong>
              {kind === "ingressroute" ? "路由规则" : "转发规则"}
            </Typography.Text>
            <SimpleList
              items={routeEndpoints}
              renderItem={(item, index) => {
                const endpointEntryPoints =
                  kind === "ingressroute"
                    ? typeof item.host === "string"
                      ? item.host
                          .split(",")
                          .map((entryPoint) => entryPoint.trim())
                          .filter(Boolean)
                      : []
                    : [];

                return (
                  <SimpleListItem>
                    <Space
                      orientation="vertical"
                      size={6}
                      style={{ width: "100%" }}
                    >
                      <Space wrap size={[8, 8]}>
                        {kind === "ingressroute" ? null : item.host ? (
                          <Tag color="green">{item.host}</Tag>
                        ) : (
                          <Tag>默认 Host</Tag>
                        )}
                        {item.path ? (
                          <Typography.Text code>{item.path}</Typography.Text>
                        ) : kind === "ingress" ? (
                          <Typography.Text code>/</Typography.Text>
                        ) : (
                          <Typography.Text type="secondary">
                            未声明匹配规则
                          </Typography.Text>
                        )}
                        <Tag color="blue">Backend</Tag>
                        <Typography.Text strong>{item.name}</Typography.Text>
                        {item.namespace ? (
                          <Typography.Text type="secondary">
                            {item.namespace}
                          </Typography.Text>
                        ) : null}
                      </Space>

                      {endpointEntryPoints.length > 0 ? (
                        <Space wrap size={[6, 6]}>
                          {endpointEntryPoints.map((entryPoint) => (
                            <Tag
                              key={`${item.name}-${entryPoint}-${index}`}
                              color="cyan"
                            >
                              {entryPoint}
                            </Tag>
                          ))}
                        </Space>
                      ) : null}

                      {item.ports && item.ports.length > 0 ? (
                        <Space wrap size={[6, 6]}>
                          {item.ports.map((port) => (
                            <Tag
                              key={`${item.name}-${port.port}-${port.protocol ?? "tcp"}`}
                            >
                              {port.protocol ?? "TCP"} {port.port}
                              {port.targetPort ? ` -> ${port.targetPort}` : ""}
                            </Tag>
                          ))}
                        </Space>
                      ) : null}
                    </Space>
                  </SimpleListItem>
                );
              }}
            />
          </div>
        ) : null}

        {exposureEndpoints.length > 0 ? (
          <div>
            <Typography.Text strong>对外地址</Typography.Text>
            <SimpleList
              items={exposureEndpoints}
              renderItem={(item, index) => (
                <SimpleListItem>
                  <Space wrap size={8}>
                    <Tag color="green">{sourceKind}</Tag>
                    <Typography.Text strong>
                      {item.hostname ??
                        item.ip ??
                        `${detail.overview.name}-${index + 1}`}
                    </Typography.Text>
                    {item.hostname && item.ip ? (
                      <Typography.Text type="secondary">
                        {item.ip}
                      </Typography.Text>
                    ) : null}
                  </Space>
                </SimpleListItem>
              )}
            />
          </div>
        ) : null}
      </Space>
    </DetailSection>
  );
}

function OverviewHeroSection({ detail }: ResourceDetailRendererProps) {
  const runtimeHighlights = [
    detail.runtime.phase
      ? {
          label: "阶段",
          value: renderFieldValue("phase", detail.runtime.phase),
        }
      : null,
    detail.runtime.replicas !== undefined
      ? { label: "副本", value: detail.runtime.replicas }
      : null,
    detail.runtime.readyReplicas !== undefined
      ? { label: "就绪", value: detail.runtime.readyReplicas }
      : null,
    detail.runtime.availableReplicas !== undefined
      ? { label: "可用", value: detail.runtime.availableReplicas }
      : null,
    detail.runtime.restartCount !== undefined
      ? { label: "重启", value: detail.runtime.restartCount }
      : null,
    detail.runtime.podIP
      ? { label: "Pod IP", value: detail.runtime.podIP }
      : null,
    detail.runtime.nodeName
      ? { label: "节点", value: detail.runtime.nodeName }
      : null,
  ].filter(Boolean) as Array<{ label: string; value: ReactNode }>;

  return (
    <Card
      size="small"
      variant="borderless"
      style={{
        borderRadius: 18,
        border: "1px solid var(--color-border, rgba(59, 130, 246, 0.15))",
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--color-card-high, #1a2234) 88%, transparent) 0%, color-mix(in srgb, var(--color-card, #111827) 96%, transparent) 52%, color-mix(in srgb, var(--color-primary-glow, rgba(59, 130, 246, 0.25)) 32%, transparent) 100%)",
        boxShadow: "0 18px 40px rgba(15, 23, 42, 0.22)",
      }}
      styles={{ body: { padding: 20 } }}
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <Space wrap size={[8, 8]}>
          <Tag color="geekblue">{detail.overview.kind}</Tag>
          {detail.overview.namespace ? (
            <Tag>{detail.overview.namespace}</Tag>
          ) : (
            <Tag>集群级</Tag>
          )}
          <StatusTag state={detail.overview.state} />
          {detail.runtime.phase ? (
            <StatusTag state={detail.runtime.phase} />
          ) : null}
        </Space>

        <Space orientation="vertical" size={4} style={{ width: "100%" }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {detail.overview.name}
          </Typography.Title>
          <Typography.Text type="secondary">
            集群 {detail.overview.clusterId}
            {detail.overview.namespace
              ? ` / 名称空间 ${detail.overview.namespace}`
              : ""}
            {` / ID ${detail.overview.id}`}
          </Typography.Text>
        </Space>

        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))",
          }}
        >
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              background:
                "color-mix(in srgb, var(--color-card-high, #1a2234) 82%, transparent)",
              border: "1px solid var(--color-border, rgba(59, 130, 246, 0.15))",
            }}
          >
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              创建时间
            </Typography.Text>
            <div>
              <Typography.Text>
                {formatDateTime(detail.overview.createdAt)}
              </Typography.Text>
            </div>
          </div>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              background:
                "color-mix(in srgb, var(--color-card-high, #1a2234) 82%, transparent)",
              border: "1px solid var(--color-border, rgba(59, 130, 246, 0.15))",
            }}
          >
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              更新时间
            </Typography.Text>
            <div>
              <Typography.Text>
                {formatDateTime(detail.overview.updatedAt)}
              </Typography.Text>
            </div>
          </div>
          {runtimeHighlights.slice(0, 4).map((item) => (
            <div
              key={item.label}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                background:
                  "color-mix(in srgb, var(--color-card-high, #1a2234) 82%, transparent)",
                border:
                  "1px solid var(--color-border, rgba(59, 130, 246, 0.15))",
              }}
            >
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {item.label}
              </Typography.Text>
              <div>
                {typeof item.value === "string" ||
                typeof item.value === "number" ? (
                  <Typography.Text strong>{item.value}</Typography.Text>
                ) : (
                  item.value
                )}
              </div>
            </div>
          ))}
        </div>

        {detail.runtime.image || detail.runtime.images.length > 0 ? (
          <Space orientation="vertical" size={6} style={{ width: "100%" }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              镜像
            </Typography.Text>
            <TagList
              items={
                detail.runtime.images.length > 0
                  ? detail.runtime.images
                  : detail.runtime.image
                    ? [detail.runtime.image]
                    : []
              }
              color="blue"
            />
          </Space>
        ) : null}
      </Space>
    </Card>
  );
}

function StatusSnapshotSection({ detail }: ResourceDetailRendererProps) {
  const items = [
    {
      key: "state",
      label: "资源状态",
      value: renderFieldValue("state", detail.overview.state),
    },
    detail.runtime.phase !== undefined
      ? {
          key: "phase",
          label: "运行阶段",
          value: renderFieldValue("phase", detail.runtime.phase),
        }
      : null,
    detail.runtime.replicas !== undefined
      ? { key: "replicas", label: "期望副本", value: detail.runtime.replicas }
      : null,
    detail.runtime.readyReplicas !== undefined
      ? {
          key: "readyReplicas",
          label: "就绪副本",
          value: detail.runtime.readyReplicas,
        }
      : null,
    detail.runtime.availableReplicas !== undefined
      ? {
          key: "availableReplicas",
          label: "可用副本",
          value: detail.runtime.availableReplicas,
        }
      : null,
    detail.runtime.restartCount !== undefined
      ? {
          key: "restartCount",
          label: "重启次数",
          value: detail.runtime.restartCount,
        }
      : null,
    detail.runtime.podIP
      ? { key: "podIP", label: "Pod IP", value: detail.runtime.podIP }
      : null,
    detail.runtime.nodeName
      ? { key: "nodeName", label: "节点", value: detail.runtime.nodeName }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    value: ReactNode;
  }>;

  return (
    <DetailSection title="状态摘要" subtitle="先看健康、阶段与运行规模">
      <DetailDescriptions items={items} emptyText="暂无状态信息" />
    </DetailSection>
  );
}

function PodHighlightsSection({
  detail,
}: ResourceDetailRendererProps) {
  if (
    normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !==
    "pod"
  ) {
    return null;
  }

  const items = [
    detail.runtime.nodeName
      ? { key: "nodeName", label: "节点", value: detail.runtime.nodeName }
      : null,
    detail.runtime.podIP
      ? { key: "podIP", label: "Pod IP", value: detail.runtime.podIP }
      : null,
    detail.runtime.restartCount !== undefined
      ? {
          key: "restartCount",
          label: "重启次数",
          value: detail.runtime.restartCount,
        }
      : null,
    detail.runtime.image
      ? { key: "image", label: "主镜像", value: detail.runtime.image }
      : null,
    detail.runtime.serviceAccountName
      ? {
          key: "serviceAccountName",
          label: "ServiceAccount",
          value: detail.runtime.serviceAccountName,
        }
      : null,
    detail.runtime.restartPolicy
      ? {
          key: "restartPolicy",
          label: "重启策略",
          value: detail.runtime.restartPolicy,
        }
      : null,
    detail.runtime.dnsPolicy
      ? { key: "dnsPolicy", label: "DNS 策略", value: detail.runtime.dnsPolicy }
      : null,
    formatStringMap(detail.runtime.nodeSelector)
      ? {
          key: "nodeSelector",
          label: "节点选择器",
          value: formatStringMap(detail.runtime.nodeSelector),
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    value: ReactNode;
  }>;

  return (
    <DetailSection title="Pod 高频区" subtitle="先看节点、IP、镜像与运行策略">
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions items={items} emptyText="暂无 Pod 运行摘要" />
        {detail.runtime.images.length > 0 ? (
          <div>
            <Typography.Text strong>镜像列表</Typography.Text>
            <div style={{ marginTop: 8 }}>
              <TagList items={detail.runtime.images} color="blue" />
            </div>
          </div>
        ) : null}
        {renderContainerSummaries(detail.runtime.containerDetails)}
      </Space>
    </DetailSection>
  );
}

function WorkloadHighlightsSection({
  detail,
}: ResourceDetailRendererProps) {
  const kind = normalizeKind(
    detail.descriptor.resourceKind || detail.overview.kind,
  );
  if (!["deployment", "statefulset", "daemonset"].includes(kind)) {
    return null;
  }

  const selectorText =
    detail.runtime.selector ?? formatStringMap(detail.metadata.labels) ?? "";

  const ownedPods = detail.associations.filter(
    (item) => item.associationType === "owned-pod",
  );
  const items = [
    detail.runtime.replicas !== undefined
      ? { key: "replicas", label: "期望副本", value: detail.runtime.replicas }
      : null,
    detail.runtime.readyReplicas !== undefined
      ? {
          key: "readyReplicas",
          label: "就绪副本",
          value: detail.runtime.readyReplicas,
        }
      : null,
    detail.runtime.availableReplicas !== undefined
      ? {
          key: "availableReplicas",
          label: "可用副本",
          value: detail.runtime.availableReplicas,
        }
      : null,
    selectorText
      ? { key: "selector", label: "Selector", value: selectorText }
      : null,
    ownedPods.length > 0
      ? {
          key: "ownedPods",
          label: "拥有 Pod",
          value: `${ownedPods.length} 项（见关系导航）`,
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    value: ReactNode;
  }>;

  return (
    <DetailSection
      title="工作负载高频区"
      subtitle="副本、Selector、镜像与拥有的 Pod"
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions items={items} emptyText="暂无工作负载摘要" />
        {detail.runtime.images.length > 0 ? (
          <div>
            <Typography.Text strong>镜像列表</Typography.Text>
            <div style={{ marginTop: 8 }}>
              <TagList items={detail.runtime.images} color="blue" />
            </div>
          </div>
        ) : null}
        {renderContainerSummaries(detail.runtime.containerDetails)}
      </Space>
    </DetailSection>
  );
}

function ReplicaSetHighlightsSection({
  detail,
}: ResourceDetailRendererProps) {
  if (
    normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !==
    "replicaset"
  ) {
    return null;
  }

  const ownerControllers = detail.associations.filter(
    (item) => item.associationType === "owner",
  );
  const ownedPods = detail.associations.filter(
    (item) => item.associationType === "owned-pod",
  );
  const selectorText =
    Object.keys(detail.metadata.labels).length > 0
      ? Object.entries(detail.metadata.labels)
          .slice(0, 6)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ")
      : "";

  const items = [
    detail.runtime.replicas !== undefined
      ? { key: "replicas", label: "期望副本", value: detail.runtime.replicas }
      : null,
    detail.runtime.readyReplicas !== undefined
      ? { key: "ready", label: "就绪副本", value: detail.runtime.readyReplicas }
      : null,
    detail.runtime.availableReplicas !== undefined
      ? {
          key: "available",
          label: "可用副本",
          value: detail.runtime.availableReplicas,
        }
      : null,
    selectorText
      ? { key: "selector", label: "Selector", value: selectorText }
      : null,
    ownerControllers.length > 0
      ? {
          key: "owners",
          label: "上级控制器",
          value: `${ownerControllers.length} 项（见关系导航）`,
        }
      : null,
    ownedPods.length > 0
      ? {
          key: "ownedPods",
          label: "拥有 Pod",
          value: `${ownedPods.length} 项（见关系导航）`,
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    value: ReactNode;
  }>;

  return (
    <DetailSection
      title="ReplicaSet 高频区"
      subtitle="先看副本、Selector、上级控制器与拥有的 Pod"
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions items={items} emptyText="暂无 ReplicaSet 摘要" />
      </Space>
    </DetailSection>
  );
}

function JobHighlightsSection({ detail }: ResourceDetailRendererProps) {
  if (
    normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !==
    "job"
  ) {
    return null;
  }

  const overview = buildOverviewFieldMap(detail);
  const runtime = buildRuntimeFieldMap(detail.runtime);
  const ownedPods = detail.associations.filter(
    (item) => item.associationType === "owned-pod",
  );
  const ownerControllers = detail.associations.filter(
    (item) => item.associationType === "owner",
  );
  const metricHints = Object.entries(detail.metadata.annotations).filter(
    ([key]) => {
      const normalized = key.toLowerCase();
      return (
        normalized.includes("parallel") ||
        normalized.includes("complete") ||
        normalized.includes("backoff") ||
        normalized.includes("deadline")
      );
    },
  );

  const items = [
    overview.state
      ? { key: "state", label: "状态", value: overview.state }
      : null,
    runtime.replicas !== undefined
      ? { key: "active", label: "活跃副本", value: runtime.replicas }
      : null,
    runtime.readyReplicas !== undefined
      ? { key: "ready", label: "就绪副本", value: runtime.readyReplicas }
      : null,
    ownedPods.length > 0
      ? { key: "pods", label: "执行 Pod", value: ownedPods.length }
      : null,
    ownerControllers.length > 0
      ? { key: "owners", label: "上游控制器", value: ownerControllers.length }
      : null,
    metricHints.length > 0
      ? { key: "specHints", label: "调度/重试信号", value: metricHints.length }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    value: ReactNode;
  }>;

  return (
    <DetailSection
      title="Job 高频区"
      subtitle="先看执行状态、上游控制器、执行 Pod 与失败/重试信号"
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions items={items} emptyText="暂无 Job 摘要" />
      </Space>
    </DetailSection>
  );
}

function CronJobHighlightsSection({ detail }: ResourceDetailRendererProps) {
  if (
    normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !==
    "cronjob"
  ) {
    return null;
  }

  const ownerJobs = detail.associations.filter((item) => item.kind === "Job");
  const overview = buildOverviewFieldMap(detail);
  const scheduleHints = Object.entries(detail.metadata.annotations).filter(
    ([key]) => {
      const normalized = key.toLowerCase();
      return (
        normalized.includes("schedule") ||
        normalized.includes("cron") ||
        normalized.includes("suspend") ||
        normalized.includes("concurrency")
      );
    },
  );

  const items = [
    detail.overview.namespace
      ? {
          key: "namespace",
          label: "名称空间",
          value: detail.overview.namespace,
        }
      : null,
    overview.state
      ? { key: "state", label: "状态", value: overview.state }
      : null,
    ownerJobs.length > 0
      ? { key: "jobs", label: "已创建 Job", value: ownerJobs.length }
      : null,
    scheduleHints.length > 0
      ? { key: "scheduleHints", label: "调度信号", value: scheduleHints.length }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    value: ReactNode;
  }>;

  return (
    <DetailSection
      title="CronJob 高频区"
      subtitle="先看调度状态、已创建 Job 与调度信号"
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions items={items} emptyText="暂无 CronJob 摘要" />
      </Space>
    </DetailSection>
  );
}

function NamespaceHighlightsSection({ detail }: ResourceDetailRendererProps) {
  if (
    normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !==
    "namespace"
  ) {
    return null;
  }

  const relatedPolicies = detail.associations.filter(
    (item) => item.kind === "NetworkPolicy",
  );
  const relatedClaims = detail.associations.filter(
    (item) => item.kind === "PersistentVolumeClaim",
  );
  const relatedConfigs = detail.associations.filter((item) =>
    ["ConfigMap", "Secret", "ServiceAccount"].includes(item.kind),
  );

  const items = [
    { key: "namespace", label: "名称空间", value: detail.overview.name },
    detail.overview.state
      ? { key: "state", label: "状态", value: detail.overview.state }
      : null,
    relatedPolicies.length > 0
      ? {
          key: "policies",
          label: "NetworkPolicy",
          value: relatedPolicies.length,
        }
      : null,
    relatedClaims.length > 0
      ? { key: "claims", label: "PVC", value: relatedClaims.length }
      : null,
    relatedConfigs.length > 0
      ? { key: "configs", label: "配置对象", value: relatedConfigs.length }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    value: ReactNode;
  }>;

  return (
    <DetailSection
      title="Namespace 高频区"
      subtitle="先看状态、关键策略和主要配置对象"
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions items={items} emptyText="暂无 Namespace 摘要" />
        {relatedPolicies.length > 0 ||
        relatedClaims.length > 0 ||
        relatedConfigs.length > 0 ? (
          <div>
            <Typography.Text strong>关键资源分布</Typography.Text>
            <Space wrap size={8} style={{ marginTop: 8 }}>
              {relatedPolicies.length > 0 ? (
                <Tag color="purple">NetworkPolicy {relatedPolicies.length}</Tag>
              ) : null}
              {relatedClaims.length > 0 ? (
                <Tag color="gold">PVC {relatedClaims.length}</Tag>
              ) : null}
              {relatedConfigs.length > 0 ? (
                <Tag color="blue">配置对象 {relatedConfigs.length}</Tag>
              ) : null}
            </Space>
          </div>
        ) : null}
      </Space>
    </DetailSection>
  );
}

function HelmReleaseHighlightsSection({ detail }: ResourceDetailRendererProps) {
  if (
    normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !==
    "helmrelease"
  ) {
    return null;
  }

  const annotations = detail.metadata.annotations;
  const workloads = detail.associations.filter((item) =>
    ["Deployment", "StatefulSet", "DaemonSet", "Service", "Pod"].includes(
      item.kind,
    ),
  );
  const items = [
    annotations.chart
      ? { key: "chart", label: "Chart", value: annotations.chart }
      : null,
    annotations.appVersion
      ? {
          key: "appVersion",
          label: "App Version",
          value: annotations.appVersion,
        }
      : null,
    annotations.revision
      ? { key: "revision", label: "Revision", value: annotations.revision }
      : null,
    annotations.description
      ? { key: "description", label: "描述", value: annotations.description }
      : null,
    detail.overview.state
      ? { key: "state", label: "状态", value: detail.overview.state }
      : null,
    detail.overview.namespace
      ? {
          key: "namespace",
          label: "名称空间",
          value: detail.overview.namespace,
        }
      : null,
    workloads.length > 0
      ? {
          key: "workloads",
          label: "关联工作负载",
          value: `${workloads.length} 项（见关系导航）`,
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    value: ReactNode;
  }>;

  return (
    <DetailSection
      title="HelmRelease 高频区"
      subtitle="先看 Chart、版本、修订号与发布状态"
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions items={items} emptyText="暂无 HelmRelease 摘要" />
      </Space>
    </DetailSection>
  );
}

function HelmRepositoryHighlightsSection({ detail }: ResourceDetailRendererProps) {
  if (
    normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !==
    "helmrepository"
  ) {
    return null;
  }

  const annotations = detail.metadata.annotations;
  const releases = detail.associations.filter(
    (item) => item.kind === "HelmRelease",
  );
  const items = [
    annotations.url
      ? { key: "url", label: "URL", value: annotations.url }
      : null,
    annotations.authType
      ? { key: "authType", label: "认证方式", value: annotations.authType }
      : null,
    annotations.syncStatus
      ? { key: "syncStatus", label: "同步状态", value: annotations.syncStatus }
      : null,
    annotations.lastSyncAt
      ? { key: "lastSyncAt", label: "最近同步", value: annotations.lastSyncAt }
      : null,
    annotations.message
      ? { key: "message", label: "消息", value: annotations.message }
      : null,
    detail.overview.state
      ? { key: "state", label: "状态", value: detail.overview.state }
      : null,
    releases.length > 0
      ? { key: "releases", label: "关联 Release", value: releases.length }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    value: ReactNode;
  }>;

  return (
    <DetailSection
      title="HelmRepository 高频区"
      subtitle="先看仓库地址、同步状态与诊断消息"
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions
          items={items}
          emptyText="暂无 HelmRepository 摘要"
        />
      </Space>
    </DetailSection>
  );
}

function MiddlewareHighlightsSection({ detail }: ResourceDetailRendererProps) {
  if (
    normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !==
    "middleware"
  ) {
    return null;
  }

  const routes = detail.associations.filter(
    (item) => item.associationType === "route-middleware",
  );
  const annotationEntries = Object.entries(detail.metadata.annotations).slice(
    0,
    6,
  );

  const items = [
    detail.overview.namespace
      ? {
          key: "namespace",
          label: "名称空间",
          value: detail.overview.namespace,
        }
      : null,
    detail.overview.state
      ? { key: "state", label: "状态", value: detail.overview.state }
      : null,
    routes.length > 0
      ? {
          key: "routes",
          label: "关联 IngressRoute",
          value: `${routes.length} 项（见关系导航）`,
        }
      : null,
    annotationEntries.length > 0
      ? {
          key: "signals",
          label: "配置/诊断信号",
          value: annotationEntries.length,
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    value: ReactNode;
  }>;

  return (
    <DetailSection
      title="Middleware 高频区"
      subtitle="先看被哪些 IngressRoute 引用，以及关键配置/诊断信号"
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions items={items} emptyText="暂无 Middleware 摘要" />
      </Space>
    </DetailSection>
  );
}

function ServiceHighlightsSection({
  detail,
}: ResourceDetailRendererProps) {
  if (
    normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !==
    "service"
  ) {
    return null;
  }

  const servicePorts = detail.network.endpoints.filter(
    (item) => item.kind === "service-port" && !item.sourceKind,
  );
  const endpointTargets = detail.network.endpoints.filter(
    (item) =>
      item.sourceKind === "Endpoints" || item.sourceKind === "EndpointSlice",
  );
  const selectorText =
    detail.network.service?.selector ??
    formatStringMap(detail.metadata.labels) ??
    "";

  return (
    <DetailSection
      title="Service 高频区"
      subtitle="类型、ClusterIP、端口、Selector 与后端"
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions
          items={
            [
              detail.network.service?.type
                ? {
                    key: "type",
                    label: "类型",
                    value: detail.network.service.type,
                  }
                : null,
              detail.network.clusterIPs.length > 0
                ? {
                    key: "clusterIPs",
                    label: "Cluster IP",
                    value: detail.network.clusterIPs.join(", "),
                  }
                : null,
              selectorText
                ? { key: "selector", label: "Selector", value: selectorText }
                : null,
              detail.network.service?.externalIPs?.length
                ? {
                    key: "externalIPs",
                    label: "External IP",
                    value: detail.network.service.externalIPs.join(", "),
                  }
                : null,
              detail.network.service?.sessionAffinity
                ? {
                    key: "sessionAffinity",
                    label: "会话亲和",
                    value: detail.network.service.sessionAffinity,
                  }
                : null,
              detail.network.service?.externalTrafficPolicy
                ? {
                    key: "externalTrafficPolicy",
                    label: "外部流量策略",
                    value: detail.network.service.externalTrafficPolicy,
                  }
                : null,
              servicePorts.length > 0
                ? {
                    key: "ports",
                    label: "端口",
                    value: servicePorts
                      .flatMap((item) => item.ports ?? [])
                      .map(
                        (port) =>
                          `${port.protocol ?? "TCP"} ${port.port}${port.targetPort ? ` -> ${port.targetPort}` : ""}`,
                      )
                      .join(" · "),
                  }
                : null,
              endpointTargets.length > 0
                ? {
                    key: "backendTargets",
                    label: "后端目标",
                    value: `${endpointTargets.length} 项（见关系导航）`,
                  }
                : null,
            ].filter(Boolean) as Array<{
              key: string;
              label: string;
              value: ReactNode;
            }>
          }
          emptyText="暂无 Service 摘要"
        />
      </Space>
    </DetailSection>
  );
}

function NetworkPolicyHighlightsSection({
  detail,
}: ResourceDetailRendererProps) {
  if (
    normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !==
    "network-policy"
  ) {
    return null;
  }
  const policyTypes = detail.runtime.policyTypes ?? [];
  const ingressRules = detail.runtime.ingressRules ?? [];
  const egressRules = detail.runtime.egressRules ?? [];
  const podSelector = detail.runtime.podSelector;
  const relatedPods = detail.associations.filter((item) => item.kind === "Pod");

  const summaryItems = [
    {
      key: "scope",
      label: "作用域",
      value: detail.overview.namespace
        ? `名称空间 ${detail.overview.namespace}`
        : "集群级",
    },
    policyTypes.length > 0
      ? {
          key: "types",
          label: "策略类型",
          value: <TagList items={policyTypes} color="blue" />,
        }
      : null,
    podSelector
      ? { key: "selector", label: "Pod Selector", value: podSelector }
      : null,
    { key: "ingress", label: "Ingress 规则", value: ingressRules.length },
    { key: "egress", label: "Egress 规则", value: egressRules.length },
    relatedPods.length > 0
      ? {
          key: "pods",
          label: "影响 Pod",
          value: `${relatedPods.length} 项（见关系导航）`,
        }
      : null,
  ];

  const renderRules = (
    title: string,
    rules: Array<{
      peers?: Array<{
        namespaceSelector?: string;
        podSelector?: string;
        ipBlock?: string;
      }>;
      ports?: Array<{ protocol?: string; port?: string }>;
    }>,
  ) => {
    if (rules.length === 0) {
      return null;
    }
    return (
      <div>
        <Typography.Text strong>{title}</Typography.Text>
        <SimpleList
          items={rules}
          renderItem={(rule, index) => (
            <SimpleListItem>
              <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                <Typography.Text
                  strong
                >{`${title} #${index + 1}`}</Typography.Text>
                <Space wrap size={8}>
                  {(rule.peers ?? []).flatMap((peer) => {
                    const tags = [];
                    if (peer.namespaceSelector) {
                      tags.push(
                        <Tag
                          color="purple"
                          key={`ns-${index}-${peer.namespaceSelector}`}
                        >
                          NS: {peer.namespaceSelector}
                        </Tag>,
                      );
                    }
                    if (peer.podSelector) {
                      tags.push(
                        <Tag
                          color="cyan"
                          key={`pod-${index}-${peer.podSelector}`}
                        >
                          Pod: {peer.podSelector}
                        </Tag>,
                      );
                    }
                    if (peer.ipBlock) {
                      tags.push(
                        <Tag color="gold" key={`ip-${index}-${peer.ipBlock}`}>
                          IPBlock: {peer.ipBlock}
                        </Tag>,
                      );
                    }
                    return tags;
                  })}
                  {(rule.ports ?? []).map((port, portIndex) => (
                    <Tag color="blue" key={`port-${index}-${portIndex}`}>
                      {port.protocol ?? "TCP"} {port.port ?? "-"}
                    </Tag>
                  ))}
                </Space>
              </Space>
            </SimpleListItem>
          )}
        />
      </div>
    );
  };

  return (
    <DetailSection
      title="NetworkPolicy 高频区"
      subtitle="先看作用对象、策略类型与 Ingress/Egress 规则"
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions
          items={
            summaryItems.filter(Boolean) as Array<{
              key: string;
              label: string;
              value: ReactNode;
            }>
          }
          emptyText="暂无 NetworkPolicy 摘要"
        />
        {renderRules("Ingress", ingressRules)}
        {renderRules("Egress", egressRules)}
      </Space>
    </DetailSection>
  );
}

function StorageHighlightsSection({
  detail,
}: ResourceDetailRendererProps) {
  const kind = normalizeKind(
    detail.descriptor.resourceKind || detail.overview.kind,
  );
  if (
    !["persistentvolume", "persistentvolumeclaim", "storageclass"].includes(
      kind,
    )
  ) {
    return null;
  }

  const pvc = detail.storage.persistentVolumeClaims[0];
  const pv = detail.storage.persistentVolumes[0];
  const storageClassDetail = detail.storage.storageClassDetails[0];
  const storageClasses = detail.storage.storageClasses;

  const summaryItems = [
    kind === "persistentvolume" && pv
      ? {
          key: "pvPhase",
          label: "卷状态",
          value: pv.phase ?? detail.overview.state,
        }
      : null,
    kind === "persistentvolume" && pv?.storageClass
      ? { key: "pvStorageClass", label: "StorageClass", value: pv.storageClass }
      : null,
    kind === "persistentvolume" && pv?.capacity
      ? { key: "pvCapacity", label: "容量", value: pv.capacity }
      : null,
    kind === "persistentvolume" && pv?.accessModes?.length
      ? {
          key: "pvAccessModes",
          label: "访问模式",
          value: pv.accessModes.join(", "),
        }
      : null,
    kind === "persistentvolume" && pv?.reclaimPolicy
      ? { key: "pvReclaim", label: "回收策略", value: pv.reclaimPolicy }
      : null,
    kind === "persistentvolume" && pv?.claimRef
      ? { key: "pvClaimRef", label: "绑定 Claim", value: pv.claimRef }
      : null,
    kind === "persistentvolumeclaim" && pvc
      ? {
          key: "pvcPhase",
          label: "Claim 状态",
          value: pvc.phase ?? detail.overview.state,
        }
      : null,
    kind === "persistentvolumeclaim" && pvc?.storageClass
      ? {
          key: "pvcStorageClass",
          label: "StorageClass",
          value: pvc.storageClass,
        }
      : null,
    kind === "persistentvolumeclaim" && pvc?.volumeName
      ? { key: "boundPv", label: "绑定 PV", value: pvc.volumeName }
      : null,
    kind === "persistentvolumeclaim" && pvc?.capacity
      ? { key: "pvcCapacity", label: "容量", value: pvc.capacity }
      : null,
    kind === "persistentvolumeclaim" && pvc?.accessModes?.length
      ? {
          key: "pvcAccessModes",
          label: "访问模式",
          value: pvc.accessModes.join(", "),
        }
      : null,
    kind === "storageclass" && storageClasses.length > 0
      ? { key: "scName", label: "StorageClass", value: storageClasses[0] }
      : null,
    kind === "storageclass" && storageClassDetail?.provisioner
      ? {
          key: "provisioner",
          label: "Provisioner",
          value: storageClassDetail.provisioner,
        }
      : null,
    kind === "storageclass" && storageClassDetail?.bindingMode
      ? {
          key: "bindingMode",
          label: "绑定模式",
          value: storageClassDetail.bindingMode,
        }
      : null,
    kind === "storageclass" && storageClassDetail?.reclaimPolicy
      ? {
          key: "reclaimPolicy",
          label: "回收策略",
          value: storageClassDetail.reclaimPolicy,
        }
      : null,
    kind === "storageclass" &&
    storageClassDetail?.allowVolumeExpansion !== undefined
      ? {
          key: "allowVolumeExpansion",
          label: "允许扩容",
          value: storageClassDetail.allowVolumeExpansion ? "是" : "否",
        }
      : null,
    detail.storage.storagePipelines.length > 0
      ? {
          key: "pipelines",
          label: "存储路径",
          value: detail.storage.storagePipelines.length,
        }
      : null,
    detail.storage.volumes.length > 0
      ? {
          key: "volumes",
          label: "卷定义",
          value: detail.storage.volumes.length,
        }
      : null,
    detail.storage.mounts.length > 0
      ? { key: "mounts", label: "挂载点", value: detail.storage.mounts.length }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    value: ReactNode;
  }>;

  return (
    <DetailSection
      title="存储高频区"
      subtitle="先看绑定关系、StorageClass 与挂载"
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions items={summaryItems} emptyText="暂无存储高频摘要" />
      </Space>
    </DetailSection>
  );
}

function ConfigHighlightsSection({
  detail,
}: ResourceDetailRendererProps) {
  const kind = normalizeKind(
    detail.descriptor.resourceKind || detail.overview.kind,
  );
  if (!["configmap", "secret", "serviceaccount"].includes(kind)) {
    return null;
  }

  const relatedConfigs = detail.associations.filter((item) =>
    ["uses-configmap", "uses-secret", "secret-ref"].includes(
      item.associationType,
    ),
  );
  const ownedPods = detail.associations.filter(
    (item) => item.associationType === "owned-pod",
  );
  const imagePullSecrets = Object.entries(detail.metadata.annotations).filter(
    ([key]) => key.toLowerCase().includes("imagepullsecret"),
  );
  const matrixRows = detail.metadata.configUsages.filter((item) => {
    if (normalizeKind(item.referencedKind) !== kind) return false;
    if (item.referencedName !== detail.overview.name) return false;
    if (
      detail.overview.namespace &&
      item.referencedNamespace &&
      item.referencedNamespace !== detail.overview.namespace
    )
      return false;
    return true;
  });

  const summaryItems = [
    kind === "configmap"
      ? { key: "kind", label: "类型", value: "ConfigMap" }
      : null,
    kind === "secret" ? { key: "kind", label: "类型", value: "Secret" } : null,
    kind === "serviceaccount"
      ? { key: "kind", label: "类型", value: "ServiceAccount" }
      : null,
    {
      key: "labels",
      label: "标签数",
      value: Object.keys(detail.metadata.labels).length,
    },
    {
      key: "annotations",
      label: "注解数",
      value: Object.keys(detail.metadata.annotations).length,
    },
    matrixRows.length > 0 || detail.metadata.configUsages.length > 0
      ? {
          key: "matrixRows",
          label: "引用关系",
          value: `${matrixRows.length || detail.metadata.configUsages.length} 项（见关系导航）`,
        }
      : relatedConfigs.length > 0
        ? {
            key: "refs",
            label: "关联引用",
            value: `${relatedConfigs.length} 项（见关系导航）`,
          }
        : null,
    ownedPods.length > 0
      ? {
          key: "pods",
          label: "关联 Pod",
          value: `${ownedPods.length} 项（见关系导航）`,
        }
      : null,
    imagePullSecrets.length > 0
      ? {
          key: "pullSecrets",
          label: "拉取凭据",
          value: imagePullSecrets.length,
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    value: ReactNode;
  }>;

  return (
    <DetailSection
      title="配置高频区"
      subtitle="先看引用关系、注解信号与关联工作负载"
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions items={summaryItems} emptyText="暂无配置高频摘要" />
        {imagePullSecrets.length > 0 ? (
          <div>
            <Typography.Text strong>拉取凭据提示</Typography.Text>
            <div style={{ marginTop: 8 }}>
              <DetailDescriptions
                items={imagePullSecrets.map(([key, value]) => ({
                  key,
                  label: key,
                  value,
                }))}
              />
            </div>
          </div>
        ) : null}
      </Space>
    </DetailSection>
  );
}

function GatewayClassHighlightsSection({ detail }: ResourceDetailRendererProps) {
  if (
    normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !==
    "gatewayclass"
  ) {
    return null;
  }

  const spec =
    detail.metadata.annotations["gateway.networking.k8s.io/controller-name"] ??
    "";
  const gateways = detail.associations.filter(
    (item) => item.kind === "Gateway",
  );

  return (
    <DetailSection
      title="GatewayClass 高频区"
      subtitle="先看控制器、状态条件与关联 Gateway"
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions
          items={
            [
              detail.overview.kind
                ? { key: "kind", label: "Kind", value: detail.overview.kind }
                : null,
              spec
                ? { key: "controller", label: "Controller", value: spec }
                : null,
              detail.runtime.phase
                ? { key: "phase", label: "阶段", value: detail.runtime.phase }
                : null,
                  gateways.length > 0
                    ? {
                        key: "gateways",
                        label: "关联 Gateway",
                        value: `${gateways.length} 项（见关系导航）`,
                      }
                    : null,
            ].filter(Boolean) as Array<{
              key: string;
              label: string;
              value: ReactNode;
            }>
          }
          emptyText="暂无 GatewayClass 摘要"
        />
        {renderConditionsSection(detail.runtime.conditions)}
      </Space>
    </DetailSection>
  );
}

function GatewayHighlightsSection({ detail }: ResourceDetailRendererProps) {
  if (
    normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !==
    "gateway"
  ) {
    return null;
  }

  const listenerNames = detail.network.endpoints
    .filter((item) => item.kind === "gateway-listener")
    .map((item) => item.name);
  const routeNames = detail.network.endpoints
    .filter((item) => item.kind === "gateway-route")
    .map((item) => item.name);
  const listenerEndpoints = detail.network.endpoints.filter(
    (item) => item.kind === "gateway-listener",
  );
  const hostnameCount = detail.network.endpoints.filter(
    (item) => item.kind === "gateway-listener" && item.hostname,
  ).length;
  const allowedRoutesFrom = Array.from(
    new Set(
      listenerEndpoints.flatMap((item) =>
        item.allowedRoutesFrom ? [item.allowedRoutesFrom] : [],
      ),
    ),
  );

  return (
    <DetailSection
      title="Gateway 高频区"
      subtitle="先看监听器、允许路由、地址和状态条件"
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions
          items={
            [
              detail.overview.namespace
                ? {
                    key: "namespace",
                    label: "名称空间",
                    value: detail.overview.namespace,
                  }
                : null,
              listenerNames.length > 0
                ? {
                    key: "listeners",
                    label: "监听器",
                    value: <TagList items={listenerNames} color="blue" />,
                  }
                : null,
              hostnameCount > 0
                ? { key: "hostnames", label: "Hostname", value: hostnameCount }
                : null,
              allowedRoutesFrom.length > 0
                ? {
                    key: "allowedRoutes",
                    label: "允许路由方式",
                    value: <TagList items={allowedRoutesFrom} color="gold" />,
                  }
                : null,
              routeNames.length > 0
                ? {
                    key: "routes",
                    label: "路由",
                    value: <TagList items={routeNames} color="cyan" />,
                  }
                : null,
              detail.runtime.phase
                ? { key: "phase", label: "阶段", value: detail.runtime.phase }
                : null,
            ].filter(Boolean) as Array<{
              key: string;
              label: string;
              value: ReactNode;
            }>
          }
          emptyText="暂无 Gateway 摘要"
        />
        {renderConditionsSection(detail.runtime.conditions)}
        {listenerEndpoints.length > 0 ? (
          <div>
            <Typography.Text strong>监听器明细</Typography.Text>
            <SimpleList
              items={listenerEndpoints}
              renderItem={(item, index) => (
                <SimpleListItem>
                  <Space
                    orientation="vertical"
                    size={4}
                    style={{ width: "100%" }}
                  >
                    <Space wrap size={8}>
                      <Tag color="blue">
                        {item.name || `Listener ${index + 1}`}
                      </Tag>
                      {item.hostname ? (
                        <Tag color="green">{item.hostname}</Tag>
                      ) : null}
                      {item.allowedRoutesFrom ? (
                        <Tag color="gold">
                          允许路由: {item.allowedRoutesFrom}
                        </Tag>
                      ) : null}
                      {(item.ports ?? []).map((port, portIndex) => (
                        <Tag color="cyan" key={`${item.name}-${portIndex}`}>
                          {formatEndpointPortLabel(port)}
                        </Tag>
                      ))}
                    </Space>
                  </Space>
                </SimpleListItem>
              )}
            />
          </div>
        ) : null}
      </Space>
    </DetailSection>
  );
}

function AutoscalingHighlightsSection({ detail }: ResourceDetailRendererProps) {
  const kind = normalizeKind(
    detail.descriptor.resourceKind || detail.overview.kind,
  );
  if (!["horizontalpodautoscaler", "verticalpodautoscaler"].includes(kind)) {
    return null;
  }

  const targetWorkloads = detail.associations.filter((item) =>
    ["scales", "targets", "target-ref", "controls"].includes(
      item.associationType,
    ),
  );
  const observedPods = detail.associations.filter(
    (item) => item.kind === "Pod",
  );
  const metricHints = Object.entries(detail.metadata.annotations).filter(
    ([key]) => {
      const normalized = key.toLowerCase();
      return (
        normalized.includes("metric") ||
        normalized.includes("recommend") ||
        normalized.includes("autoscal")
      );
    },
  );
  const conditions = detail.runtime.conditions ?? [];
  const overview = buildOverviewFieldMap(detail);
  const runtime = buildRuntimeFieldMap(detail.runtime);

  const summaryItems = [
    detail.overview.namespace
      ? {
          key: "namespace",
          label: "名称空间",
          value: detail.overview.namespace,
        }
      : null,
    runtime.replicas !== undefined
      ? { key: "replicas", label: "当前副本", value: runtime.replicas }
      : null,
    runtime.readyReplicas !== undefined
      ? { key: "ready", label: "就绪副本", value: runtime.readyReplicas }
      : null,
    runtime.availableReplicas !== undefined
      ? {
          key: "available",
          label: "可用副本",
          value: runtime.availableReplicas,
        }
      : null,
    overview.state
      ? { key: "state", label: "状态", value: overview.state }
      : null,
    kind === "horizontalpodautoscaler"
      ? { key: "type", label: "类型", value: "HPA" }
      : { key: "type", label: "类型", value: "VPA" },
    targetWorkloads.length > 0
      ? {
          key: "targets",
          label: "目标工作负载",
          value: `${targetWorkloads.length} 项（见关系导航）`,
        }
      : null,
    observedPods.length > 0
      ? {
          key: "pods",
          label: "观测 Pod",
          value: `${observedPods.length} 项（见关系导航）`,
        }
      : null,
    metricHints.length > 0
      ? { key: "metrics", label: "指标/建议", value: metricHints.length }
      : null,
    conditions.length > 0
      ? { key: "conditions", label: "条件数", value: conditions.length }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    value: ReactNode;
  }>;

  return (
    <DetailSection
      title="伸缩高频区"
      subtitle="先看目标工作负载、副本状态与指标/建议信号"
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions items={summaryItems} emptyText="暂无伸缩高频摘要" />

        {metricHints.length > 0 ? (
          <div>
            <Typography.Text strong>指标/建议信号</Typography.Text>
            <div style={{ marginTop: 8 }}>
              <DetailDescriptions
                items={metricHints.map(([key, value]) => ({
                  key,
                  label: key,
                  value: (
                    <Typography.Paragraph
                      style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}
                    >
                      {value}
                    </Typography.Paragraph>
                  ),
                }))}
              />
            </div>
          </div>
        ) : null}
        {renderConditionsSection(conditions)}
      </Space>
    </DetailSection>
  );
}
type RelationshipNode = {
  kind?: string;
  name?: string;
  namespace?: string;
  id?: string;
  color: string;
};

type RelationshipItem = {
  key: string;
  title: string;
  subtitle?: string;
  tags?: Array<{ label: string; color?: string }>;
  chain: RelationshipNode[];
};

const RELATIONSHIP_GROUP_META = {
  control: {
    title: "控制关系",
    description: "Owner、控制器与被控制对象",
  },
  network: {
    title: "网络关系",
    description: "入口、服务、端点与后端 Pod/IP",
  },
  storage: {
    title: "存储关系",
    description: "容器挂载、Volume、PVC、PV 与 StorageClass",
  },
  config: {
    title: "配置关系",
    description: "ConfigMap、Secret、ServiceAccount 与使用方",
  },
  other: {
    title: "其他关系",
    description: "未归类但可导航的关联资源",
  },
} as const;

type RelationshipGroupKey = keyof typeof RELATIONSHIP_GROUP_META;

function relationshipNodeKey(node: RelationshipNode) {
  return `${normalizeKind(node.kind ?? "object")}:${node.namespace ?? "_cluster"}:${node.name ?? "_"}:${node.id ?? "_"}`;
}

function addRelationshipItem(
  groups: Map<RelationshipGroupKey, RelationshipItem[]>,
  seen: Set<string>,
  group: RelationshipGroupKey,
  item: RelationshipItem,
) {
  const key =
    item.key ||
    `${group}:${item.chain.map(relationshipNodeKey).join("->")}:${item.subtitle ?? ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  groups.set(group, [...(groups.get(group) ?? []), { ...item, key }]);
}

function buildRelationshipGroups(
  detail: ResourceDetailRendererProps["detail"],
): Array<{ key: RelationshipGroupKey; items: RelationshipItem[] }> {
  if (detail.relationships.length > 0) {
    const backendGroups: Array<{
      key: RelationshipGroupKey;
      items: RelationshipItem[];
    }> = [];
    detail.relationships.forEach((group) => {
      if (!(group.key in RELATIONSHIP_GROUP_META) || group.items.length === 0) {
        return;
      }
      backendGroups.push({
        key: group.key,
        items: group.items.map((item) => ({
          key: item.key,
          title: item.title,
          subtitle: item.subtitle,
          tags: item.tags,
          chain: item.chain.map((node) => ({
            kind: node.kind,
            name: node.name,
            namespace: node.namespace,
            id: node.id,
            color: node.color ?? "default",
          })),
        })),
      });
    });
    return backendGroups;
  }

  const groups = new Map<RelationshipGroupKey, RelationshipItem[]>();
  const seen = new Set<string>();

  const addAssociation = (item: ResourceAssociation) => {
    const group =
      item.associationType === "owner" || item.associationType === "owned-pod"
        ? "control"
        : ASSOCIATION_GROUPS.find((candidate) =>
              candidate.types.has(item.associationType),
            )?.key ?? "other";
    addRelationshipItem(groups, seen, group as RelationshipGroupKey, {
      key: `assoc:${item.associationType}:${item.kind}:${item.namespace ?? "_cluster"}:${item.name}:${item.id ?? "_"}`,
      title:
        ASSOCIATION_TYPE_META[item.associationType]?.label ??
        item.associationType,
      subtitle: item.namespace ? `名称空间 ${item.namespace}` : "集群级资源",
      tags: [
        {
          label:
            ASSOCIATION_TYPE_META[item.associationType]?.label ??
            item.associationType,
          color: ASSOCIATION_TYPE_META[item.associationType]?.color,
        },
      ],
      chain: [
        {
          kind: item.kind,
          name: item.name,
          namespace: item.namespace,
          id: item.id,
          color:
            ASSOCIATION_TYPE_META[item.associationType]?.color ?? "geekblue",
        },
      ],
    });
  };

  detail.associations.forEach(addAssociation);

  detail.network.networkPipelines.forEach((item, index) => {
    const chain: RelationshipNode[] = [
      {
        kind: item.sourceKind,
        name: item.sourceName,
        namespace: item.sourceNamespace,
        id: item.sourceId,
        color: "green",
      },
      {
        kind: "Service",
        name: item.serviceName,
        namespace: item.serviceNamespace,
        id: item.serviceId,
        color: "blue",
      },
      {
        kind: item.endpointSourceKind || "Endpoint",
        name: item.endpointSourceName,
        namespace: item.serviceNamespace,
        id: item.endpointSourceId,
        color: item.endpointSourceKind === "EndpointSlice" ? "volcano" : "gold",
      },
      {
        kind: item.backendPodName ? "Pod" : "Pod/IP",
        name: item.backendPodName ?? item.ip,
        namespace: item.backendPodNamespace,
        id: item.backendPodId,
        color: "cyan",
      },
    ].filter((node) => node.kind || node.name);

    addRelationshipItem(groups, seen, "network", {
      key: `network:${item.sourceKind}:${item.sourceNamespace ?? ""}:${item.sourceName}:${item.serviceNamespace ?? ""}:${item.serviceName ?? ""}:${item.endpointSourceName ?? ""}:${item.backendPodName ?? item.ip ?? index}`,
      title: "网络路径",
      subtitle: [item.host, item.path, item.port ? `port ${item.port}` : null]
        .filter(Boolean)
        .join(" · "),
      tags: [
        ...(item.servicePort ? [{ label: `svc ${item.servicePort}` }] : []),
        ...(item.ready !== undefined
          ? [{ label: item.ready ? "Ready" : "NotReady", color: item.ready ? "success" : "warning" }]
          : []),
      ],
      chain,
    });
  });

  detail.storage.storagePipelines.forEach((item, index) => {
    addRelationshipItem(groups, seen, "storage", {
      key: `storage:${item.container}:${item.mountPath}:${item.volumeName ?? ""}:${item.pvcNamespace ?? ""}:${item.pvcName ?? ""}:${item.pvName ?? ""}:${item.storageClass ?? ""}:${index}`,
      title: "存储路径",
      subtitle: [item.mountPath, item.readOnly ? "只读" : null]
        .filter(Boolean)
        .join(" · "),
      tags: [
        ...(item.volumeType ? [{ label: item.volumeType }] : []),
        ...(item.pvcPhase ? [{ label: item.pvcPhase, color: "cyan" }] : []),
        ...(item.pvPhase ? [{ label: item.pvPhase, color: "blue" }] : []),
      ],
      chain: [
        {
          kind: "Container",
          name: item.container,
          color: "geekblue",
        },
        {
          kind: "Volume",
          name: item.volumeName,
          color: "default",
        },
        {
          kind: "PersistentVolumeClaim",
          name: item.pvcName,
          namespace: item.pvcNamespace ?? detail.overview.namespace,
          color: "cyan",
        },
        {
          kind: "PersistentVolume",
          name: item.pvName,
          color: "blue",
        },
        {
          kind: "StorageClass",
          name: item.storageClass,
          color: "gold",
        },
      ].filter((node) => node.name),
    });
  });

  detail.metadata.configUsages.forEach((item, index) => {
    addRelationshipItem(groups, seen, "config", {
      key: `config:${item.referencedKind}:${item.referencedNamespace ?? ""}:${item.referencedName}:${item.consumerKind}:${item.consumerNamespace ?? ""}:${item.consumerName}:${item.usageType}:${item.container ?? ""}:${item.mountPath ?? ""}:${item.key ?? ""}:${index}`,
      title: "配置引用",
      subtitle: [item.container, item.mountPath, item.key ? `key ${item.key}` : null]
        .filter(Boolean)
        .join(" · "),
      tags: [
        {
          label: CONFIG_USAGE_META[item.usageType]?.label ?? item.usageType,
          color: CONFIG_USAGE_META[item.usageType]?.color,
        },
      ],
      chain: [
        {
          kind: item.referencedKind,
          name: item.referencedName,
          namespace: item.referencedNamespace,
          id: item.referencedId,
          color:
            normalizeKind(item.referencedKind) === "secret"
              ? "magenta"
              : "blue",
        },
        {
          kind: item.consumerKind,
          name: item.consumerName,
          namespace: item.consumerNamespace,
          id: item.consumerId,
          color: "geekblue",
        },
      ],
    });
  });

  return (Object.keys(RELATIONSHIP_GROUP_META) as RelationshipGroupKey[])
    .map((key) => ({ key, items: groups.get(key) ?? [] }))
    .filter((group) => group.items.length > 0);
}

function RelationshipNavigatorSection({
  detail,
  onNavigateRequest,
}: ResourceDetailRendererProps) {
  const groups = useMemo(() => buildRelationshipGroups(detail), [detail]);
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <DetailSection
      title="关系导航"
      subtitle="网络、存储、配置与控制关系已合并去重；点击资源可切换详情"
      extra={
        total > 0 ? (
          <Typography.Text type="secondary">{total} 条关系</Typography.Text>
        ) : undefined
      }
    >
      {groups.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联资源" />
      ) : (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          {groups.map((group) => {
            const meta = RELATIONSHIP_GROUP_META[group.key];
            return (
              <div key={group.key}>
                <Space size={8} wrap style={{ marginBottom: 8 }}>
                  <Typography.Text strong>{meta.title}</Typography.Text>
                  <Typography.Text type="secondary">
                    {meta.description}
                  </Typography.Text>
                  <Tag>{group.items.length}</Tag>
                </Space>
                <LimitedList
                  items={group.items}
                  renderItem={(item) => (
                    <SimpleListItem>
                      <Space orientation="vertical" size={6} style={{ width: "100%" }}>
                        <Space wrap size={[6, 6]}>
                          <Typography.Text strong>{item.title}</Typography.Text>
                          {(item.tags ?? []).map((tag, index) => (
                            <Tag key={`${item.key}-tag-${index}`} color={tag.color}>
                              {tag.label}
                            </Tag>
                          ))}
                        </Space>
                        <Space wrap size={[6, 6]}>
                          {item.chain.map((node, index) => (
                            <Fragment key={`${item.key}-node-${index}`}>
                              {index > 0 ? (
                                <Typography.Text type="secondary">→</Typography.Text>
                              ) : null}
                              {renderPipelineObject(
                                detail,
                                node.kind,
                                node.name,
                                node.namespace,
                                node.id,
                                node.color,
                                onNavigateRequest,
                              )}
                            </Fragment>
                          ))}
                        </Space>
                        {item.subtitle ? (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {item.subtitle}
                          </Typography.Text>
                        ) : null}
                      </Space>
                    </SimpleListItem>
                  )}
                />
              </div>
            );
          })}
        </Space>
      )}
    </DetailSection>
  );
}
function HttpRouteHighlightsSection({ detail }: ResourceDetailRendererProps) {
  if (
    normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !==
    "httproute"
  ) {
    return null;
  }

  const parentRefs = detail.associations.filter(
    (item) => item.associationType === "owner",
  );
  const backendRefs = detail.associations.filter((item) =>
    [
      "backend-service",
      "routes-to-service",
      "traefik-routes-to-service",
    ].includes(item.associationType),
  );

  return (
    <DetailSection
      title="HTTPRoute 高频区"
      subtitle="先看父引用、后端引用和状态条件"
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions
          items={
            [
              detail.overview.namespace
                ? {
                    key: "namespace",
                    label: "名称空间",
                    value: detail.overview.namespace,
                  }
                : null,
              parentRefs.length > 0
                ? {
                    key: "parents",
                    label: "父引用",
                    value: `${parentRefs.length} 项（见关系导航）`,
                  }
                : null,
              backendRefs.length > 0
                ? {
                    key: "backend",
                    label: "后端引用",
                    value: `${backendRefs.length} 项（见关系导航）`,
                  }
                : null,
              detail.runtime.phase
                ? { key: "phase", label: "阶段", value: detail.runtime.phase }
                : null,
            ].filter(Boolean) as Array<{
              key: string;
              label: string;
              value: ReactNode;
            }>
          }
          emptyText="暂无 HTTPRoute 摘要"
        />
        {renderConditionsSection(detail.runtime.conditions)}
      </Space>
    </DetailSection>
  );
}

function EventsSection({ detail }: ResourceDetailRendererProps) {
  const toEventText = (item: ResourceDetailEvent, keys: string[]) => {
    for (const key of keys) {
      const value = getEventValue(item, key);
      if (value !== null && value !== undefined && String(value).trim()) {
        return String(value);
      }
    }
    return undefined;
  };
  const renderEventType = (item: ResourceDetailEvent) => {
    const type = toEventText(item, ["type", "eventType"]) ?? "Normal";
    const normalized = type.toLowerCase();
    const color =
      normalized.includes("warn") ||
      normalized.includes("fail") ||
      normalized.includes("error")
        ? "error"
        : normalized.includes("normal")
          ? "success"
          : "default";
    return <Tag color={color}>{type}</Tag>;
  };
  const renderObjectRef = (
    ref?: ResourceDetailEvent["involvedObject"],
    prefix = "对象",
  ) => {
    if (!ref || (!ref.kind && !ref.name)) {
      return null;
    }
    return (
      <Tag color="blue">
        {prefix} {ref.kind ? `${ref.kind}/` : ""}
        {ref.namespace ? `${ref.namespace}/` : ""}
        {ref.name ?? "-"}
        {ref.fieldPath ? ` · ${ref.fieldPath}` : ""}
      </Tag>
    );
  };

  return (
    <DetailSection
      title="事件"
      subtitle="按 Type / Reason / Message / Count / Last Seen / Source 展示"
      extra={
        detail.events.items.length > 0 ? (
          <Typography.Text type="secondary">
            {detail.events.items.length} 条事件
          </Typography.Text>
        ) : undefined
      }
    >
      {detail.events.items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无事件" />
      ) : (
        <SimpleList
          items={detail.events.items}
          renderItem={(item, index) => (
            <SimpleListItem>
              <Space orientation="vertical" size={6} style={{ width: "100%" }}>
                <Space wrap size={[6, 6]}>
                  {renderEventType(item)}
                  <Typography.Text strong>
                    {toEventText(item, ["reason", "name"]) ??
                      `事件 ${index + 1}`}
                  </Typography.Text>
                  {toEventText(item, ["count", "series.count"]) ? (
                    <Tag>{`Count ${toEventText(item, ["count", "series.count"])}`}</Tag>
                  ) : null}
                  {toEventText(item, [
                    "lastTimestamp",
                    "eventTime",
                    "lastSeen",
                    "metadata.creationTimestamp",
                  ]) ? (
                    <Typography.Text type="secondary">
                      {formatDateTime(
                        toEventText(item, [
                          "lastTimestamp",
                          "eventTime",
                          "lastSeen",
                          "metadata.creationTimestamp",
                        ]),
                      )}
                    </Typography.Text>
                  ) : null}
                  {renderObjectRef(item.involvedObject)}
                  {renderObjectRef(item.related, "关联")}
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {[
                    toEventText(item, ["message", "note"]),
                    toEventText(item, ["action"]),
                    toEventText(item, [
                      "source",
                      "reportingComponent",
                      "reportingInstance",
                    ]),
                    toEventText(item, ["sourceHost"]),
                  ]
                    .filter(Boolean)
                    .map((part) => String(part))
                    .join(" · ")}
                </Typography.Text>
              </Space>
            </SimpleListItem>
          )}
        />
      )}
    </DetailSection>
  );
}

function getEventValue(item: ResourceDetailEvent, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[part];
  }, item);
}

function MetadataSection({
  detail,
}: ResourceDetailRendererProps) {
  const metadataSummary = [
    detail.metadata.ownerReferences.length > 0
      ? {
          key: "ownerReferences",
          label: "Owner References",
          value: `${detail.metadata.ownerReferences.length} 项（见关系导航）`,
        }
      : null,
    Object.keys(detail.metadata.labels).length > 0
      ? {
          key: "labelsCount",
          label: "Labels 数量",
          value: Object.keys(detail.metadata.labels).length,
        }
      : null,
    Object.keys(detail.metadata.annotations).length > 0
      ? {
          key: "annotationsCount",
          label: "Annotations 数量",
          value: Object.keys(detail.metadata.annotations).length,
        }
      : null,
  ].filter(Boolean) as Array<{ key: string; label: string; value: ReactNode }>;

  return (
    <DetailSection title="元数据" subtitle="标签、注解与来源摘要">
      {!hasMetadataContent(detail.metadata) ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无元数据" />
      ) : (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          {metadataSummary.length > 0 ? (
            <DetailDescriptions items={metadataSummary} />
          ) : null}
          {Object.keys(detail.metadata.labels).length > 0 ? (
            <>
              <Typography.Text strong>Labels</Typography.Text>
              <DetailDescriptions
                items={Object.entries(detail.metadata.labels).map(
                  ([key, value]) => ({
                    key,
                    label: key,
                    value,
                  }),
                )}
              />
            </>
          ) : null}
          {Object.keys(detail.metadata.annotations).length > 0 ? (
            <>
              <Typography.Text strong>Annotations</Typography.Text>
              <DetailDescriptions
                items={Object.entries(detail.metadata.annotations).map(
                  ([key, value]) => ({
                    key,
                    label: key,
                    value: (
                      <Typography.Paragraph
                        style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}
                      >
                        {value}
                      </Typography.Paragraph>
                    ),
                  }),
                )}
              />
            </>
          ) : null}
        </Space>
      )}
    </DetailSection>
  );
}

export function ResourceDetailContent({
  detail,
  onNavigateRequest,
}: ResourceDetailRendererProps) {
  const profile = getRenderProfile(detail);
  const normalizedKind = normalizeKind(
    detail.descriptor.resourceKind || detail.overview.kind,
  );
  if (AUTOSCALING_KINDS.has(normalizedKind)) {
    const autoscalingSummaryFields = getOrderedFields(
      detail,
      "overview",
      profile.overviewFields,
    ).filter(
      (field) =>
        ![
          "clusterId",
          "namespace",
          "kind",
          "name",
          "state",
          "createdAt",
          "updatedAt",
        ].includes(field),
    );
    return (
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <OverviewHeroSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        <StatusSnapshotSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        {autoscalingSummaryFields.length > 0
          ? renderKeyValueSection(
              "补充概览",
              "保留 HPA/VPA 资源扩展信息",
              autoscalingSummaryFields,
              buildOverviewFieldMap(detail),
            )
          : null}
        <RelationshipNavigatorSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        {detail.descriptor.sections.includes("metadata") ? (
          <MetadataSection
            detail={detail}
            onNavigateRequest={onNavigateRequest}
          />
        ) : null}
        {detail.descriptor.sections.includes("events") ? (
          <EventsSection detail={detail} />
        ) : null}
      </Space>
    );
  }
  if (normalizedKind === "gatewayclass") {
    return (
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <OverviewHeroSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        <StatusSnapshotSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        <GatewayClassHighlightsSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        <RelationshipNavigatorSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        <MetadataSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        {detail.descriptor.sections.includes("events") ? (
          <EventsSection detail={detail} />
        ) : null}
      </Space>
    );
  }
  if (normalizedKind === "gateway") {
    return (
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <OverviewHeroSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        <StatusSnapshotSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        <GatewayHighlightsSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        <RelationshipNavigatorSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        <MetadataSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        {detail.descriptor.sections.includes("events") ? (
          <EventsSection detail={detail} />
        ) : null}
      </Space>
    );
  }
  if (normalizedKind === "httproute") {
    return (
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <OverviewHeroSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        <StatusSnapshotSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        <HttpRouteHighlightsSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        <RelationshipNavigatorSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        <MetadataSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
        {detail.descriptor.sections.includes("events") ? (
          <EventsSection detail={detail} />
        ) : null}
      </Space>
    );
  }
  const runtimeFields = getOrderedFields(
    detail,
    "runtime",
    profile.runtimeFields,
  );
  const runtimeValues = buildRuntimeFieldMap(detail.runtime);
  const overviewValues = buildOverviewFieldMap(detail);

  const runtimeDetailFields = runtimeFields.filter(
    (field) =>
      ![
        "phase",
        "replicas",
        "readyReplicas",
        "availableReplicas",
        "restartCount",
        "podIP",
        "nodeName",
      ].includes(field),
  );

  const sectionContent: Partial<Record<ResourceDetailSection, ReactNode>> = {
    runtime:
      runtimeDetailFields.length > 0
        ? renderKeyValueSection(
            "运行详情",
            "镜像、副本与节点等详细字段",
            runtimeDetailFields,
            runtimeValues,
          )
        : null,
    associations: (
      <RelationshipNavigatorSection
        detail={detail}
        onNavigateRequest={onNavigateRequest}
      />
    ),
    network: null,
    storage: null,
    events: <EventsSection detail={detail} />,
    metadata: (
      <MetadataSection detail={detail} onNavigateRequest={onNavigateRequest} />
    ),
  };

  const supplementaryOverviewFields = getOrderedFields(
    detail,
    "overview",
    profile.overviewFields,
  ).filter(
    (field) =>
      ![
        "clusterId",
        "namespace",
        "kind",
        "name",
        "state",
        "createdAt",
        "updatedAt",
      ].includes(field),
  );

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <OverviewHeroSection
        detail={detail}
        onNavigateRequest={onNavigateRequest}
      />

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          width: "100%",
        }}
      >
        <StatusSnapshotSection
          detail={detail}
          onNavigateRequest={onNavigateRequest}
        />
      </div>

      {supplementaryOverviewFields.length > 0
        ? renderKeyValueSection(
            "补充概览",
            "保留概览字段中的扩展信息",
            supplementaryOverviewFields,
            overviewValues,
          )
        : null}

      <PodHighlightsSection
        detail={detail}
        onNavigateRequest={onNavigateRequest}
      />
      <WorkloadHighlightsSection
        detail={detail}
        onNavigateRequest={onNavigateRequest}
      />
      <ReplicaSetHighlightsSection
        detail={detail}
        onNavigateRequest={onNavigateRequest}
      />
      <JobHighlightsSection
        detail={detail}
        onNavigateRequest={onNavigateRequest}
      />
      <CronJobHighlightsSection
        detail={detail}
        onNavigateRequest={onNavigateRequest}
      />
      <NamespaceHighlightsSection detail={detail} />
      <ServiceHighlightsSection
        detail={detail}
        onNavigateRequest={onNavigateRequest}
      />
      <EndpointHighlightsSection
        detail={detail}
        onNavigateRequest={onNavigateRequest}
      />
      <IngressHighlightsSection
        detail={detail}
        onNavigateRequest={onNavigateRequest}
      />
      <NetworkPolicyHighlightsSection detail={detail} />
      <AutoscalingHighlightsSection
        detail={detail}
        onNavigateRequest={onNavigateRequest}
      />
      <StorageHighlightsSection
        detail={detail}
        onNavigateRequest={onNavigateRequest}
      />
      <ConfigHighlightsSection
        detail={detail}
        onNavigateRequest={onNavigateRequest}
      />
      <HelmReleaseHighlightsSection
        detail={detail}
        onNavigateRequest={onNavigateRequest}
      />
      <HelmRepositoryHighlightsSection
        detail={detail}
        onNavigateRequest={onNavigateRequest}
      />
      <MiddlewareHighlightsSection
        detail={detail}
        onNavigateRequest={onNavigateRequest}
      />

      {SECTION_PRIORITY.filter((section) =>
        detail.descriptor.sections.includes(section),
      )
        .map((section) => sectionContent[section])
        .filter(Boolean)}
    </Space>
  );
}
