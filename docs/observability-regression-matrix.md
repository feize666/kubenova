# Observability Regression Matrix

## Scope

Primary spec: `.codex/specs/ops-console-unified-experience`, Requirement 9.

This matrix records the current Observability Center regression scope after the unified summary API, entity health matrix, signal linkage, SLO fields, owner/runbook/notification metadata, and external deep-link contract landed.

## Coverage

| Area | Route/API | Required behavior | Current status | Evidence |
| --- | --- | --- | --- | --- |
| Data source status | `/observability`, `GET /api/monitoring/observability/summary` | Show metrics/logs/traces/events/alerts/SLO availability and degraded notes | Implemented | `sourceStatus` cards. |
| Entity health | `/observability` | Show cluster/namespace/workload/service/pod/node/network health | Implemented | Entity health table. |
| Unified time range | `/observability` | Apply one range to summary, entity detail, signal deep links | Implemented | Range selector and `timeRange` in summary response. |
| Signal linkage | Entity drawer | Show metrics/logs/traces/events/alerts status per entity | Implemented | Entity signal drawer. |
| Events and alerts | `/observability` | Show active alert posture and recent events | Implemented | Summary cards and recent events table. |
| SLO | Entity drawer | Show target, burn rate, error budget, and status | Implemented | `entity.slo` rendered in drawer. |
| Alert ownership | Entity drawer | Show owner and notification status | Implemented | `alertOwner` and `notificationStatus`. |
| Runbook | Entity drawer | Show runbook URL when configured | Implemented | `OBSERVABILITY_RUNBOOK_URL` deep link. |
| External deep links | Entity drawer / source cards | Preserve Grafana, logs, traces, Alertmanager, SLO, runbook links when configured | Implemented | `deepLinks` and `externalLinks` fields. |
| Degraded state | `/observability` | Keep available panels usable when a source is unavailable | Implemented | `degraded` flag and per-source notes. |

## Current Constraints

- Metrics availability still depends on metrics-server snapshots from existing live metrics plumbing.
- Traces, SLO, Alertmanager, Grafana, logs, and runbook integrations are expressed as environment-backed deep links; no vendor SDK query fanout is implemented yet.
- Entity drawer is an observability context drawer, not a Kubernetes resource detail drawer; Kubernetes resource YAML/actions remain in the global resource detail drawer.
- Node total remains zero until a durable synced node inventory table exists; `/clusters/nodes` still provides live node inventory.

## Minimal Verification

- 2026-05-29 task 12.7 browser focused regression:
  - `/observability` loaded summary, degraded source banner, data-source cards, entity table, signal linkage table, and recent events with `consoleErrorCount=0`.
  - `/observability/cluster-health` loaded list and filters with `consoleErrorCount=0`.
  - Cluster-health drawer opened for `ai`; drawer manual probe completed with `consoleErrorCount=0`.
- `cd backend/control-api && npm run build`
- `cd backend/control-api && npm run test -- aiops.controller.spec.ts aiops.service.spec.ts monitoring.controller.spec.ts --runInBand`
- `cd frontend && npm run lint -- --max-warnings=0`
- `cd frontend && npx tsc --noEmit --incremental false`
- `git diff --check`
