"use client";

import type { ReactNode } from "react";
import type { ResourceDetailResponse, ResourceDetailSection } from "@/lib/api/resources";

export interface ResourceDetailClientSnapshot {
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  labels?: Record<string, string>;
}

export interface ResourceDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  token?: string;
  request: {
    kind: string;
    id: string;
    snapshot?: ResourceDetailClientSnapshot;
  } | null;
  width?: number;
  extra?: ReactNode;
  children?: ReactNode;
  onNavigateRequest?: (request: { kind: string; id: string; snapshot?: ResourceDetailClientSnapshot }) => void;
}

export interface ResourceDetailRendererProps {
  detail: ResourceDetailResponse;
  snapshot?: ResourceDetailClientSnapshot;
  onNavigateRequest?: (request: { kind: string; id: string; snapshot?: ResourceDetailClientSnapshot }) => void;
}

export interface ResourceDetailRenderProfile {
  title: string;
  overviewFields: string[];
  runtimeFields: string[];
}

export type SectionFieldMap = Record<ResourceDetailSection, string[]>;
