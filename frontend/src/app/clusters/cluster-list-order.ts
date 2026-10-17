import type { RuntimeStatus } from "@/lib/api/cluster-health";

export function sortClustersByRuntimeStatus<T>(
  rows: readonly T[],
  getStatus: (row: T) => RuntimeStatus,
  getName: (row: T) => string,
): T[] {
  const statusRank: Record<RuntimeStatus, number> = {
    running: 0,
    checking: 1,
    "offline-mode": 2,
    disabled: 3,
    offline: 4,
  };
  return [...rows].sort((left, right) => {
    const rankDelta = statusRank[getStatus(left)] - statusRank[getStatus(right)];
    if (rankDelta) return rankDelta;
    return getName(left).localeCompare(getName(right), "zh-CN", { sensitivity: "base", numeric: true });
  });
}
