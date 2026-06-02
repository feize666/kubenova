import { apiRequest } from "./client";
import type { MonitoringTimePreset } from "./monitoring";

export interface AiopsIncidentItem {
  id: string;
  title: string;
  severity: "critical" | "warning" | "info";
  status: "open" | "investigating" | "mitigated";
  affectedScope: string;
  confidence: number;
  startedAt: string;
  evidenceCount: number;
  topologyImpact: string;
  source: "alert" | "inspection" | "derived";
}

export interface AiopsRecommendationItem {
  id: string;
  incidentId: string;
  type: "diagnosis" | "runbook" | "safe-action";
  riskLevel: "low" | "medium" | "high";
  summary: string;
  expectedResult: string;
  rollbackHint: string;
  approvalRequired: boolean;
  precheckStatus: "not-required" | "pending";
}

export interface AiopsRecommendationPrecheck {
  recommendationId: string;
  incidentId: string;
  status: "passed" | "blocked";
  checks: Array<{
    key: string;
    label: string;
    status: "passed" | "blocked";
    message: string;
  }>;
  approvalRequired: boolean;
  audit?: {
    id: string;
    timestamp: string;
  };
  rollbackHint: string;
  timestamp: string;
}

export interface AiopsRecommendationApproval {
  recommendationId: string;
  incidentId: string;
  approved: boolean;
  executionStatus: "not-executed";
  audit: {
    id: string;
    timestamp: string;
  };
  message: string;
  rollbackHint: string;
  timestamp: string;
}

export interface AiopsSummary {
  range: MonitoringTimePreset;
  timestamp: string;
  anomalyOverview: {
    total: number;
    critical: number;
    warning: number;
    source: "monitoring-alert" | "workload-derived" | "mixed";
    degraded: boolean;
  };
  incidentQueue: AiopsIncidentItem[];
  correlationGroups: Array<{
    id: string;
    title: string;
    severity: "critical" | "warning" | "info";
    incidentCount: number;
    affectedScopes: string[];
    evidence: string[];
  }>;
  topImpactedServices: Array<{
    key: string;
    label: string;
    severity: "critical" | "warning" | "info";
    incidentCount: number;
  }>;
  rootCauseCandidates: Array<{
    incidentId: string;
    title: string;
    confidence: number;
    evidence: string[];
    modelType: "rule" | "statistical" | "generated";
    humanState: "unreviewed" | "confirmed" | "rejected";
  }>;
  recommendations: AiopsRecommendationItem[];
  auditState: {
    readOnly: boolean;
    approvalRequiredForMutations: boolean;
    auditTrailReady: boolean;
  };
  degraded: boolean;
  note?: string;
}

export async function getAiopsSummary(
  options: { range?: MonitoringTimePreset; from?: string; to?: string } = {},
  token?: string,
  requestOptions: { signal?: AbortSignal } = {},
): Promise<AiopsSummary> {
  return apiRequest<AiopsSummary>("/api/aiops/summary", {
    query: { range: options.range, from: options.from, to: options.to },
    token,
    signal: requestOptions.signal,
  });
}

export async function precheckAiopsRecommendation(
  recommendationId: string,
  token?: string,
): Promise<AiopsRecommendationPrecheck> {
  return apiRequest<AiopsRecommendationPrecheck>("/api/aiops/recommendations/precheck", {
    method: "POST",
    body: { recommendationId },
    token,
  });
}

export async function approveAiopsRecommendation(
  recommendationId: string,
  token?: string,
): Promise<AiopsRecommendationApproval> {
  return apiRequest<AiopsRecommendationApproval>("/api/aiops/recommendations/approve", {
    method: "POST",
    body: { recommendationId },
    token,
  });
}
