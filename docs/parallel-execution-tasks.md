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

## Validation Gates

- [x] `npm run lint -- <changed frontend files>` (cluster detail scope)
- [x] `npx eslint <resource edit changed files>`
- [x] `npx tsc --noEmit --pretty false --incremental false`
- [x] `npm run build`
- [ ] Relevant backend tests for touched API contracts.
- [x] Browser smoke for offline cluster drawer and representative edit drawers.
