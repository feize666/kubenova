# Parallel Execution Tasks

## Scope

- Add structured edit entry points for resource pages where safe.
- Keep advanced YAML editing available for complex fields.
- Keep generated/status resources read-only except YAML or dedicated actions.
- Show only an offline notice in the cluster detail drawer for offline clusters.

## Parallel Slices

- [x] Main: make offline cluster detail drawer render only the offline notice.
- [x] Config/Namespace: add edit action and safe edit forms for ConfigMap, Secret, ServiceAccount, Namespace.
- [x] Storage: add advanced edit path plus PVC expansion and PV/PVC binding forms.
- [x] Network/Gateway: add edit action/forms for Service, Ingress, IngressRoute, NetworkPolicy, and Gateway API resources.
- [x] Workloads: add controller edit forms for Deployment, StatefulSet, DaemonSet, Job, CronJob; keep Pod/ReplicaSet no structured edit.
- [x] Integration: run lint, typecheck, build, and browser smoke.

## 2026-06-06 Performance/Stability Slices

- [x] Main: stabilize `ResourceDetailDrawer` derived state and callback references.
- [x] Topology query/compute agent: stabilize `/network/topology` query keys, request payloads, empty collections, Gateway token lookup, and pod count estimation.
- [x] Backend watch agent: gate stale watch callbacks and restart timers by watch generation.
- [x] Performance probe agent: improve performance-switching failure diagnostics and avoid writing success summaries before console/page-error checks.
- [x] Static guard agent: add topology verify checks for detail/YAML wiring, stable Gateway token map, namespace query key, and partial-coverage summary.
- [x] Integration: close every finished agent after result read, apply approved patches in the main worktree, and remove temporary worktrees.

## Validation Gates

- [x] `npm run lint -- <changed frontend files>` (cluster detail scope)
- [x] `npx eslint <resource edit changed files>`
- [x] `npx tsc --noEmit --pretty false --incremental false`
- [x] `npm run build`
- [ ] Relevant backend tests for touched API contracts.
- [x] Browser smoke for offline cluster drawer and representative edit drawers.
- [x] `npx eslint src/components/resource-detail/resource-detail-drawer.tsx src/app/network/topology/page.tsx`
- [x] `npx tsc --noEmit --pretty false`
- [x] `node --check frontend/scripts/performance-switching.mjs`
- [x] `npm test -- cluster-event-sync.service.spec.ts --runInBand`
- [x] `bash scripts/topology-verify.sh`
- [x] `git diff --check`
- [x] Fresh npm browser performance profile for current 2026-06-06 branch.

## 2026-06-06 Autonomous Resource/Route Optimization Round

### Plan And Setup

- [x] Create root `task_plan.md`, `findings.md`, and `progress.md`.
- [ ] Classify current dirty files before integration.
- [x] Classify current dirty files before integration.
- [x] Create isolated worktrees for first parallel batch.
- [x] Spawn subagents with disjoint write scopes.

### Parallel Slices

- [x] FE Route Slice: route-switch request/render audit and low-risk fixes.
- [x] Backend Resource Slice: control-api event/watch/timer resource audit and low-risk fixes.
- [x] Ops Resource Slice: dev/stable startup scripts, stale-process cleanup, memory defaults.
- [x] Probe Guard Slice: performance-switching diagnostics, route guard checks, temp cleanup.

### Active Agents

- [x] Boole `019e9c10-5fbe-7522-9a48-ee1ce19210e3`: FE pages slice consumed and closed.
- [x] Dalton `019e9c10-604c-7be2-8f76-937519decfdd`: backend events slice consumed and closed.
- [ ] Kierkegaard `019e9c10-60c1-7163-b534-c96a69141933`: ops scripts slice in `/case/k8s-aiops-worktrees/ops-scripts`.
- [x] Kuhn `019e9c10-6153-7123-aaa1-8d00e80a444d`: probe guards slice consumed and closed.

### Integration Gates

- [x] Review each subagent for write-scope violations.
- [x] Run smallest relevant verification per slice before merge.
- [x] Close each subagent immediately after result is consumed.
- [x] Remove each worktree after pass/fail decision.
- [x] Run final route-switching probe.
- [x] Run final process RSS/CPU sample.
- [x] Clean temp artifacts.

### Round 1 Verification

- [x] FE touched eslint passed.
- [x] Backend `cluster-event-sync` and `live-metrics` specs passed.
- [x] Backend build passed.
- [x] Frontend `tsc --noEmit` passed.
- [x] Frontend build passed.
- [x] `check:navigation` passed.
- [x] `topology-verify.sh` passed.
- [x] `git diff --check` passed.
- [x] Stable service restart passed.
- [x] Route-switch probe passed: `p50=298ms`, `p95=327ms`, `max=340ms`, console/page errors `0`.
- [x] Resource sample after restart: frontend `88MiB`, control-api `222MiB`, runtime-gateway `29MiB`.

## 2026-06-06 Autonomous Round 2 Candidates

- [x] FE Home Requests: reduce first-hop request/render pressure on `/`.
- [x] Backend Dashboard Hot Path: inspect dashboard stats DB/live metrics cost.
- [x] Browser Probe Budget: add optional route-switching budget thresholds.

### Round 2 Active Agents

- [x] Dirac `019e9c27-09d4-7612-8a56-f6096984d04e`: dashboard FE consumed and closed.
- [x] Nash `019e9c27-0a20-7781-8c77-f5bc4229488d`: dashboard backend consumed and closed.

### Round 2 Verification

- [x] `npx eslint src/app/page.tsx` passed.
- [x] `node --check frontend/scripts/performance-switching.mjs` passed.
- [x] one-route budget smoke passed.
- [x] `npm test -- dashboard/dashboard.service.spec.ts --runInBand` passed.
- [x] backend `npm run build` passed.
- [x] frontend targeted eslint passed.
- [x] frontend `npx tsc --noEmit --pretty false` passed.
- [x] `git diff --check` passed.
- [x] Stable service restart passed.
- [x] Final budgeted route-switch probe passed: `p50=298ms`, `p95=323ms`, `max=335ms`, console/page errors `0`, budget failures `0`.
- [x] Final resource sample: frontend `115MiB`, control-api `488MiB`, runtime-gateway `29MiB`.
- [x] Hume `019e9c27-0aab-7012-89c0-f97390929c43`: performance budget consumed and closed.

## 2026-06-06 Sidebar Auto-Collapse Fix

- [x] Sidebar keeps only one expandable section open.
- [x] Route changes open only the active route parent section.
- [x] Sidebar open/click marks a short route-transition quiet window to reduce animation jank.
- [x] `performance-switching.mjs` hidden-link probe reduced to avoid measuring artificial closed-menu delay.
- [x] `npx eslint src/components/shell-layout.tsx` passed.
- [x] `node --check frontend/scripts/performance-switching.mjs` passed.
- [x] frontend `npx tsc --noEmit --pretty false` passed.
- [x] `npm run check:navigation` passed.
- [x] `git diff --check` passed.
- [x] frontend `npm run build` passed.
- [x] Stable service restart passed.
- [x] Browser check passed: `工作负载 -> 网络管理 -> 可观测性 -> 资源巡检`.
- [x] Budgeted route-switch probes passed:
  - 5-sample: `p50=425ms`, `p95=501ms`, `max=1628ms`, console/page errors `0`.
  - 3-sample: `p50=430ms`, `p95=487ms`, `max=1908ms`, console/page errors `0`.
- [x] Resource sample: frontend `125MiB`, control-api `355MiB`, runtime-gateway `29MiB`.

## 2026-06-06 Round 3 Probe Guard Hardening

- [x] Add frontend npm shortcuts for route-switching smoke and budget probes.
- [x] Keep performance summaries in system tmp by default, with `PERF_OUTPUT_DIR` override.
- [x] Add optional route request, route API request, and slow request budgets.
- [x] Include slow route/API/resource request detail in performance budget failure summaries.
- [x] Add optional navigation JSON summary output; `CHECK_NAVIGATION_OUTPUT=1` writes to system tmp.
- [x] Make dev status read-only by default with `SERVICE_STATUS_ADOPT=false`, so status detection does not adopt external listeners into pid files.
- [x] Make dev status output easier to scan with ports, adopt mode, process count, CPU, and RSS.

## 2026-06-06 Round 4 Performance Probe Attribution

- [x] Add route sample timing splits for click-to-URL, URL-to-settle, domContentLoaded, route-ready, and settle delay.
- [x] Add per-route long task, JS heap, and route quiet class diagnostics.
- [x] Run `node --check frontend/scripts/performance-switching.mjs`.
- [ ] Run `npm run e2e:performance:switching:smoke` when `frontend/node_modules/playwright` is available.
