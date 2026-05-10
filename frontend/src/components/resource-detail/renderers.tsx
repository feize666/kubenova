"use client";

import { Card, Divider, Empty, List, Space, Tag, Typography } from "antd";
import type {
  ResourceAssociation,
  ResourceDetailNetworkEndpoint,
  ResourceDetailOwnerReference,
  ResourceDetailSection,
} from "@/lib/api/resources";
import { StatusTag } from "@/components/status-tag";
import { DetailDescriptions, DetailSection, TagList } from "./section-primitives";
import type { ResourceDetailRendererProps } from "./types";
import {
  buildOverviewFieldMap,
  buildRuntimeFieldMap,
  formatDateTime,
  formatValue,
  getOrderedFields,
  getRenderProfile,
  hasMetadataContent,
  hasNetworkContent,
  hasStorageContent,
  humanizeFieldLabel,
  normalizeKind,
} from "./utils";

type NavigateRequest = NonNullable<ResourceDetailRendererProps["onNavigateRequest"]> extends (
  request: infer T,
) => void
  ? T
  : never;

const ASSOCIATION_TYPE_META: Record<string, { label: string; color: string }> = {
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
};

function renderConditionsSection(items?: Array<{ type?: string; status?: string; reason?: string; message?: string; lastTransitionTime?: string }>) {
  if (!items || items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无状态条件" />;
  }

  return (
    <List
      size="small"
      dataSource={items}
      renderItem={(item, index) => (
        <List.Item>
          <Space orientation="vertical" size={2} style={{ width: "100%" }}>
            <Space wrap size={8}>
              {item.type ? <Tag color="blue">{item.type}</Tag> : null}
              {item.status ? <StatusTag state={item.status} /> : null}
              {item.reason ? <Tag color="geekblue">{item.reason}</Tag> : null}
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {[item.message, item.lastTransitionTime].filter(Boolean).join(" · ") || `条件 ${index + 1}`}
            </Typography.Text>
          </Space>
        </List.Item>
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

const AUTOSCALING_KINDS = new Set(["horizontalpodautoscaler", "verticalpodautoscaler"]);

function renderFieldValue(field: string, value: unknown) {
  if ((field === "state" || field === "phase") && typeof value === "string" && value) {
    return <StatusTag state={value} />;
  }
  if ((field === "createdAt" || field === "updatedAt") && typeof value === "string") {
    return formatDateTime(value);
  }
  if (field === "images" && Array.isArray(value)) {
    return <TagList items={value.filter((item): item is string => typeof item === "string")} color="blue" />;
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
      extra={items.length > 0 ? <Typography.Text type="secondary">{items.length} 项</Typography.Text> : undefined}
    >
      <DetailDescriptions items={items} emptyText={emptyText} />
    </DetailSection>
  );
}

function getNetworkEndpointTagMeta(item: ResourceDetailNetworkEndpoint) {
  if (item.sourceKind === "Endpoints") {
    return { color: "gold", label: "Endpoints" };
  }
  if (item.sourceKind === "EndpointSlice") {
    return { color: "volcano", label: "EndpointSlice" };
  }
  if (item.sourceKind === "Service") {
    return { color: "blue", label: "Service" };
  }
  if (item.kind === "ingress-rule") {
    return { color: "green", label: "Ingress" };
  }
  return { color: "blue", label: "Service" };
}

function resolveAssociationNavigation(item: ResourceAssociation) {
  return toNavigateRequest(item.kind, item.id);
}

function resolveOwnerReferenceNavigation(
  detail: ResourceDetailRendererProps["detail"],
  ownerReference: ResourceDetailOwnerReference,
) {
  if (!ownerReference.kind || !ownerReference.name) {
    return null;
  }

  const candidate =
    detail.associations.find(
      (association) =>
        association.id &&
        association.kind === ownerReference.kind &&
        association.name === ownerReference.name &&
        association.associationType === "owner",
    ) ??
    detail.associations.find(
      (association) =>
        association.id &&
        association.kind === ownerReference.kind &&
        association.name === ownerReference.name,
    );

  return toNavigateRequest(candidate?.kind, candidate?.id);
}

function toNavigateRequest(kind?: string | null, id?: string | null): NavigateRequest | null {
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

function emitNavigateRequest(
  onNavigateRequest: ResourceDetailRendererProps["onNavigateRequest"],
  kind?: string | null,
  id?: string | null,
) {
  const request = toNavigateRequest(kind, id);
  if (!request || !onNavigateRequest) {
    return;
  }
  onNavigateRequest(request);
}

function resolveNetworkEndpointNavigation(
  detail: ResourceDetailRendererProps["detail"],
  item: ResourceDetailNetworkEndpoint,
): { kind: string; id: string } | null {
  if (item.id) {
    return toNavigateRequest(item.sourceKind ?? detail.overview.kind, item.id);
  }
  if (item.sourceId) {
    return toNavigateRequest(item.sourceKind ?? detail.overview.kind, item.sourceId);
  }

  const selfKind = detail.overview.kind;
  const selfName = detail.overview.name;
  if (item.sourceKind && item.sourceName && item.sourceKind === selfKind && item.sourceName === selfName) {
    return toNavigateRequest(selfKind, detail.overview.id);
  }

  const candidates = detail.associations.filter((association) => {
    if (!association.id) return false;
    if (item.namespace && association.namespace && item.namespace !== association.namespace) return false;

    if (item.sourceKind && item.sourceName) {
      return association.kind === item.sourceKind && association.name === item.sourceName;
    }

    if (item.name) {
      return association.kind === "Service" && association.name === item.name;
    }

    return false;
  });

  if (candidates.length === 0) {
    return null;
  }
  const best = candidates[0];
  return toNavigateRequest(best.kind, best.id);
}

function renderNetworkEndpointList(
  detail: ResourceDetailRendererProps["detail"],
  items: ResourceDetailNetworkEndpoint[],
  onNavigateRequest?: ResourceDetailRendererProps["onNavigateRequest"],
) {
  return (
    <List
      size="small"
      dataSource={items}
      renderItem={(item) => {
        const tagMeta = getNetworkEndpointTagMeta(item);
        const navigateTarget = onNavigateRequest ? resolveNetworkEndpointNavigation(detail, item) : null;

        return (
          <List.Item>
            <Space orientation="vertical" size={2} style={{ width: "100%" }}>
              <Space wrap size={8}>
                <Tag color={tagMeta.color}>{tagMeta.label}</Tag>
                {navigateTarget ? (
                  <Typography.Link strong onClick={() => onNavigateRequest?.(navigateTarget)}>
                    {item.name}
                  </Typography.Link>
                ) : (
                  <Typography.Text strong>{item.name}</Typography.Text>
                )}
                {item.sourceName && item.sourceName !== item.name ? (
                  <Typography.Text type="secondary">来源 {item.sourceName}</Typography.Text>
                ) : null}
                {item.namespace ? <Typography.Text type="secondary">{item.namespace}</Typography.Text> : null}
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {[item.host, item.path, item.ip, item.hostname].filter(Boolean).join(" · ") || "无额外端点信息"}
              </Typography.Text>
              {item.ports && item.ports.length > 0 ? (
                <Space wrap size={[6, 6]}>
                  {item.ports.map((port) => (
                    <Tag key={`${item.name}-${port.port}-${port.protocol ?? "tcp"}`}>
                      {port.protocol ?? "TCP"} {port.port}
                      {port.targetPort ? ` -> ${port.targetPort}` : ""}
                    </Tag>
                  ))}
                </Space>
              ) : null}
            </Space>
          </List.Item>
        );
      }}
    />
  );
}

function OverviewHeroSection({ detail }: ResourceDetailRendererProps) {
  const runtimeHighlights = [
    detail.runtime.phase ? { label: "阶段", value: renderFieldValue("phase", detail.runtime.phase) } : null,
    detail.runtime.replicas !== undefined ? { label: "副本", value: detail.runtime.replicas } : null,
    detail.runtime.readyReplicas !== undefined ? { label: "就绪", value: detail.runtime.readyReplicas } : null,
    detail.runtime.availableReplicas !== undefined ? { label: "可用", value: detail.runtime.availableReplicas } : null,
    detail.runtime.restartCount !== undefined ? { label: "重启", value: detail.runtime.restartCount } : null,
    detail.runtime.podIP ? { label: "Pod IP", value: detail.runtime.podIP } : null,
    detail.runtime.nodeName ? { label: "节点", value: detail.runtime.nodeName } : null,
  ].filter(Boolean) as Array<{ label: string; value: React.ReactNode }>;

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
          {detail.overview.namespace ? <Tag>{detail.overview.namespace}</Tag> : <Tag>集群级</Tag>}
          <StatusTag state={detail.overview.state} />
          {detail.runtime.phase ? <StatusTag state={detail.runtime.phase} /> : null}
        </Space>

        <Space orientation="vertical" size={4} style={{ width: "100%" }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {detail.overview.name}
          </Typography.Title>
          <Typography.Text type="secondary">
            集群 {detail.overview.clusterId}
            {detail.overview.namespace ? ` / 名称空间 ${detail.overview.namespace}` : ""}
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
              background: "color-mix(in srgb, var(--color-card-high, #1a2234) 82%, transparent)",
              border: "1px solid var(--color-border, rgba(59, 130, 246, 0.15))",
            }}
          >
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              创建时间
            </Typography.Text>
            <div>
              <Typography.Text>{formatDateTime(detail.overview.createdAt)}</Typography.Text>
            </div>
          </div>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              background: "color-mix(in srgb, var(--color-card-high, #1a2234) 82%, transparent)",
              border: "1px solid var(--color-border, rgba(59, 130, 246, 0.15))",
            }}
          >
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              更新时间
            </Typography.Text>
            <div>
              <Typography.Text>{formatDateTime(detail.overview.updatedAt)}</Typography.Text>
            </div>
          </div>
          {runtimeHighlights.slice(0, 4).map((item) => (
            <div
              key={item.label}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                background: "color-mix(in srgb, var(--color-card-high, #1a2234) 82%, transparent)",
                border: "1px solid var(--color-border, rgba(59, 130, 246, 0.15))",
              }}
            >
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {item.label}
              </Typography.Text>
              <div>
                {typeof item.value === "string" || typeof item.value === "number" ? (
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
    { key: "state", label: "资源状态", value: renderFieldValue("state", detail.overview.state) },
    detail.runtime.phase !== undefined
      ? { key: "phase", label: "运行阶段", value: renderFieldValue("phase", detail.runtime.phase) }
      : null,
    detail.runtime.replicas !== undefined ? { key: "replicas", label: "期望副本", value: detail.runtime.replicas } : null,
    detail.runtime.readyReplicas !== undefined
      ? { key: "readyReplicas", label: "就绪副本", value: detail.runtime.readyReplicas }
      : null,
    detail.runtime.availableReplicas !== undefined
      ? { key: "availableReplicas", label: "可用副本", value: detail.runtime.availableReplicas }
      : null,
    detail.runtime.restartCount !== undefined
      ? { key: "restartCount", label: "重启次数", value: detail.runtime.restartCount }
      : null,
    detail.runtime.podIP ? { key: "podIP", label: "Pod IP", value: detail.runtime.podIP } : null,
    detail.runtime.nodeName ? { key: "nodeName", label: "节点", value: detail.runtime.nodeName } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; value: React.ReactNode }>;

  return (
    <DetailSection title="状态摘要" subtitle="先看健康、阶段与运行规模">
      <DetailDescriptions items={items} emptyText="暂无状态信息" />
    </DetailSection>
  );
}

function PodHighlightsSection({ detail, onNavigateRequest }: ResourceDetailRendererProps) {
  if (normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !== "pod") {
    return null;
  }

  const items = [
    detail.runtime.nodeName ? { key: "nodeName", label: "节点", value: detail.runtime.nodeName } : null,
    detail.runtime.podIP ? { key: "podIP", label: "Pod IP", value: detail.runtime.podIP } : null,
    detail.runtime.restartCount !== undefined
      ? { key: "restartCount", label: "重启次数", value: detail.runtime.restartCount }
      : null,
    detail.runtime.image ? { key: "image", label: "主镜像", value: detail.runtime.image } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; value: React.ReactNode }>;

  const ownerAssociations = detail.associations.filter((item) => item.associationType === "owner");

  return (
    <DetailSection title="Pod 高频区" subtitle="先看节点、IP、镜像与上级控制器">
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
        {ownerAssociations.length > 0 ? (
          <div>
            <Typography.Text strong>上级控制器</Typography.Text>
            <List
              size="small"
              dataSource={ownerAssociations}
              renderItem={(item) => (
                <List.Item>
                  <Space wrap size={8}>
                    <Tag color="purple">{item.kind}</Tag>
                    {item.id && onNavigateRequest ? (
                      <Typography.Link strong onClick={() => emitNavigateRequest(onNavigateRequest, item.kind, item.id)}>
                        {item.name}
                      </Typography.Link>
                    ) : (
                      <Typography.Text strong>{item.name}</Typography.Text>
                    )}
                    {item.namespace ? <Typography.Text type="secondary">{item.namespace}</Typography.Text> : null}
                  </Space>
                </List.Item>
              )}
            />
          </div>
        ) : null}
      </Space>
    </DetailSection>
  );
}

function WorkloadHighlightsSection({ detail, onNavigateRequest }: ResourceDetailRendererProps) {
  const kind = normalizeKind(detail.descriptor.resourceKind || detail.overview.kind);
  if (!["deployment", "statefulset", "daemonset"].includes(kind)) {
    return null;
  }

  const selectorText =
    Object.keys(detail.metadata.labels).length > 0
      ? Object.entries(detail.metadata.labels)
          .slice(0, 6)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ")
      : "";

  const ownedPods = detail.associations.filter((item) => item.associationType === "owned-pod");
  const items = [
    detail.runtime.replicas !== undefined ? { key: "replicas", label: "期望副本", value: detail.runtime.replicas } : null,
    detail.runtime.readyReplicas !== undefined
      ? { key: "readyReplicas", label: "就绪副本", value: detail.runtime.readyReplicas }
      : null,
    detail.runtime.availableReplicas !== undefined
      ? { key: "availableReplicas", label: "可用副本", value: detail.runtime.availableReplicas }
      : null,
    selectorText ? { key: "selector", label: "Selector", value: selectorText } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; value: React.ReactNode }>;

  return (
    <DetailSection title="工作负载高频区" subtitle="副本、Selector、镜像与拥有的 Pod">
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
        {ownedPods.length > 0 ? (
          <div>
            <Typography.Text strong>拥有的 Pod</Typography.Text>
            <List
              size="small"
              dataSource={ownedPods}
              renderItem={(item) => (
                <List.Item>
                  <Space wrap size={8}>
                    <Tag color="purple">Pod</Tag>
                    {item.id && onNavigateRequest ? (
                      <Typography.Link strong onClick={() => emitNavigateRequest(onNavigateRequest, item.kind, item.id)}>
                        {item.name}
                      </Typography.Link>
                    ) : (
                      <Typography.Text strong>{item.name}</Typography.Text>
                    )}
                    {item.namespace ? <Typography.Text type="secondary">{item.namespace}</Typography.Text> : null}
                  </Space>
                </List.Item>
              )}
            />
          </div>
        ) : null}
      </Space>
    </DetailSection>
  );
}

function ServiceHighlightsSection({ detail, onNavigateRequest }: ResourceDetailRendererProps) {
  if (normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !== "service") {
    return null;
  }

  const serviceAssociationHints = detail.associations.filter((item) =>
    ["selects-service", "service-endpoints", "service-endpointslice"].includes(item.associationType),
  );

  const servicePorts = detail.network.endpoints.filter((item) => item.kind === "service-port" && !item.sourceKind);
  const endpointTargets = detail.network.endpoints.filter(
    (item) => item.sourceKind === "Endpoints" || item.sourceKind === "EndpointSlice",
  );
  const selectorText =
    Object.keys(detail.metadata.labels).length > 0
      ? Object.entries(detail.metadata.labels)
          .slice(0, 6)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ")
      : "";

  return (
    <DetailSection title="Service 高频区" subtitle="类型、ClusterIP、端口、Selector 与后端">
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions
          items={[
            detail.network.clusterIPs.length > 0
              ? { key: "clusterIPs", label: "Cluster IP", value: detail.network.clusterIPs.join(", ") }
              : null,
            selectorText ? { key: "selector", label: "Selector", value: selectorText } : null,
            servicePorts.length > 0
              ? {
                  key: "ports",
                  label: "端口",
                  value: servicePorts
                    .flatMap((item) => item.ports ?? [])
                    .map((port) => `${port.protocol ?? "TCP"} ${port.port}${port.targetPort ? ` -> ${port.targetPort}` : ""}`)
                    .join(" · "),
                }
              : null,
          ].filter(Boolean) as Array<{ key: string; label: string; value: React.ReactNode }>}
          emptyText="暂无 Service 摘要"
        />
        {serviceAssociationHints.length > 0 ? (
          <div>
            <Typography.Text strong>后端关联</Typography.Text>
            <List
              size="small"
              dataSource={serviceAssociationHints}
              renderItem={(item) => (
                <List.Item>
                  <Space wrap size={8}>
                    <Tag color={ASSOCIATION_TYPE_META[item.associationType]?.color ?? "default"}>
                      {ASSOCIATION_TYPE_META[item.associationType]?.label ?? item.associationType}
                    </Tag>
                    {item.id && onNavigateRequest ? (
                      <Typography.Link strong onClick={() => emitNavigateRequest(onNavigateRequest, item.kind, item.id)}>
                        {item.name}
                      </Typography.Link>
                    ) : (
                      <Typography.Text strong>{item.name}</Typography.Text>
                    )}
                  </Space>
                </List.Item>
              )}
            />
          </div>
        ) : null}
        {endpointTargets.length > 0 ? (
          <div>
            <Typography.Text strong>后端地址目标</Typography.Text>
            <List
              size="small"
              dataSource={endpointTargets.slice(0, 8)}
              renderItem={(endpoint) => {
                const target = resolveNetworkEndpointNavigation(detail, endpoint);
                return (
                  <List.Item>
                    <Space wrap size={8}>
                      <Tag color={endpoint.sourceKind === "EndpointSlice" ? "volcano" : "gold"}>
                        {endpoint.sourceKind ?? "Endpoint"}
                      </Tag>
                      {target && onNavigateRequest ? (
                        <Typography.Link strong onClick={() => onNavigateRequest(target)}>
                          {endpoint.name}
                        </Typography.Link>
                      ) : (
                        <Typography.Text strong>{endpoint.name}</Typography.Text>
                      )}
                      {endpoint.ip ? <Typography.Text type="secondary">{endpoint.ip}</Typography.Text> : null}
                    </Space>
                  </List.Item>
                );
              }}
            />
          </div>
        ) : null}
      </Space>
    </DetailSection>
  );
}

function NetworkPolicyHighlightsSection({ detail }: ResourceDetailRendererProps) {
  if (normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !== "network-policy") {
    return null;
  }

  const labels = Object.entries(detail.metadata.labels)
    .slice(0, 8)
    .map(([key, value]) => ({ key, label: key, value }));
  const annotations = Object.entries(detail.metadata.annotations)
    .slice(0, 8)
    .map(([key, value]) => ({ key, label: key, value }));

  const summaryItems = [
    {
      key: "scope",
      label: "作用域",
      value: detail.overview.namespace ? `名称空间 ${detail.overview.namespace}` : "集群级",
    },
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
    { key: "associations", label: "关联数", value: detail.associations.length },
    { key: "endpoints", label: "网络端点", value: detail.network.endpoints.length },
  ];

  return (
    <DetailSection title="NetworkPolicy 高频区" subtitle="先看作用域、关联数、标签与注解">
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions items={summaryItems} emptyText="暂无 NetworkPolicy 摘要" />
        {labels.length > 0 ? (
          <div>
            <Typography.Text strong>Labels</Typography.Text>
            <div style={{ marginTop: 8 }}>
              <DetailDescriptions items={labels} emptyText="暂无标签" />
            </div>
          </div>
        ) : null}
        {annotations.length > 0 ? (
          <div>
            <Typography.Text strong>Annotations</Typography.Text>
            <div style={{ marginTop: 8 }}>
              <DetailDescriptions items={annotations} emptyText="暂无注解" />
            </div>
          </div>
        ) : null}
      </Space>
    </DetailSection>
  );
}

function GatewayClassHighlightsSection({ detail, onNavigateRequest }: ResourceDetailRendererProps) {
  if (normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !== "gatewayclass") {
    return null;
  }

  const spec = detail.metadata.annotations["gateway.networking.k8s.io/controller-name"] ?? "";

  return (
    <DetailSection title="GatewayClass 高频区" subtitle="先看实现类和状态条件">
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions
          items={[
            detail.overview.kind ? { key: "kind", label: "Kind", value: detail.overview.kind } : null,
            spec ? { key: "controller", label: "Controller", value: spec } : null,
            detail.runtime.phase ? { key: "phase", label: "阶段", value: detail.runtime.phase } : null,
          ].filter(Boolean) as Array<{ key: string; label: string; value: React.ReactNode }>}
          emptyText="暂无 GatewayClass 摘要"
        />
        {renderConditionsSection(detail.runtime.conditions)}
        {detail.network.endpoints.length > 0 ? (
          <div>
            <Typography.Text strong>网关监听器</Typography.Text>
            <List
              size="small"
              dataSource={detail.network.endpoints.filter((item) => item.kind === "gateway-listener")}
              renderItem={(item) => (
                <List.Item>
                  <Space wrap size={8}>
                    <Tag color="blue">Listener</Tag>
                    {item.id && onNavigateRequest ? (
                      <Typography.Link strong onClick={() => emitNavigateRequest(onNavigateRequest, item.kind, item.id)}>
                        {item.name}
                      </Typography.Link>
                    ) : (
                      <Typography.Text strong>{item.name}</Typography.Text>
                    )}
                  </Space>
                </List.Item>
              )}
            />
          </div>
        ) : null}
      </Space>
    </DetailSection>
  );
}

function GatewayHighlightsSection({ detail, onNavigateRequest }: ResourceDetailRendererProps) {
  if (normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !== "gateway") {
    return null;
  }

  const listenerNames = detail.network.endpoints
    .filter((item) => item.kind === "gateway-listener")
    .map((item) => item.name);
  const routeNames = detail.network.endpoints
    .filter((item) => item.kind === "gateway-route")
    .map((item) => item.name);
  const hostnameCount = detail.network.endpoints.filter((item) => item.kind === "gateway-listener" && item.hostname).length;
  const allowedRoutesFrom = Array.from(
    new Set(
      detail.network.endpoints
        .filter((item) => item.kind === "gateway-listener")
        .flatMap((item) => item.allowedRoutesFrom ? [item.allowedRoutesFrom] : []),
    ),
  );

  return (
    <DetailSection title="Gateway 高频区" subtitle="先看监听器、地址和状态条件">
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions
          items={[
            detail.overview.namespace ? { key: "namespace", label: "名称空间", value: detail.overview.namespace } : null,
            listenerNames.length > 0
              ? { key: "listeners", label: "监听器", value: <TagList items={listenerNames} color="blue" /> }
              : null,
            hostnameCount > 0 ? { key: "hostnames", label: "Hostname", value: hostnameCount } : null,
            allowedRoutesFrom.length > 0
              ? { key: "allowedRoutes", label: "允许路由方式", value: <TagList items={allowedRoutesFrom} color="gold" /> }
              : null,
            routeNames.length > 0
              ? { key: "routes", label: "路由", value: <TagList items={routeNames} color="cyan" /> }
              : null,
            detail.runtime.phase ? { key: "phase", label: "阶段", value: detail.runtime.phase } : null,
          ].filter(Boolean) as Array<{ key: string; label: string; value: React.ReactNode }>}
          emptyText="暂无 Gateway 摘要"
        />
        {renderConditionsSection(detail.runtime.conditions)}
        {detail.associations.length > 0 ? (
          <div>
            <Typography.Text strong>关联资源</Typography.Text>
            <List
              size="small"
              dataSource={detail.associations.slice(0, 6)}
              renderItem={(item) => (
                <List.Item>
                  <Space wrap size={8}>
                    <Tag color="geekblue">{item.kind}</Tag>
                    {item.id && onNavigateRequest ? (
                      <Typography.Link strong onClick={() => emitNavigateRequest(onNavigateRequest, item.kind, item.id)}>
                        {item.name}
                      </Typography.Link>
                    ) : (
                      <Typography.Text strong>{item.name}</Typography.Text>
                    )}
                  </Space>
                </List.Item>
              )}
            />
          </div>
        ) : null}
      </Space>
    </DetailSection>
  );
}

type QuickLinkItem = {
  key: string;
  kind: string;
  name: string;
  subtitle: string;
  typeLabel: string;
  color: string;
  target: { kind: string; id: string } | null;
};

type QuickLinkGroup = {
  title: string;
  items: QuickLinkItem[];
};

function buildQuickLinkGroups(detail: ResourceDetailRendererProps["detail"]): QuickLinkGroup[] {
  const ownerItems = detail.metadata.ownerReferences
    .filter((item) => item.kind && item.name)
    .map((item) => ({
      key: `owner-ref:${item.kind}:${item.name}`,
      kind: item.kind!,
      name: item.name!,
      subtitle: item.controller ? "控制器引用" : "所有者引用",
      typeLabel: "OwnerRef",
      color: "purple",
      target: resolveOwnerReferenceNavigation(detail, item),
    }));

  const associationItems = detail.associations.map((item) => ({
    key: `association:${item.associationType}:${item.kind}:${item.namespace ?? "_cluster"}:${item.name}`,
    kind: item.kind,
    name: item.name,
    subtitle: item.namespace ? `名称空间 ${item.namespace}` : "集群级资源",
    typeLabel: ASSOCIATION_TYPE_META[item.associationType]?.label ?? item.associationType,
    color: ASSOCIATION_TYPE_META[item.associationType]?.color ?? "default",
    target: resolveAssociationNavigation(item),
    associationType: item.associationType,
  }));

  const groupMap: QuickLinkGroup[] = [
    {
      title: "上游控制",
      items: [...ownerItems, ...associationItems.filter((item) => item.associationType === "owner")],
    },
    {
      title: "服务与路由",
      items: associationItems.filter((item) =>
        [
          "backend-service",
          "routes-to-service",
          "traefik-routes-to-service",
          "tls-secret",
          "route-middleware",
        ].includes(item.associationType),
      ),
    },
    {
      title: "工作负载与后端",
      items: associationItems.filter((item) =>
        ["owned-pod", "selects-service", "service-endpoints", "service-endpointslice"].includes(item.associationType),
      ),
    },
  ];

  return groupMap
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item, index, array) => array.findIndex((candidate) => candidate.key === item.key) === index,
      ),
    }))
    .filter((group) => group.items.length > 0);
}

function QuickLinksSection({ detail, onNavigateRequest }: ResourceDetailRendererProps) {
  const groups = buildQuickLinkGroups(detail);

  return (
    <DetailSection title="关系导航" subtitle="直接跳到上游、下游与关联资源">
      {groups.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可导航关系" />
      ) : (
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          {groups.map((group) => (
            <div
              key={group.title}
              style={{
                padding: 14,
                borderRadius: 14,
                border: "1px solid var(--color-border, rgba(59, 130, 246, 0.15))",
                background: "color-mix(in srgb, var(--color-card-high, #1a2234) 78%, transparent)",
              }}
            >
              <Space orientation="vertical" size={10} style={{ width: "100%" }}>
                <Typography.Text strong>{group.title}</Typography.Text>
                {group.items.map((item) => (
                  <Space
                    key={item.key}
                    align="start"
                    size={8}
                    style={{ width: "100%", justifyContent: "space-between" }}
                  >
                    <Space orientation="vertical" size={2} style={{ minWidth: 0 }}>
                      <Space wrap size={[6, 6]}>
                        <Tag color={item.color}>{item.typeLabel}</Tag>
                        <Tag>{item.kind}</Tag>
                      </Space>
                      {item.target && onNavigateRequest ? (
                        <Typography.Link
                          strong
                          onClick={() => onNavigateRequest(item.target!)}
                          title={item.name}
                        >
                          {item.name}
                        </Typography.Link>
                      ) : (
                        <Typography.Text strong title={item.name}>
                          {item.name}
                        </Typography.Text>
                      )}
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {item.subtitle}
                      </Typography.Text>
                    </Space>
                  </Space>
                ))}
              </Space>
            </div>
          ))}
        </div>
      )}
    </DetailSection>
  );
}

function AssociationsSection({ detail, onNavigateRequest }: ResourceDetailRendererProps) {
  return (
    <DetailSection
      title="关联资源"
      subtitle="展示资源绑定关系与上游下游对象"
      extra={
        detail.associations.length > 0 ? (
          <Typography.Text type="secondary">{detail.associations.length} 个关联</Typography.Text>
        ) : undefined
      }
    >
      {detail.associations.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联资源" />
      ) : (
        <List
          dataSource={detail.associations}
          renderItem={(item) => (
            <List.Item>
              <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                <Space size={8} wrap>
                  <Tag color="geekblue">{item.kind}</Tag>
                  {item.id && onNavigateRequest ? (
                    <Typography.Link strong onClick={() => emitNavigateRequest(onNavigateRequest, item.kind, item.id)}>
                      {item.name}
                    </Typography.Link>
                  ) : (
                    <Typography.Text strong>{item.name}</Typography.Text>
                  )}
                  <Tag color={ASSOCIATION_TYPE_META[item.associationType]?.color ?? "default"}>
                    {ASSOCIATION_TYPE_META[item.associationType]?.label ?? item.associationType}
                  </Tag>
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {item.namespace ? `名称空间 ${item.namespace}` : "集群级资源"}
                </Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      )}
    </DetailSection>
  );
}

function NetworkSection({ detail, onNavigateRequest }: ResourceDetailRendererProps) {
  const isServiceDetail = normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) === "service";
  const servicePorts = detail.network.endpoints.filter((item) => item.kind === "service-port" && !item.sourceKind);
  const serviceAddresses = detail.network.endpoints.filter((item) => item.sourceKind === "Service");
  const endpointsItems = detail.network.endpoints.filter((item) => item.sourceKind === "Endpoints");
  const endpointSliceItems = detail.network.endpoints.filter((item) => item.sourceKind === "EndpointSlice");
  const otherEndpoints = detail.network.endpoints.filter(
    (item) =>
      !(item.kind === "service-port" && !item.sourceKind) &&
      item.sourceKind !== "Service" &&
      item.sourceKind !== "Endpoints" &&
      item.sourceKind !== "EndpointSlice",
  );

  return (
    <DetailSection
      title="网络"
      subtitle={isServiceDetail ? "Service 地址、暴露端口与后端联动" : "IP、节点与对外入口"}
      extra={
        detail.network.endpoints.length > 0 ? (
          <Typography.Text type="secondary">{detail.network.endpoints.length} 个端点</Typography.Text>
        ) : undefined
      }
    >
      {!hasNetworkContent(detail.network) ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无网络信息" />
      ) : (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <DetailDescriptions
            items={[
              { key: "clusterIPs", label: "Cluster IP", value: <TagList items={detail.network.clusterIPs} color="blue" /> },
              { key: "podIPs", label: "Pod IP", value: <TagList items={detail.network.podIPs} color="cyan" /> },
              { key: "nodeNames", label: "节点", value: <TagList items={detail.network.nodeNames} color="purple" /> },
            ].filter((item) => {
              if (item.key === "clusterIPs") return detail.network.clusterIPs.length > 0;
              if (item.key === "podIPs") return detail.network.podIPs.length > 0;
              return detail.network.nodeNames.length > 0;
            })}
          />
          {detail.network.endpoints.length > 0 && isServiceDetail ? (
            <>
              {servicePorts.length > 0 ? (
                <>
                  <Divider style={{ margin: 0 }}>Service 端口</Divider>
                  {renderNetworkEndpointList(detail, servicePorts, onNavigateRequest)}
                </>
              ) : null}
              {serviceAddresses.length > 0 ? (
                <>
                  <Divider style={{ margin: 0 }}>对外地址</Divider>
                  {renderNetworkEndpointList(detail, serviceAddresses, onNavigateRequest)}
                </>
              ) : null}
              {endpointsItems.length > 0 ? (
                <>
                  <Divider style={{ margin: 0 }}>Endpoints</Divider>
                  {renderNetworkEndpointList(detail, endpointsItems, onNavigateRequest)}
                </>
              ) : null}
              {endpointSliceItems.length > 0 ? (
                <>
                  <Divider style={{ margin: 0 }}>EndpointSlice</Divider>
                  {renderNetworkEndpointList(detail, endpointSliceItems, onNavigateRequest)}
                </>
              ) : null}
              {otherEndpoints.length > 0 ? (
                <>
                  <Divider style={{ margin: 0 }}>其他端点</Divider>
                  {renderNetworkEndpointList(detail, otherEndpoints, onNavigateRequest)}
                </>
              ) : null}
            </>
          ) : detail.network.endpoints.length > 0 ? (
            <>
              <Divider style={{ margin: 0 }}>端点</Divider>
              {renderNetworkEndpointList(detail, detail.network.endpoints, onNavigateRequest)}
            </>
          ) : null}
        </Space>
      )}
    </DetailSection>
  );
}


function ServiceBackendsSection({ detail, onNavigateRequest }: ResourceDetailRendererProps) {
  if (detail.overview.kind !== "Service") {
    return null;
  }

  const endpointAssociations = detail.associations.filter(
    (item) => item.kind === "Endpoints" && item.associationType === "selects-service",
  );
  const endpointSliceAssociations = detail.associations.filter(
    (item) => item.kind === "EndpointSlice" && item.associationType === "selects-service",
  );

  const endpointItems = detail.network.endpoints.filter((item) => item.sourceKind === "Endpoints");
  const endpointSliceItems = detail.network.endpoints.filter((item) => item.sourceKind === "EndpointSlice");

  return (
    <DetailSection title="后端目标" subtitle="Service 关联的 Endpoints 与 EndpointSlice">
      {endpointAssociations.length === 0 && endpointSliceAssociations.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无后端目标" />
      ) : (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          {endpointAssociations.length > 0 ? (
            <>
              <Typography.Text strong>Endpoints</Typography.Text>
              <List
                size="small"
                dataSource={endpointAssociations}
                renderItem={(item) => {
                  const matched = endpointItems.filter((endpoint) => endpoint.sourceName === item.name);
                  return (
                    <List.Item>
                      <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                        <Space wrap size={8}>
                          <Tag color="gold">Endpoints</Tag>
                          <Typography.Link
                            strong
                            onClick={() => emitNavigateRequest(onNavigateRequest, "Endpoints", item.id)}
                          >
                            {item.name}
                          </Typography.Link>
                          {item.namespace ? <Typography.Text type="secondary">{item.namespace}</Typography.Text> : null}
                        </Space>
                        {matched.length > 0 ? (
                          matched.map((endpoint, index) => (
                            <Typography.Text
                              key={`${item.name}-${endpoint.ip ?? endpoint.hostname ?? index}`}
                              type="secondary"
                              style={{ fontSize: 12 }}
                            >
                              {[
                                endpoint.ip ?? endpoint.hostname ?? endpoint.name,
                                endpoint.ports?.map((port) => `${port.protocol ?? "TCP"} ${port.port}`).join(", "),
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </Typography.Text>
                          ))
                        ) : (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            暂无地址明细
                          </Typography.Text>
                        )}
                      </Space>
                    </List.Item>
                  );
                }}
              />
            </>
          ) : null}

          {endpointSliceAssociations.length > 0 ? (
            <>
              <Typography.Text strong>EndpointSlice</Typography.Text>
              <List
                size="small"
                dataSource={endpointSliceAssociations}
                renderItem={(item) => {
                  const matched = endpointSliceItems.filter((endpoint) => endpoint.sourceName === item.name);
                  return (
                    <List.Item>
                      <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                        <Space wrap size={8}>
                          <Tag color="volcano">EndpointSlice</Tag>
                          <Typography.Link
                            strong
                            onClick={() => emitNavigateRequest(onNavigateRequest, "EndpointSlice", item.id)}
                          >
                            {item.name}
                          </Typography.Link>
                          {item.namespace ? <Typography.Text type="secondary">{item.namespace}</Typography.Text> : null}
                        </Space>
                        {matched.length > 0 ? (
                          matched.map((endpoint, index) => (
                            <Typography.Text
                              key={`${item.name}-${endpoint.ip ?? endpoint.hostname ?? index}`}
                              type="secondary"
                              style={{ fontSize: 12 }}
                            >
                              {[
                                endpoint.ip ?? endpoint.hostname ?? endpoint.name,
                                endpoint.ports?.map((port) => `${port.protocol ?? "TCP"} ${port.port}`).join(", "),
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </Typography.Text>
                          ))
                        ) : (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            暂无地址明细
                          </Typography.Text>
                        )}
                      </Space>
                    </List.Item>
                  );
                }}
              />
            </>
          ) : null}
        </Space>
      )}
    </DetailSection>
  );
}

function HttpRouteHighlightsSection({ detail, onNavigateRequest }: ResourceDetailRendererProps) {
  if (normalizeKind(detail.descriptor.resourceKind || detail.overview.kind) !== "httproute") {
    return null;
  }

  const parentRefs = detail.associations.filter((item) => item.associationType === "owner");
  const backendRefs = detail.associations.filter((item) =>
    ["backend-service", "routes-to-service", "traefik-routes-to-service"].includes(item.associationType),
  );

  return (
    <DetailSection title="HTTPRoute 高频区" subtitle="先看父引用、后端引用和状态条件">
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DetailDescriptions
          items={[
            detail.overview.namespace ? { key: "namespace", label: "名称空间", value: detail.overview.namespace } : null,
            parentRefs.length > 0 ? { key: "parents", label: "父引用", value: parentRefs.length } : null,
            backendRefs.length > 0 ? { key: "backend", label: "后端引用", value: backendRefs.length } : null,
            detail.runtime.phase ? { key: "phase", label: "阶段", value: detail.runtime.phase } : null,
          ].filter(Boolean) as Array<{ key: string; label: string; value: React.ReactNode }>}
          emptyText="暂无 HTTPRoute 摘要"
        />
        {renderConditionsSection(detail.runtime.conditions)}
        {backendRefs.length > 0 ? (
          <div>
            <Typography.Text strong>后端引用</Typography.Text>
            <List
              size="small"
              dataSource={backendRefs.slice(0, 6)}
              renderItem={(item) => (
                <List.Item>
                  <Space wrap size={8}>
                    <Tag color="cyan">{item.kind}</Tag>
                    {item.id && onNavigateRequest ? (
                      <Typography.Link strong onClick={() => emitNavigateRequest(onNavigateRequest, item.kind, item.id)}>
                        {item.name}
                      </Typography.Link>
                    ) : (
                      <Typography.Text strong>{item.name}</Typography.Text>
                    )}
                  </Space>
                </List.Item>
              )}
            />
          </div>
        ) : null}
      </Space>
    </DetailSection>
  );
}

function StorageSection({ detail }: ResourceDetailRendererProps) {
  return (
    <DetailSection
      title="存储"
      subtitle="卷、挂载与持久化绑定关系"
      extra={
        detail.storage.persistentVolumeClaims.length +
          detail.storage.persistentVolumes.length +
          detail.storage.mounts.length +
          detail.storage.volumes.length >
        0 ? (
          <Typography.Text type="secondary">
            {detail.storage.persistentVolumeClaims.length + detail.storage.persistentVolumes.length} 个持久化对象
          </Typography.Text>
        ) : undefined
      }
    >
      {!hasStorageContent(detail.storage) ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无存储信息" />
      ) : (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <DetailDescriptions
            items={[
              {
                key: "storageClasses",
                label: "StorageClass",
                value: <TagList items={detail.storage.storageClasses} color="gold" />,
              },
            ].filter(() => detail.storage.storageClasses.length > 0)}
          />
          {detail.storage.persistentVolumeClaims.length > 0 ? (
            <>
              <Divider style={{ margin: 0 }}>PVC</Divider>
              <List
                size="small"
                dataSource={detail.storage.persistentVolumeClaims}
                renderItem={(item) => (
                  <List.Item>
                    <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                      <Typography.Text strong>{item.name}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {[item.namespace, item.phase, item.storageClass, item.volumeName].filter(Boolean).join(" · ")}
                      </Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            </>
          ) : null}
          {detail.storage.persistentVolumes.length > 0 ? (
            <>
              <Divider style={{ margin: 0 }}>PV</Divider>
              <List
                size="small"
                dataSource={detail.storage.persistentVolumes}
                renderItem={(item) => (
                  <List.Item>
                    <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                      <Typography.Text strong>{item.name}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {[item.phase, item.storageClass].filter(Boolean).join(" · ")}
                      </Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            </>
          ) : null}
          {detail.storage.volumes.length > 0 ? (
            <>
              <Divider style={{ margin: 0 }}>卷</Divider>
              <List
                size="small"
                dataSource={detail.storage.volumes}
                renderItem={(item) => (
                  <List.Item>
                    <Space wrap size={8}>
                      <Typography.Text strong>{item.name}</Typography.Text>
                      <Tag>{item.type}</Tag>
                      {item.source ? <Typography.Text type="secondary">{item.source}</Typography.Text> : null}
                    </Space>
                  </List.Item>
                )}
              />
            </>
          ) : null}
          {detail.storage.mounts.length > 0 ? (
            <>
              <Divider style={{ margin: 0 }}>挂载</Divider>
              <List
                size="small"
                dataSource={detail.storage.mounts}
                renderItem={(item) => (
                  <List.Item>
                    <Space wrap size={8}>
                      <Tag color="cyan">{item.container}</Tag>
                      <Typography.Text strong>{item.volume}</Typography.Text>
                      <Typography.Text>{item.mountPath}</Typography.Text>
                      {item.readOnly ? <Tag>只读</Tag> : null}
                    </Space>
                  </List.Item>
                )}
              />
            </>
          ) : null}
        </Space>
      )}
    </DetailSection>
  );
}

function EventsSection({ detail }: ResourceDetailRendererProps) {
  return (
    <DetailSection
      title="事件"
      subtitle="后端聚合的事件摘要"
      extra={
        detail.events.items.length > 0 ? (
          <Typography.Text type="secondary">{detail.events.items.length} 条事件</Typography.Text>
        ) : undefined
      }
    >
      {detail.events.items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无事件" />
      ) : (
        <List
          size="small"
          dataSource={detail.events.items}
          renderItem={(item, index) => (
            <List.Item>
              <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                <Typography.Text strong>{String(item.reason ?? item.type ?? `事件 ${index + 1}`)}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {[item.message, item.action, item.count, item.lastTimestamp]
                    .filter(Boolean)
                    .map((part) => String(part))
                    .join(" · ")}
                </Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      )}
    </DetailSection>
  );
}

function MetadataSection({ detail, onNavigateRequest }: ResourceDetailRendererProps) {
  return (
    <DetailSection title="元数据" subtitle="标签、注解与控制器引用">
      {!hasMetadataContent(detail.metadata) ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无元数据" />
      ) : (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          {detail.metadata.ownerReferences.length > 0 ? (
            <>
              <Typography.Text strong>Owner References</Typography.Text>
              <List
                size="small"
                dataSource={detail.metadata.ownerReferences}
                renderItem={(item) => {
                  const target = onNavigateRequest ? resolveOwnerReferenceNavigation(detail, item) : null;

                  return (
                    <List.Item>
                      <Space wrap size={8}>
                        {item.kind ? <Tag color="purple">{item.kind}</Tag> : null}
                        {item.name ? (
                          target ? (
                            <Typography.Link strong onClick={() => onNavigateRequest?.(target)}>
                              {item.name}
                            </Typography.Link>
                          ) : (
                            <Typography.Text strong>{item.name}</Typography.Text>
                          )
                        ) : null}
                        {item.controller ? <Tag color="success">Controller</Tag> : null}
                        {item.uid ? <Typography.Text type="secondary">{item.uid}</Typography.Text> : null}
                      </Space>
                    </List.Item>
                  );
                }}
              />
            </>
          ) : null}
          {Object.keys(detail.metadata.labels).length > 0 ? (
            <>
              <Typography.Text strong>Labels</Typography.Text>
              <DetailDescriptions
                items={Object.entries(detail.metadata.labels).map(([key, value]) => ({
                  key,
                  label: key,
                  value,
                }))}
              />
            </>
          ) : null}
          {Object.keys(detail.metadata.annotations).length > 0 ? (
            <>
              <Typography.Text strong>Annotations</Typography.Text>
              <DetailDescriptions
                items={Object.entries(detail.metadata.annotations).map(([key, value]) => ({
                  key,
                  label: key,
                  value: (
                    <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>
                      {value}
                    </Typography.Paragraph>
                  ),
                }))}
              />
            </>
          ) : null}
        </Space>
      )}
    </DetailSection>
  );
}

export function ResourceDetailContent({ detail, onNavigateRequest }: ResourceDetailRendererProps) {
  const profile = getRenderProfile(detail);
  const normalizedKind = normalizeKind(detail.descriptor.resourceKind || detail.overview.kind);
  if (AUTOSCALING_KINDS.has(normalizedKind)) {
    const autoscalingSummaryFields = getOrderedFields(detail, "overview", profile.overviewFields).filter(
      (field) => !["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"].includes(field),
    );
    return (
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <OverviewHeroSection detail={detail} onNavigateRequest={onNavigateRequest} />
        <StatusSnapshotSection detail={detail} onNavigateRequest={onNavigateRequest} />
        {autoscalingSummaryFields.length > 0
          ? renderKeyValueSection("补充概览", "保留 HPA/VPA 资源扩展信息", autoscalingSummaryFields, buildOverviewFieldMap(detail))
          : null}
        <AssociationsSection detail={detail} onNavigateRequest={onNavigateRequest} />
        {detail.descriptor.sections.includes("network") ? <NetworkSection detail={detail} onNavigateRequest={onNavigateRequest} /> : null}
        {detail.descriptor.sections.includes("storage") ? <StorageSection detail={detail} /> : null}
        {detail.descriptor.sections.includes("metadata") ? <MetadataSection detail={detail} onNavigateRequest={onNavigateRequest} /> : null}
        {detail.descriptor.sections.includes("events") ? <EventsSection detail={detail} /> : null}
      </Space>
    );
  }
  if (normalizedKind === "gatewayclass") {
    return (
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <OverviewHeroSection detail={detail} onNavigateRequest={onNavigateRequest} />
        <StatusSnapshotSection detail={detail} onNavigateRequest={onNavigateRequest} />
        <GatewayClassHighlightsSection detail={detail} onNavigateRequest={onNavigateRequest} />
        <AssociationsSection detail={detail} onNavigateRequest={onNavigateRequest} />
        <MetadataSection detail={detail} onNavigateRequest={onNavigateRequest} />
      </Space>
    );
  }
  if (normalizedKind === "gateway") {
    return (
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <OverviewHeroSection detail={detail} onNavigateRequest={onNavigateRequest} />
        <StatusSnapshotSection detail={detail} onNavigateRequest={onNavigateRequest} />
        <GatewayHighlightsSection detail={detail} onNavigateRequest={onNavigateRequest} />
        <AssociationsSection detail={detail} onNavigateRequest={onNavigateRequest} />
        <MetadataSection detail={detail} onNavigateRequest={onNavigateRequest} />
      </Space>
    );
  }
  if (normalizedKind === "httproute") {
    return (
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <OverviewHeroSection detail={detail} onNavigateRequest={onNavigateRequest} />
        <StatusSnapshotSection detail={detail} onNavigateRequest={onNavigateRequest} />
        <HttpRouteHighlightsSection detail={detail} onNavigateRequest={onNavigateRequest} />
        <AssociationsSection detail={detail} onNavigateRequest={onNavigateRequest} />
        <NetworkSection detail={detail} onNavigateRequest={onNavigateRequest} />
        <MetadataSection detail={detail} onNavigateRequest={onNavigateRequest} />
      </Space>
    );
  }
  const runtimeFields = getOrderedFields(detail, "runtime", profile.runtimeFields);
  const runtimeValues = buildRuntimeFieldMap(detail.runtime);
  const overviewValues = buildOverviewFieldMap(detail);

  const runtimeDetailFields = runtimeFields.filter(
    (field) =>
      !["phase", "replicas", "readyReplicas", "availableReplicas", "restartCount", "podIP", "nodeName"].includes(field),
  );

  const sectionContent: Partial<Record<ResourceDetailSection, React.ReactNode>> = {
    runtime:
      runtimeDetailFields.length > 0
        ? renderKeyValueSection("运行详情", "镜像、副本与节点等详细字段", runtimeDetailFields, runtimeValues)
        : null,
    associations: <AssociationsSection detail={detail} onNavigateRequest={onNavigateRequest} />,
    network: <NetworkSection detail={detail} onNavigateRequest={onNavigateRequest} />,
    storage: <StorageSection detail={detail} />,
    events: <EventsSection detail={detail} />,
    metadata: <MetadataSection detail={detail} onNavigateRequest={onNavigateRequest} />,
  };

  const supplementaryOverviewFields = getOrderedFields(detail, "overview", profile.overviewFields).filter(
    (field) => !["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"].includes(field),
  );

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <OverviewHeroSection detail={detail} onNavigateRequest={onNavigateRequest} />

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          width: "100%",
        }}
      >
        <StatusSnapshotSection detail={detail} onNavigateRequest={onNavigateRequest} />
        <QuickLinksSection detail={detail} onNavigateRequest={onNavigateRequest} />
      </div>

      {supplementaryOverviewFields.length > 0
        ? renderKeyValueSection("补充概览", "保留概览字段中的扩展信息", supplementaryOverviewFields, overviewValues)
        : null}

      <PodHighlightsSection detail={detail} onNavigateRequest={onNavigateRequest} />
      <WorkloadHighlightsSection detail={detail} onNavigateRequest={onNavigateRequest} />
      <ServiceHighlightsSection detail={detail} onNavigateRequest={onNavigateRequest} />
      <NetworkPolicyHighlightsSection detail={detail} />

      <ServiceBackendsSection detail={detail} onNavigateRequest={onNavigateRequest} />

      {SECTION_PRIORITY.filter((section) => detail.descriptor.sections.includes(section))
        .map((section) => sectionContent[section])
        .filter(Boolean)}
    </Space>
  );
}
