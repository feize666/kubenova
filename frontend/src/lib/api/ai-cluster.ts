import { apiRequest } from "./client";

export interface ClusterAiResponse {
  clusterId: string;
  response?: string;
  content?: string;
  text?: string;
  model?: string;
  generatedAt?: string;
  evidence?: Record<string, unknown>;
  [key: string]: unknown;
}

export function analyzeCluster(clusterId: string, evidence: Record<string, unknown> = {}, token?: string) {
  return apiRequest<ClusterAiResponse, { evidence: Record<string, unknown> }>(
    `/api/clusters/${encodeURIComponent(clusterId)}/ai/analyze`,
    { method: "POST", token, body: { evidence } },
  );
}

export function chatWithClusterAgent(clusterId: string, message: string, agentId?: string, token?: string) {
  return apiRequest<ClusterAiResponse, { message: string; agentId?: string }>(
    `/api/clusters/${encodeURIComponent(clusterId)}/ai/chat`,
    { method: "POST", token, body: { message, agentId } },
  );
}
