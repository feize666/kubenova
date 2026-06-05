"use client";

import { Empty, Space, Typography } from "antd";
import type { ReactNode } from "react";
import type { ResourceDetailEvent } from "@/lib/api/resources";
import { StatusTag } from "@/components/status-tag";
import { DetailDescriptions, DetailSection, DetailTag, DetailChipList } from "./section-primitives";
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
} from "./utils";

export interface DetailSectionBuilderContext extends ResourceDetailRendererProps {
  specSnapshot?: Record<string, unknown>;
  statusSnapshot?: Record<string, unknown>;
}

function renderFieldValue(field: string, value: unknown) {
  if ((field === "state" || field === "phase") && typeof value === "string" && value) {
    return <StatusTag state={value} />;
  }
  if ((field === "createdAt" || field === "updatedAt") && typeof value === "string") {
    return formatDateTime(value);
  }
  if (field === "images" && Array.isArray(value)) {
    return <DetailChipList items={value.filter((item): item is string => typeof item === "string")} color="blue" />;
  }
  return formatValue(value);
}

function toDescriptionItems(fields: string[], values: Record<string, unknown>) {
  return fields
    .filter((field) => values[field] !== undefined && values[field] !== "")
    .map((field) => ({
      key: field,
      label: humanizeFieldLabel(field),
      value: renderFieldValue(field, values[field]),
    }));
}

function mapEntriesToDescriptions(value: Record<string, string>) {
  return Object.entries(value).map(([key, inner]) => ({
    key,
    label: key,
    value: (
      <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {inner}
      </Typography.Paragraph>
    ),
  }));
}

function getObjectEntries(value?: Record<string, unknown>) {
  return Object.entries(value ?? {}).filter(([, inner]) => inner !== undefined && inner !== null && inner !== "");
}

function renderReadonlyObjectSummary(value: Record<string, unknown> | undefined, emptyText: string) {
  const entries = getObjectEntries(value).slice(0, 16);
  if (entries.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }
  return (
    <DetailDescriptions
      items={entries.map(([key, inner]) => ({
        key,
        label: humanizeFieldLabel(key),
        value: typeof inner === "object" ? (
          <Typography.Text code style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {JSON.stringify(inner)}
          </Typography.Text>
        ) : (
          renderFieldValue(key, inner)
        ),
      }))}
    />
  );
}

function eventText(item: ResourceDetailEvent, keys: string[]) {
  for (const key of keys) {
    const value = key.split(".").reduce<unknown>((current, part) => {
      if (!current || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[part];
    }, item);
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return undefined;
}

export function buildOverviewSection({ detail, clusterMap }: DetailSectionBuilderContext): ReactNode {
  const profile = getRenderProfile(detail);
  const fields = getOrderedFields(detail, "overview", profile.overviewFields);
  return (
    <DetailSection title="Overview" subtitle="资源身份、范围与生命周期">
      <DetailDescriptions items={toDescriptionItems(fields, buildOverviewFieldMap(detail, clusterMap))} emptyText="暂无概览" />
    </DetailSection>
  );
}

export function buildMetadataSection({ detail }: DetailSectionBuilderContext): ReactNode {
  const ownerRefs = detail.metadata.ownerReferences;
  const configUsages = detail.metadata.configUsages;
  const items = [
    { key: "uid", label: "资源 ID", value: detail.overview.id },
    { key: "apiVersion", label: "API Version", value: detail.descriptor.version },
    { key: "labels", label: "Labels", value: Object.keys(detail.metadata.labels).length },
    { key: "annotations", label: "Annotations", value: Object.keys(detail.metadata.annotations).length },
    ownerRefs.length > 0 ? { key: "ownerReferences", label: "Owner References", value: ownerRefs.length } : null,
    configUsages.length > 0 ? { key: "configUsages", label: "配置引用", value: configUsages.length } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; value: ReactNode }>;

  return (
    <DetailSection title="Metadata" subtitle="元数据摘要；关系细节见关系导航">
      {!hasMetadataContent(detail.metadata) && items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无元数据" />
      ) : (
        <DetailDescriptions items={items} />
      )}
    </DetailSection>
  );
}

export function buildLabelsSection({ detail }: DetailSectionBuilderContext): ReactNode {
  return (
    <DetailSection title="Labels" subtitle="Kubernetes 标签">
      {Object.keys(detail.metadata.labels).length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Labels" />
      ) : (
        <DetailDescriptions items={mapEntriesToDescriptions(detail.metadata.labels)} />
      )}
    </DetailSection>
  );
}

export function buildAnnotationsSection({ detail }: DetailSectionBuilderContext): ReactNode {
  return (
    <DetailSection title="Annotations" subtitle="Kubernetes 注解，只读摘要">
      {Object.keys(detail.metadata.annotations).length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Annotations" />
      ) : (
        <DetailDescriptions items={mapEntriesToDescriptions(detail.metadata.annotations)} />
      )}
    </DetailSection>
  );
}

export function buildSpecSection({ detail, specSnapshot }: DetailSectionBuilderContext): ReactNode {
  const fields = getOrderedFields(detail, "runtime", getRenderProfile(detail).runtimeFields);
  const runtimeValues = buildRuntimeFieldMap(detail.runtime);
  return (
    <DetailSection title="Spec" subtitle={specSnapshot ? "Kubernetes spec 只读摘要" : "当前仅展示可用运行/配置摘要"}>
      {specSnapshot ? (
        renderReadonlyObjectSummary(specSnapshot, "暂无 Spec 摘要")
      ) : (
        <DetailDescriptions items={toDescriptionItems(fields, runtimeValues)} emptyText="暂无 Spec 摘要" />
      )}
    </DetailSection>
  );
}

export function buildStatusSection({ detail, statusSnapshot }: DetailSectionBuilderContext): ReactNode {
  const profile = getRenderProfile(detail);
  const runtimeFields = getOrderedFields(detail, "runtime", profile.runtimeFields);
  const runtimeValues = buildRuntimeFieldMap(detail.runtime);
  const statusFieldCandidates = [
    "phase",
    "replicas",
    "readyReplicas",
    "availableReplicas",
    "restartCount",
    "podIP",
    "nodeName",
  ];
  const statusFields = statusFieldCandidates.filter((field) =>
    runtimeFields.includes(field),
  );
  return (
    <DetailSection title="Status" subtitle="健康、阶段与条件">
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        {statusSnapshot ? (
          renderReadonlyObjectSummary(statusSnapshot, "暂无 Status 摘要")
        ) : (
          <DetailDescriptions items={toDescriptionItems(statusFields, runtimeValues)} emptyText="暂无 Status 摘要" />
        )}
        {detail.runtime.conditions && detail.runtime.conditions.length > 0 ? (
          <Space wrap size={[6, 6]}>
            {detail.runtime.conditions.slice(0, 12).map((condition, index) => (
              <DetailTag
                key={`${condition.type ?? "condition"}-${index}`}
                color={condition.status === "True" ? "green" : "default"}
              >
                {[condition.type, condition.status, condition.reason].filter(Boolean).join(" / ")}
              </DetailTag>
            ))}
          </Space>
        ) : null}
      </Space>
    </DetailSection>
  );
}

export function buildEventsSection({ detail }: DetailSectionBuilderContext): ReactNode {
  return (
    <DetailSection
      title="Events"
      subtitle="Type / Reason / Message / Count / Last Seen / Source"
      extra={
        detail.events.items.length > 0 ? (
          <Typography.Text type="secondary">{detail.events.items.length} 条</Typography.Text>
        ) : undefined
      }
    >
      {detail.events.items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无事件" />
      ) : (
        <Space orientation="vertical" size={10} style={{ width: "100%" }}>
          {detail.events.items.map((item, index) => (
            <div key={item.id ?? `${item.name ?? "event"}-${index}`}>
              <Space wrap size={[6, 6]}>
                <DetailTag color={(eventText(item, ["type"]) ?? "").toLowerCase().includes("warn") ? "error" : "success"}>
                  {eventText(item, ["type"]) ?? "Normal"}
                </DetailTag>
                <Typography.Text strong>{eventText(item, ["reason", "name"]) ?? `事件 ${index + 1}`}</Typography.Text>
                {eventText(item, ["count"]) ? <DetailTag>Count {eventText(item, ["count"])}</DetailTag> : null}
                <Typography.Text type="secondary">
                  {formatDateTime(eventText(item, ["lastTimestamp", "eventTime", "firstTimestamp"]))}
                </Typography.Text>
              </Space>
              <Typography.Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 0 }}>
                {[eventText(item, ["message"]), eventText(item, ["source", "reportingComponent"])]
                  .filter(Boolean)
                  .join(" · ")}
              </Typography.Paragraph>
            </div>
          ))}
        </Space>
      )}
    </DetailSection>
  );
}

export function buildHeadlampDetailSections(context: DetailSectionBuilderContext): ReactNode[] {
  const sections: ReactNode[] = [
    buildOverviewSection(context),
    buildMetadataSection(context),
    buildLabelsSection(context),
    buildAnnotationsSection(context),
    buildSpecSection(context),
    buildStatusSection(context),
  ];
  if (context.detail.descriptor.sections.includes("events")) {
    sections.push(buildEventsSection(context));
  }
  return sections;
}
