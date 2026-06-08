import type { ColumnsType } from "antd/es/table";

export const TABLE_COL_WIDTH = {
  name: 220,
  nameCompact: 200,
  nameWide: 240,
  cluster: 160,
  namespace: 160,
  status: 110,
  state: 130,
  time: 180,
  updateTime: 180,
  action: 96,
  actionWide: 110,
  actionCompact: 86,
  image: 260,
  imageCompact: 240,
  type: 140,
  version: 110,
  revision: 110,
  ip: 140,
  node: 140,
  replicas: 96,
  ready: 96,
  restart: 116,
  metric: 160,
  available: 96,
  chart: 220,
  release: 220,
  url: 360,
  capacity: 120,
  storageClass: 140,
  accessModes: 180,
  provisioner: 220,
  ports: 220,
  address: 220,
  schedule: 160,
  strategy: 120,
} as const;

type WidthInput = number | string | undefined;

type AdaptiveWidthOptions = {
  min?: number;
  max?: number;
  fallback?: number;
  padding?: number;
};

type WidthLike = number | string | undefined;

export type AutoFitTableColumnsOptions<T> = {
  enabled?: boolean;
  rows?: readonly T[];
  sampleSize?: number;
  min?: number;
  max?: number;
  fallback?: number;
  padding?: number;
};

export type StandardTableLayoutOptions<T> = {
  nameValues?: Array<string | null | undefined>;
  nameWidthOptions?: AdaptiveWidthOptions;
  actionWidth?: number;
  columns?: ColumnsType<T>;
  autoFit?: boolean | AutoFitTableColumnsOptions<T>;
};

const DEFAULT_NAME_WIDTH_OPTIONS = {
  min: 180,
  max: 360,
  fallback: TABLE_COL_WIDTH.name,
  padding: 64,
} satisfies Required<AdaptiveWidthOptions>;

const DEFAULT_AUTOFIT_OPTIONS = {
  enabled: true,
  sampleSize: 24,
  min: 96,
  max: 420,
  fallback: TABLE_COL_WIDTH.namespace,
  padding: 48,
} satisfies Required<Omit<AutoFitTableColumnsOptions<unknown>, "rows">>;

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

function normalizeWidth(width: WidthLike): number | undefined {
  if (typeof width === "number" && Number.isFinite(width)) {
    return width;
  }
  if (typeof width === "string") {
    const parsed = Number.parseFloat(width);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function estimateTextWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    if (/\s/.test(char)) {
      width += 4;
      continue;
    }
    if (/[A-Z]/.test(char)) {
      width += 10;
      continue;
    }
    if (/[a-z0-9]/.test(char)) {
      width += 8;
      continue;
    }
    if (/[\u4e00-\u9fff]/.test(char)) {
      width += 16;
      continue;
    }
    width += 9;
  }
  return width;
}

function resolveTitleText(title: unknown): string {
  if (typeof title === "string" || typeof title === "number") {
    return String(title);
  }
  return "";
}

function resolveDataIndexValue<T>(record: T, dataIndex: unknown): unknown {
  if (!record || typeof record !== "object") {
    return undefined;
  }

  const path = Array.isArray(dataIndex) ? dataIndex : typeof dataIndex === "string" ? dataIndex.split(".") : [];
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[String(key)];
  }, record);
}

function stringifyCellSample(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 3)
      .map((item) => stringifyCellSample(item))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    const named = (value as { name?: unknown; id?: unknown; value?: unknown }).name
      ?? (value as { id?: unknown }).id
      ?? (value as { value?: unknown }).value;
    return stringifyCellSample(named);
  }
  return "";
}

function getAutoFitOptions<T>(
  options: StandardTableLayoutOptions<T>,
): Required<Omit<AutoFitTableColumnsOptions<T>, "rows">> & { rows: readonly T[] } {
  if (typeof options.autoFit === "object") {
    const autoFit = options.autoFit;
    return {
      ...DEFAULT_AUTOFIT_OPTIONS,
      ...autoFit,
      enabled: autoFit.enabled ?? DEFAULT_AUTOFIT_OPTIONS.enabled,
      rows: autoFit.rows ?? [],
    };
  }
  return {
    ...DEFAULT_AUTOFIT_OPTIONS,
    enabled: options.autoFit ?? DEFAULT_AUTOFIT_OPTIONS.enabled,
    rows: [],
  };
}

function estimateAutoFitWidth<T>(
  column: NonNullable<ColumnsType<T>[number]>,
  options: Required<Omit<AutoFitTableColumnsOptions<T>, "rows">> & { rows: readonly T[] },
): number | undefined {
  if (!options.enabled) {
    return undefined;
  }

  const dataIndex = (column as { dataIndex?: unknown }).dataIndex;
  const samples = options.rows.slice(0, options.sampleSize).map((record) => stringifyCellSample(resolveDataIndexValue(record, dataIndex)));
  const titleWidth = estimateTextWidth(resolveTitleText((column as { title?: unknown }).title));
  const sampleWidth = samples.reduce((maxWidth, value) => Math.max(maxWidth, estimateTextWidth(value)), 0);
  const estimated = Math.max(titleWidth, sampleWidth);

  if (estimated <= 0) {
    return options.fallback;
  }

  return clampWidth(estimated + options.padding, options.min, options.max);
}

export function getAdaptiveNameWidth(
  values: Array<string | null | undefined>,
  options: AdaptiveWidthOptions = {},
): number {
  const merged = { ...DEFAULT_NAME_WIDTH_OPTIONS, ...options };
  const measured = values.reduce((maxWidth, value) => {
    const text = String(value ?? "").trim();
    if (!text) {
      return maxWidth;
    }
    return Math.max(maxWidth, estimateTextWidth(text));
  }, merged.fallback);

  return clampWidth(measured + merged.padding, merged.min, merged.max);
}

export function getTableScrollX(
  columns: Array<{ width?: WidthInput } | null | undefined>,
  options: { fallbackWidth?: number; extraWidth?: number } = {},
): number {
  const fallbackWidth = options.fallbackWidth ?? TABLE_COL_WIDTH.namespace;
  const extraWidth = options.extraWidth ?? 0;
  const total = columns.reduce((sum, column) => {
    if (!column) {
      return sum;
    }
    return sum + (normalizeWidth(column.width) ?? fallbackWidth);
  }, extraWidth);

  return Math.max(Math.round(total), fallbackWidth);
}

function normalizeIdentity(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function resolveColumnIdentity<T>(column: NonNullable<ColumnsType<T>[number]>): string {
  const identities = [
    (column as { key?: unknown }).key,
    (column as { dataIndex?: unknown }).dataIndex,
    (column as { title?: unknown }).title,
  ]
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .map((item) => normalizeIdentity(item));

  return identities.filter(Boolean).join(" ");
}

function matchesAny(identity: string, patterns: string[]): boolean {
  return patterns.some((pattern) => identity.includes(pattern));
}

function inferStandardWidth<T>(
  column: NonNullable<ColumnsType<T>[number]>,
  nameWidth: number,
  actionWidth: number,
  autoFitOptions: Required<Omit<AutoFitTableColumnsOptions<T>, "rows">> & { rows: readonly T[] },
): number | undefined {
  const explicitWidth = normalizeWidth((column as { width?: WidthLike }).width);
  if (typeof explicitWidth === "number") {
    return explicitWidth;
  }

  const identity = resolveColumnIdentity(column);

  if (!identity) {
    return estimateAutoFitWidth(column, autoFitOptions);
  }

  if (matchesAny(identity, ["name", "名称", "卷名称", "服务名称", "仓库名称", "release", "chart"])) {
    return nameWidth;
  }
  if (matchesAny(identity, ["cluster", "集群", "clusterid"])) {
    return TABLE_COL_WIDTH.cluster;
  }
  if (matchesAny(identity, ["namespace", "名称空间"])) {
    return TABLE_COL_WIDTH.namespace;
  }
  if (matchesAny(identity, ["status", "状态", "phase"])) {
    return TABLE_COL_WIDTH.status;
  }
  if (matchesAny(identity, ["state", "启用状态", "绑定状态"])) {
    return TABLE_COL_WIDTH.state;
  }
  if (matchesAny(identity, ["createdat", "updatedat", "更新时间", "创建时间", "最近执行"])) {
    return TABLE_COL_WIDTH.time;
  }
  if (matchesAny(identity, ["type", "类型"])) {
    return TABLE_COL_WIDTH.type;
  }
  if (matchesAny(identity, ["version", "revision", "修订版本"])) {
    return TABLE_COL_WIDTH.version;
  }
  if (matchesAny(identity, ["ip", "pod ip", "cluster ip"])) {
    return TABLE_COL_WIDTH.ip;
  }
  if (matchesAny(identity, ["node", "节点"])) {
    return TABLE_COL_WIDTH.node;
  }
  if (matchesAny(identity, ["ready", "就绪", "readyreplicas"])) {
    return TABLE_COL_WIDTH.ready;
  }
  if (matchesAny(identity, ["replicas", "副本"])) {
    return TABLE_COL_WIDTH.replicas;
  }
  if (matchesAny(identity, ["restart", "重启"])) {
    return TABLE_COL_WIDTH.restart;
  }
  if (matchesAny(identity, ["cpu", "memory", "内存", "使用率"])) {
    return TABLE_COL_WIDTH.metric;
  }
  if (matchesAny(identity, ["capacity", "容量"])) {
    return TABLE_COL_WIDTH.capacity;
  }
  if (matchesAny(identity, ["storageclass", "存储类"])) {
    return TABLE_COL_WIDTH.storageClass;
  }
  if (matchesAny(identity, ["accessmodes", "访问模式"])) {
    return TABLE_COL_WIDTH.accessModes;
  }
  if (matchesAny(identity, ["provisioner"])) {
    return TABLE_COL_WIDTH.provisioner;
  }
  if (matchesAny(identity, ["ports", "端口"])) {
    return TABLE_COL_WIDTH.ports;
  }
  if (matchesAny(identity, ["address", "地址", "地址预览"])) {
    return TABLE_COL_WIDTH.address;
  }
  if (matchesAny(identity, ["schedule", "调度"])) {
    return TABLE_COL_WIDTH.schedule;
  }
  if (matchesAny(identity, ["strategy", "策略"])) {
    return TABLE_COL_WIDTH.strategy;
  }
  if (matchesAny(identity, ["actions", "quick-actions", "操作"])) {
    return actionWidth;
  }

  return estimateAutoFitWidth(column, autoFitOptions);
}

export function normalizeResourceTableColumns<T>(
  columns: ColumnsType<T>,
  options: StandardTableLayoutOptions<T> = {},
): ColumnsType<T> {
  const nameWidth = getAdaptiveNameWidth(options.nameValues ?? [], options.nameWidthOptions ?? {});
  const actionWidth = options.actionWidth ?? TABLE_COL_WIDTH.actionCompact;
  const autoFitOptions = getAutoFitOptions(options);

  return columns.map((column) => {
    if (!column || typeof column !== "object") {
      return column;
    }
    const identity = resolveColumnIdentity(column as NonNullable<ColumnsType<T>[number]>);
    const isActionColumn = matchesAny(identity, ["actions", "quick-actions", "操作"]);
    const normalizedWidth = inferStandardWidth(
      column as NonNullable<ColumnsType<T>[number]>,
      nameWidth,
      actionWidth,
      autoFitOptions,
    );
    if (typeof normalizedWidth === "number") {
      return {
        ...column,
        width: normalizedWidth,
        ellipsis: (column as { ellipsis?: boolean }).ellipsis ?? true,
        className: [isActionColumn ? "resource-table-actions-cell" : undefined, (column as { className?: string }).className]
          .filter(Boolean)
          .join(" "),
      };
    }
    if (isActionColumn) {
      return {
        ...column,
        className: ["resource-table-actions-cell", (column as { className?: string }).className]
          .filter(Boolean)
          .join(" "),
      };
    }
    return column;
  });
}

export function getStandardResourceTableScrollX<T>(
  columns: ColumnsType<T>,
  options: { fallbackWidth?: number } = {},
): number {
  return getTableScrollX(columns, {
    fallbackWidth: options.fallbackWidth,
  });
}
