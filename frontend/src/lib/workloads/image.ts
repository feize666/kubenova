import type { WorkloadListItem } from "@/lib/api/workloads";

export const WORKLOAD_IMAGE_PLACEHOLDER = "镜像缺失（待诊断）";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function readContainerImages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const rec = asRecord(entry);
      return rec ? readString(rec.image) : null;
    })
    .filter((entry): entry is string => Boolean(entry));
}

function looksLikeImageRef(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /[/:@]/.test(trimmed) && !trimmed.includes(" ");
}

function readAnnotationImages(value: unknown): string[] {
  const rec = asRecord(value);
  if (!rec) return [];
  const imageKeyPattern = /(?:^|[./-])images?(?:$|[./-])/i;
  const values = Object.entries(rec)
    .filter(([key]) => imageKeyPattern.test(key))
    .flatMap(([, raw]) => {
      if (typeof raw !== "string") return [];
      const text = raw.trim();
      if (!text) return [];
      if (text.startsWith("[") && text.endsWith("]")) {
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) {
            return parsed;
          }
        } catch {
          // ignore parse failure
        }
      }
      return text
        .split(/[\s,;]+/)
        .map((token) => token.trim())
        .filter(Boolean);
    })
    .filter((entry): entry is string => typeof entry === "string")
    .filter((entry) => looksLikeImageRef(entry));

  return Array.from(new Set(values));
}

export function extractWorkloadImages(item: WorkloadListItem): string[] {
  const status = asRecord(item.statusJson);
  const spec = asRecord(item.spec);
  const podSpec = asRecord(spec?.spec);
  const template = asRecord(spec?.template);
  const templateSpec = asRecord(template?.spec);
  const templateMeta = asRecord(template?.metadata);

  // Canonical order from design/backend:
  // 1) spec.containers[*].image
  // 2) spec.template.spec.containers[*].image
  // 3) status.containerImages[*]
  // 4) template annotations
  const fromSpecContainers = readContainerImages(spec?.containers);
  const fromTemplateSpecContainers = readContainerImages(templateSpec?.containers);
  const fromStatusContainerImages = readStringArray(status?.containerImages);
  const fromTemplateAnnotations = readAnnotationImages(templateMeta?.annotations);

  // Compatibility fallbacks for mixed payloads.
  const compatibility = [
    readString(status?.image),
    ...readStringArray(status?.images),
    readString((item as WorkloadListItem & { image?: unknown }).image),
    ...readContainerImages(status?.containerStatuses),
    ...readContainerImages(podSpec?.containers),
  ];

  const candidates = [
    ...fromSpecContainers,
    ...fromTemplateSpecContainers,
    ...fromStatusContainerImages,
    ...fromTemplateAnnotations,
    ...compatibility,
  ].filter((entry): entry is string => Boolean(entry));

  return Array.from(new Set(candidates));
}

export function extractWorkloadImage(
  item: WorkloadListItem,
  fallback = WORKLOAD_IMAGE_PLACEHOLDER,
): string {
  const images = extractWorkloadImages(item);
  return images[0] ?? fallback;
}
