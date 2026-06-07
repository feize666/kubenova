# KubeNova Regression Matrix

## Scope

Primary spec: `.codex/specs/ops-console-unified-experience`, Requirement 10.

This matrix records the current KubeNova Center regression scope after the read-path, Incident Workbench, recommendation, precheck, approval, audit, and rollback-hint foundation landed.

## Coverage

| Area | Route/API | Required behavior | Current status | Evidence |
| --- | --- | --- | --- | --- |
| Anomaly overview | `/aiops`, `GET /api/aiops/summary` | Show total, critical, warning, source, degraded state | Implemented | `AiopsSummaryResponse.anomalyOverview` and `/aiops` statistics. |
| Incident queue | `/aiops`, `GET /api/aiops/summary` | Show incident title, severity, status, affected scope, confidence, topology impact | Implemented | `incidentQueue` table opens workbench drawer. |
| Correlation groups | `/aiops`, `GET /api/aiops/summary` | Group incidents by affected scope and expose evidence | Implemented | `correlationGroups` in API and Incident Workbench drawer. |
| Top impacted services | `GET /api/aiops/summary` | Return ranked impacted scopes | Implemented | `topImpactedServices` response field. |
| Root-cause candidates | `/aiops`, `GET /api/aiops/summary` | Show title, confidence, evidence, model type, human review state | Implemented | Root-cause cards and workbench section. |
| Recommendation records | `/aiops`, `GET /api/aiops/summary` | Show risk, expected result, rollback hint, precheck and approval requirements | Implemented | Recommendation table and expandable details. |
| Precheck | `POST /api/aiops/recommendations/precheck` | Validate recommendation identity, approval need, rollback note; record non-mutating audit | Implemented | Controller test and workbench Precheck action. |
| Approval | `POST /api/aiops/recommendations/approve` | Require write permission, record approval audit, do not execute cluster mutation | Implemented | Controller test and workbench approval action. |
| Audit | governance audit store | Capture actor, role, action, resource type/id, result, request id | Implemented | `appendAudit` used by precheck and approval. |
| Rollback hint | API and UI | Show rollback guidance before any mutating execution path exists | Implemented | Recommendation records, approval response, workbench alert. |

## Current Constraints

- KubeNova execution remains intentionally separated from approval. `approve` returns `executionStatus: not-executed` and records audit only.
- Incident correlation currently derives from existing monitoring alerts, inspection issues, and observability summary; no external ML/anomaly backend is integrated yet.
- Human review state is represented in root-cause candidates, but no persistent reviewer workflow exists yet.
- Topology impact is a stable textual reference today; graph focus integration remains part of the broader resource panorama follow-up.

## Minimal Verification

- 2026-05-29 task 12.7 browser focused regression:
  - `/aiops` loaded anomaly overview, degraded analysis banner, incident queue, root-cause cards, and recommendation table with `consoleErrorCount=0`.
  - Incident Workbench opened for `集群健康状态异常`; evidence timeline, correlation group, root-cause candidate, and recommendation/approval sections rendered with `consoleErrorCount=0`.
  - Recommendation row expanded; Precheck and approval actions completed with `consoleErrorCount=0`.
- 2026-05-29 task 12.7 fix evidence:
  - KubeNova now deduplicates derived incident ids before creating React table rows, recommendations, and root-cause candidates.
  - `/aiops` and `/observability/cluster-health` use contextual Ant Design message APIs, avoiding static message context warnings during action feedback.
  - Incident Workbench no longer uses deprecated Ant Design `List`.
- `cd backend/control-api && npm run test -- aiops.controller.spec.ts aiops.service.spec.ts monitoring.controller.spec.ts --runInBand`
- `cd backend/control-api && npm run build`
- `cd frontend && npm run lint -- --max-warnings=0`
- `cd frontend && npx tsc --noEmit --incremental false`
- `git diff --check`
