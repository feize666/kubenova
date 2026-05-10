import type { QueryParams } from "@/lib/contracts";

type Primitive = string | number | boolean | null;
type KeyValue = Primitive | KeyValue[] | { [key: string]: KeyValue };

type KeyObject = Record<string, unknown>;

function normalizeValue(value: unknown): KeyValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => normalizeValue(item))
      .filter((item): item is KeyValue => item !== undefined);
    return normalized;
  }

  if (typeof value === "object") {
    const source = value as KeyObject;
    const normalizedEntries = Object.keys(source)
      .sort()
      .map((key) => [key, normalizeValue(source[key])] as const)
      .filter((entry): entry is readonly [string, KeyValue] => entry[1] !== undefined);

    const normalizedObject: { [key: string]: KeyValue } = {};
    for (const [key, item] of normalizedEntries) {
      normalizedObject[key] = item;
    }

    return normalizedObject;
  }

  return String(value);
}

function normalizeParams(params?: QueryParams | Record<string, unknown>) {
  return normalizeValue(params ?? {}) as KeyValue;
}

export function moduleQueryKeys(moduleName: string) {
  return {
    all: [moduleName] as const,
    lists: () => [moduleName, "list"] as const,
    list: (params?: QueryParams | Record<string, unknown>) => [moduleName, "list", normalizeParams(params)] as const,
    details: () => [moduleName, "detail"] as const,
    detail: (id: string) => [moduleName, "detail", id] as const,
  };
}

export const queryKeys = {
  clusters: moduleQueryKeys("clusters"),
  configs: {
    all: ["configs"] as const,
    lists: () => ["configs", "list"] as const,
    list: (kind: string, params?: QueryParams | Record<string, unknown>) =>
      ["configs", "list", kind, normalizeParams(params)] as const,
    details: () => ["configs", "detail"] as const,
    detail: (kind: string, name: string) => ["configs", "detail", kind, name] as const,
  },
  users: moduleQueryKeys("users"),
  rbac: moduleQueryKeys("rbac"),
  workloads: {
    all: ["workloads"] as const,
    lists: () => ["workloads", "list"] as const,
    list: (kind: string, params?: QueryParams | Record<string, unknown>) =>
      ["workloads", "list", kind, normalizeParams(params)] as const,
    details: () => ["workloads", "detail"] as const,
    detail: (kind: string, name: string) => ["workloads", "detail", kind, name] as const,
  },
} as const;
