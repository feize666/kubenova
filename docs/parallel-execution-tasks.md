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
