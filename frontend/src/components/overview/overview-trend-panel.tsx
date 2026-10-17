import type { ReactNode } from "react";
export function OverviewTrendPanel({ title, freshness, children }: { title: string; source?: string; capturedAt?: string | null; freshness: string; children: ReactNode }) { return <div className="ops-overview-trend-panel"><div className="ops-overview-trend-panel__header"><strong>{title}</strong><span>{freshness}</span></div>{children}</div>; }
