export type TableDensity = "standard" | "compact";
type DensityStorage = Pick<Storage, "getItem" | "setItem">;

export function readTableDensity(username: string, tableId?: string, storage?: Pick<DensityStorage, "getItem">): TableDensity {
  if (!username || !tableId) return "standard";
  try {
    const source = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
    const raw = source?.getItem(densityKey(username, tableId));
    return raw && JSON.parse(raw) === "compact" ? "compact" : "standard";
  } catch {
    return "standard";
  }
}

export function writeTableDensity(username: string, tableId: string | undefined, density: TableDensity, storage?: Pick<DensityStorage, "setItem">): void {
  if (!username || !tableId) return;
  try {
    const target = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
    target?.setItem(densityKey(username, tableId), JSON.stringify(density));
  } catch {
    // Density remains usable for this session when storage is disabled/full.
  }
}

function densityKey(username: string, tableId: string): string {
  // Keep the existing Headlamp preference namespace, without modifying its
  // unscoped column/filter payload or remote preference contract.
  return `resource-table-preferences:density:${JSON.stringify([username, tableId])}`;
}
