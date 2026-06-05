# Performance Stability Regression

## Scope

Primary spec: `.codex/specs/ops-console-unified-experience`, Requirement 13.

This record captures the current feature-switching and stability hardening evidence after the Observability and AIOps center routes were added.

## Implemented Hardening

| Area | Change | Evidence |
| --- | --- | --- |
| Route switch coverage | `frontend/scripts/performance-switching.mjs` now includes `/observability` and `/aiops` in addition to the legacy cluster/network/topology/AIOps assistant routes. | `node --check frontend/scripts/performance-switching.mjs` |
| Request cancellation | `/observability` and `/aiops` React Query calls pass the provided `AbortSignal` through API wrappers into `apiRequest`. | `getObservabilitySummary(..., { signal })`, `getAiopsSummary(..., { signal })` |
| Auth-expiry cancellation | API client already merges per-request signal with auth-expiry signal. | `frontend/src/lib/api/client.ts` |
| Degraded state | Observability and AIOps pages render source-specific degraded alerts instead of blank or misleading normal state. | `/observability`, `/aiops` |
| Console/error regression | Browser route loop covered dashboard, cluster, node, network, topology, observability, AIOps, and AI assistant routes with zero console errors and zero page errors. | Playwright MCP route loop result: 10 routes, `consoleErrorCount=0`, `pageErrorCount=0`. |
| Backend bounded fanout | Monitoring overview live metrics fanout now runs in bounded batches with per-cluster timeout fallback. | `MonitoringService.runBounded`, `liveMetricsTimeoutMs` |
| Backend input validation | AIOps summary rejects inverted `from`/`to` ranges before service execution. | `aiops.controller.spec.ts` |
| Table preference resilience | Missing or stale Prisma preference storage no longer returns 500 during route switches; preference reads return empty state and writes are accepted as volatile. | `users.service.preferences.spec.ts`, curl smoke for `/api/users/preferences/table/business.clusters`. |
| Authenticated route compatibility | `/dashboard` and `/login` avoid dev-console/runtime blank states during redirect and existing-session flows. | Browser route loop and login redirect smoke. |

## Current Constraints

- The npm performance switching script still requires installing Playwright in frontend dependencies; the browser regression in this session used the available Playwright MCP runtime instead.
- Backend timeout/recovery/bounded-concurrency hardening is in place for the new monitoring live-metrics fanout and AIOps time parsing path; broader Kubernetes/database/shared-query paths remain deeper follow-up work.
- Long soak validation is not executed in this local session; a bounded pressure smoke was executed.

## Minimal Verification

- `node --check frontend/scripts/performance-switching.mjs`
- `cd backend/control-api && npm run test -- monitoring.controller.spec.ts aiops.controller.spec.ts --runInBand`
- `cd backend/control-api && npm run test -- users.service.preferences.spec.ts users.controller.spec.ts --runInBand`
- `cd backend/control-api && npm run build`
- `cd frontend && npm run lint -- --max-warnings=0`
- `cd frontend && npx tsc --noEmit --incremental false`
- Browser route loop via Playwright MCP: `/dashboard`, `/clusters`, `/clusters/nodes`, `/network/networkpolicy`, `/network/gateway-api`, `/network/topology`, `/observability`, `/observability/cluster-health`, `/aiops`, `/ai-assistant`; result `consoleErrorCount=0`, `pageErrorCount=0`.
- Backend smoke:
  - `GET /api/users/preferences/table/business.clusters`: `200`
  - `PUT /api/users/preferences/table/business.clusters`: `200`
  - `GET /api/monitoring/observability/summary?range=1h`: `200`, about `2.46s`
  - inverted AIOps range: `400 REQUEST_FAILED`
- Pressure smoke: 20 authenticated backend requests, concurrency 5, endpoints `capabilities`, table preferences, observability summary, and AIOps summary; result all `200`, no 5xx, p95 about `2554ms`.
- `git diff --check`

## 2026-05-30 Independent 12.9 Audit

This pass re-checked the performance/stability evidence without modifying runtime code or adding helper scripts.

### Verification Run

| Command | Result |
| --- | --- |
| `node --check frontend/scripts/performance-switching.mjs` | Passed. |
| `cd frontend && PERF_USER=admin@local.dev PERF_PASS=admin123456 PERF_SAMPLE_COUNT=1 npm run e2e:performance:switching` | Blocked before browser launch: `playwright is not installed. Run: npm i -D playwright && npx playwright install chromium`. |
| `cd backend/control-api && npm run test -- monitoring.controller.spec.ts aiops.controller.spec.ts users.service.preferences.spec.ts users.controller.spec.ts --runInBand` | Passed: 4 suites, 16 tests. |
| `cd frontend && npm run lint -- --max-warnings=0` | Passed. |
| `cd frontend && npx tsc --noEmit --incremental false` | Passed. |
| `cd backend/control-api && npm run build` | Passed. |
| `curl -sS -m 3 -o /tmp/k8s-aiops-root.out -w '%{http_code} %{time_total}\n' http://127.0.0.1:3000/` | Blocked: connection refused, no local frontend server on port 3000. |
| `curl -sS -m 3 -o /tmp/k8s-aiops-api.out -w '%{http_code} %{time_total}\n' http://127.0.0.1:8080/api/capabilities` | Blocked: connection refused, no local backend server on port 8080. |
| `git diff --check` | Passed. |

### 12.9 Decision

Task 12.9 is partially passable for the current non-browser scope:

- Performance probe script syntax and route-list wiring are valid.
- Backend focused stability tests for monitoring fanout, AIOps time validation, and user preference resilience pass.
- Frontend lint and typecheck pass.
- Backend compile passes.

Task 12.9 cannot be fully closed from this audit alone because the executable Playwright performance-switching probe is blocked by the missing `playwright` dependency, and no local frontend/backend services were running for live route/API smoke.

### Remaining Risk

- No fresh route-switch timing sample, p50/p95/max, console-error count, or page-error count was generated in this pass.
- No fresh live degraded-state or request-cancellation browser evidence was generated.
- No long soak, heap/memory leak, or shutdown/recovery exercise was run.
- Existing browser and pressure-smoke evidence above remains historical evidence from an earlier session, not a fresh 2026-05-30 rerun.

## 2026-05-30 Main-Thread Follow-Up

After the independent audit, the main thread started local dev services with `bash scripts/service.sh dev up` and filled the live-browser/API gaps that could be exercised on this host.

### Fresh Browser Smoke

Playwright MCP authenticated as `admin@local.dev` and covered the critical route matrix:

| Action | Route / Target | Result |
| --- | --- | --- |
| routeSwitch | `/dashboard`, `/clusters`, `/clusters/nodes`, `/network/networkpolicy`, `/network/gateway-api`, `/network/topology`, `/observability`, `/observability/cluster-health`, `/aiops`, `/ai-assistant` | 10 routes reachable, `consoleErrorCount=0`, `pageErrorCount=0`, `requestCount=240`. |
| drawerOpen | `/clusters` first cluster entry | Drawer visible in `152ms`, `consoleErrorCount=0`, `pageErrorCount=0`. |
| tabSwitch | `/network/gateway-api` segmented control to `Gateway` | `343ms`, `consoleErrorCount=0`, `pageErrorCount=0`. |
| filterChange | `/network/gateway-api` filter panel | `374ms`, `consoleErrorCount=0`, `pageErrorCount=0`. |
| filterChange | `/network/topology` cluster selector | `1823ms`, `consoleErrorCount=0`, `pageErrorCount=0`; this exposed an empty-graph fallback when health-derived selectable clusters were unavailable. |
| graphFocus | `/network/topology` first graph node after selectable-cluster fallback fix | `708ms`, `7` React Flow nodes rendered, `consoleErrorCount=0`, `pageErrorCount=0`, API 4xx/5xx count `0`. |
| timeRangeChange | `/observability` range combobox to `6 小时` | `837ms`, `consoleErrorCount=0`, `pageErrorCount=0`. |

Route-switch sample summary:

- `p50Ms=2279`
- `p95Ms=4046`
- `maxMs=4046`
- slowest route: `/network/topology` at `4046ms`

### Fresh Backend Stability Smoke

- `bash scripts/service.sh dev status`: frontend/control-api/runtime-gateway all reported `health=正常` on ports `3000`/`4000`/`4100`.
- Authenticated pressure smoke: 20 backend requests at concurrency 5 across `/api/capabilities`, `/api/users/preferences/table/business.clusters`, `/api/monitoring/observability/summary?range=1h`, and `/api/aiops/summary?range=1h`; result `20/20` status `200`, no 5xx, `p50Ms=9`, `p95Ms=2531`, `maxMs=2532`.
- AIOps error-path smoke: inverted time range returned `400 REQUEST_FAILED` with message `` `from` 不能晚于 `to` `` in `3ms`.

### 12.9 Follow-Up Decision

This follow-up closes the fresh route/API smoke gap and provides representative route-switch, tab-switch, drawer-open, filter-change, time-range-change, backend error-path, and pressure evidence for the current host.

The empty topology state was fixed by making selectable-cluster health filtering prefer live running clusters but fall back to backend-selectable clusters when fresh health snapshots are missing. Gateway API optional dynamic resources now use a `missingAsEmpty` read path so missing CRDs render as partial coverage without browser 404 console errors.

Task 12.9 can be marked complete for the current representative regression scope: route switch, tab switch, drawer open, filter change, graph focus, observability time-range change, backend error path, and bounded pressure smoke all have fresh evidence. Long soak, heap/memory leak, shutdown/recovery, and real production-mode stress remain deeper follow-up items rather than blockers for 12.9.

## 2026-06-06 Current Branch Follow-Up

This pass continued the topology/detail stability work with scoped source changes, parallel worktrees, main-thread integration, and a fresh npm browser performance profile against the local dev services.

### Completed Changes

| Area | Change | Verification |
| --- | --- | --- |
| Detail drawer render stability | `ResourceDetailDrawer` now memoizes active navigation state, navigation stack, cluster map, YAML target, and navigation/close callbacks so detail content receives fewer unstable references. | `cd frontend && npx eslint src/components/resource-detail/resource-detail-drawer.tsx src/app/network/topology/page.tsx`; `cd frontend && npx tsc --noEmit --pretty false` |
| Topology query/compute stability | `/network/topology` now uses stable namespace query keys, memoized request payloads, module-level empty arrays, O(1) Gateway kind-token lookup, and loop-based pod estimation to reduce short-lived allocations and query function churn. | `cd frontend && npx eslint src/components/resource-detail/resource-detail-drawer.tsx src/app/network/topology/page.tsx`; `cd frontend && npx tsc --noEmit --pretty false` |
| Watch restart stability | `ClusterEventSyncService` now ignores stale watch event/done callbacks by generation, gates restart timers before scheduling/firing, and aborts late watch handles from obsolete startup generations. | `cd backend/control-api && npm test -- cluster-event-sync.service.spec.ts --runInBand` |
| Watch regression coverage | `cluster-event-sync.service.spec.ts` now covers old callbacks after watch replacement, stop-after-restart-timer behavior, and late watch handles from obsolete generations. | `5` tests passed in `cluster-event-sync.service.spec.ts` |
| Performance probe diagnostics | `performance-switching.mjs` now reports clearer Playwright-missing, base-url, login, route, body-snippet, console, and page-error diagnostics; failed console/page-error runs do not write a success summary first. | `node --check frontend/scripts/performance-switching.mjs`; `git diff --check` |
| Topology static guard | `scripts/topology-verify.sh` now checks detail/YAML drawer wiring, Gateway token map, stable namespace query key, and partial coverage summary symbols. | `bash -n scripts/topology-verify.sh`; `bash scripts/topology-verify.sh` |

### Verification Commands Run

- `cd frontend && npx eslint src/components/resource-detail/resource-detail-drawer.tsx src/app/network/topology/page.tsx`
- `cd frontend && npx tsc --noEmit --pretty false`
- `node --check frontend/scripts/performance-switching.mjs`
- `cd backend/control-api && npm test -- cluster-event-sync.service.spec.ts --runInBand`
- `bash -n scripts/topology-verify.sh`
- `bash scripts/topology-verify.sh`
- `git diff --check`

### Fresh Browser Profile

The local dev stack was already healthy on ports `3000`/`4000`/`4100` when this profile ran. The npm probe used system Chrome fallback because the Playwright-managed browser was not installed.

Command:

`PERF_BASE_URL=http://127.0.0.1:3000 PERF_USER=admin@local.dev PERF_PASS=admin123456 PERF_SAMPLE_COUNT=1 PERF_WARMUP_COUNT=0 PERF_SETTLE_MS=150 PERF_OUTPUT=/tmp/k8s-aiops-performance-20260606.json npm run e2e:performance:switching`

Summary:

- `routeCount=9`
- `p50Ms=2372`
- `p95Ms=2540`
- `maxMs=2540`
- `consoleErrorCount=0`
- `pageErrorCount=0`
- `requestCount=222`
- slowest route: `/network/services` at `2540ms`
- `/network/topology`: `325ms`, `16` requests, `8` XHR/fetch requests

### Current Risk

- No new heap/memory leak, long soak, shutdown/recovery, or production-mode stress evidence was generated.
- The fresh profile used one sample in local dev mode, not production mode or a long-duration soak.
