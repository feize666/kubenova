import { apiRequest } from "./client";

export type CapabilityBaselineStatus = "implemented" | "planned" | "gap" | "in-progress" | "blocked" | "unknown";
export interface CapabilityDescriptor {
  key: string;
  route: string;
  enabled: boolean;
  minContractVersion: string;
}

export interface CapabilityBaselineMatrixItem {
  category: string;
  capabilityName: string;
  status: CapabilityBaselineStatus;
  rancherAlignment: string;
  kubesphereAlignment: string;
  trackedTask?: string | null;
  updatedAt?: string | null;
}

export interface CapabilityBaselineIntegrityIssue {
  capabilityKey?: string;
  field?: string;
  message: string;
}

interface CapabilityBaselineResponseRaw {
  items?: CapabilityBaselineMatrixItem[];
  matrix?: CapabilityBaselineMatrixItem[];
  summary?: {
    total?: number;
    implemented?: number;
    planned?: number;
    gap?: number;
    [key: string]: number | undefined;
  };
  integrityIssues?: Array<string | CapabilityBaselineIntegrityIssue>;
  updatedAt?: string;
}

export interface CapabilityBaselineResponse {
  items: CapabilityBaselineMatrixItem[];
  summary?: {
    total?: number;
    implemented?: number;
    planned?: number;
    gap?: number;
    [key: string]: number | undefined;
  };
  integrityIssues: string[];
  updatedAt?: string;
}

export async function listCapabilities(token?: string): Promise<CapabilityDescriptor[]> {
  return apiRequest<CapabilityDescriptor[]>("/api/capabilities", {
    token,
  });
}

export async function getCapabilityBaseline(token?: string): Promise<CapabilityBaselineResponse> {
  const response = await apiRequest<CapabilityBaselineResponseRaw>("/api/capability-baseline", {
    token,
  });

  return {
    items: response.items ?? response.matrix ?? [],
    summary: response.summary,
    integrityIssues: (response.integrityIssues ?? []).map((item) => {
      if (typeof item === "string") return item;
      return item?.message ?? JSON.stringify(item);
    }),
    updatedAt: response.updatedAt,
  };
}
