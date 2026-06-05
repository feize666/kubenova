# Ops Console Unified Experience Execution Plan

## Scope

Primary spec: `.codex/specs/ops-console-unified-experience`.

Current delivery order:

1. Freeze gates and compatibility boundaries.
2. Reduce service script command surface and add diagnostics.
3. Establish performance and stability baselines.
4. Harden shared shell, tables, drawers, filters, and theme behavior.
5. Deliver cluster domain, worker nodes, network resources, global detail drawers, panorama, observability, and AIOps.
6. Produce delivery summary and deployment documentation.
7. Run release gate validation.

## Non-Goals

- No destructive git cleanup.
- No unrelated formatting churn.
- No silent deletion of legacy scripts before wrappers or migration notes exist.
- No feature work without the smallest relevant validation for the touched scope.

## Baseline Decisions

- `scripts/service.sh` is the recommended command entrypoint.
- Existing scripts remain compatibility entrypoints.
- Script changes must not start or stop services during static validation unless the command explicitly requests runtime behavior.
- Documentation examples must map to real repository commands and files.

## Parallel Slices

| Slice | Scope | Output | Minimal Verification |
| --- | --- | --- | --- |
| Service scripts | `scripts/service.sh`, `scripts/README.md`, service docs | Unified entrypoint, compatibility map, failure diagnostics | `bash -n scripts/*.sh`, `bash scripts/service.sh help`, `bash scripts/service.sh dev status` |
| Performance baseline | `docs/performance-stability-baseline.md`, later tooling | Performance thresholds and evidence plan | doc review plus targeted smoke command |
| Shared UI | `frontend/src/components/*`, `frontend/src/app/globals.css` | Stable shell/table/drawer/filter behaviors | frontend lint/typecheck or changed-file focused check |
| Cluster domain | `frontend/src/config/navigation.ts`, `frontend/src/app/clusters/**`, `frontend/src/lib/api/clusters.ts`, `backend/control-api/src/clusters/**` | `集群域管理` IA, cluster detail compatibility, worker node read path and degraded metrics semantics | targeted cluster tests, frontend lint/build, backend build |
| Network resources | `frontend/src/app/network/**`, `frontend/src/components/resource-detail/**`, `backend/control-api/src/network/**`, `backend/control-api/src/resources/**` | NetworkPolicy/Gateway API list/detail/YAML/delete parity and live-data read paths | targeted network tests, resource detail checks, frontend lint/build |
| Global detail drawers | `docs/global-detail-drawer-audit.md`, `frontend/src/components/resource-detail/**`, detail entry pages, `backend/control-api/src/resources/**` | Route/kind/action coverage matrix, Headlamp parity gaps, representative regression scope | static audit commands, resource detail tests, frontend lint/typecheck |
| Backend reliability | `backend/control-api/src/**`, runtime gateway | timeout/recovery/validation/health checks | targeted unit tests and build |
| Deployment docs | `docs/deployment.md`, `docs/operations.md`, `README.md` | binary/Docker/Compose/K8S procedures | command existence and manifest review |

## Gate Rules

- Each merged slice must list changed files and verification commands.
- Failed verification blocks phase progression until fixed or explicitly accepted.
- Generated logs, traces, screenshots, and temp files must be cleaned in the same work session unless preserved intentionally.
- Agents are close-after-use: when a worker result is read and integrated, close that agent immediately.

## Current Baseline Evidence

- `bash -n scripts/service.sh scripts/dev-up.sh scripts/dev-down.sh scripts/dev-status.sh scripts/prod-up.sh scripts/prod-down.sh scripts/prod-status.sh`: passed.
- `bash scripts/service.sh help`: passed.
- `bash scripts/service.sh dev status`: passed; frontend, control-api, and runtime-gateway were healthy on local ports 3000/4000/4100.
- `bash scripts/service.sh prod status`: passed in read-only detection mode; no `.prod` PID files were written while local dev services occupied the ports.
- `bash scripts/service.sh clean topology-artifacts --dry-run`: passed.
- `bash scripts/service.sh nope`: returned exit code 2 with explicit diagnostic output, as expected.
- `cd frontend && npm run lint -- --max-warnings=0`: passed.
- `cd backend/control-api && npm run test -- --runInBand --passWithNoTests`: passed, 25 suites / 87 tests.
- `cd backend/runtime-gateway && go test ./...`: passed.
- `node --check frontend/scripts/performance-switching.mjs`: passed.
- `cd frontend && PERF_USER=admin@local.dev PERF_PASS=admin123456 PERF_SAMPLE_COUNT=1 npm run e2e:performance:switching`: blocked because Playwright is not installed in current dependencies; script failed with an actionable install message.
- Cluster domain slice:
  - `GET /api/clusters/:id/nodes` added as an additive-safe read endpoint.
  - `集群域管理` now groups `集群管理`、`名称空间`、`工作节点`; existing `/clusters` and `/namespaces` deep links remain reachable.
  - Cluster detail drawer now carries node-inventory degradation metadata and renders a local retryable warning instead of hiding unavailable node inventory.
  - `/clusters/nodes` worker-node page added with cluster selector, search, table filters, ready/roles/IP/taints/version/age/capacity columns, and `N/A` CPU/memory usage semantics when metrics are unavailable.
  - `cd backend/control-api && npm run test -- clusters.service.spec.ts clusters.controller.spec.ts --runInBand`: passed, 7 tests.
  - `cd backend/control-api && npm run build`: passed.
  - `cd frontend && npm run lint -- --max-warnings=0`: passed.
  - `cd frontend && npx tsc --noEmit`: passed.
  - `cd frontend && npm run build`: passed; route table includes `/clusters/nodes`.
  - `git diff --check`: passed.
- Network resources slice:
  - `GET /api/network?kind=NetworkPolicy` now uses live Kubernetes inventory like Ingress and IngressRoute, so the NetworkPolicy page and detail drawer operate against current cluster state instead of stale repository rows.
  - `POST /api/network/:id/actions` now accepts live `NetworkPolicy`/Ingress/IngressRoute ids for delete, allowing row actions from live lists to delete cluster resources without requiring a repository row.
  - Existing Gateway API page already exposes GatewayClass, Gateway, and HTTPRoute resource views with detail drawer, YAML action, and delete action through the dynamic resource API.
  - Gateway API detail runtime now exposes `controllerName`, `gatewayClassName`, hostnames, parent refs, and backend refs from spec; GatewayClass detail now links related Gateway resources, and Gateway/HTTPRoute detail summaries render those references even when relationship lookup is partial.
  - `cd backend/control-api && npm run test -- network.service.spec.ts --runInBand`: passed, 6 tests.
  - `cd backend/control-api && npm run test -- resources.service.spec.ts --runInBand`: passed, 8 tests.
  - `cd backend/control-api && npm run build`: passed.
  - `cd frontend && npx tsc --noEmit`: passed.
  - `cd frontend && npm run lint -- --max-warnings=0`: passed.
  - `git diff --check`: passed.
- Global detail drawer audit slice:
  - `docs/global-detail-drawer-audit.md` added as the Requirement 8 coverage matrix for cluster, namespace, workload, network, storage, config, autoscaling, Helm, topology, and custom-resource detail drawers.
  - The matrix records each route's detail entry, YAML action, relationship jump support, current status, and follow-up gaps.
  - 6.1 evidence is now strong enough to accept: global route/kind/source coverage is documented, backend `detailSource` mapping includes workload/node/network/config/storage/namespace/autoscaling plus Helm and `dynamic`, and topology-specific supported/unsupported entries are documented in `docs/topology-detail-parity-audit.md`.
  - 6.2-6.5 remain open: no full Headlamp field-by-field checklist, topology YAML affordance is missing, Node YAML remains intentionally absent, permission/source-unavailable cases are not route-regressed, and no fresh browser representative matrix was executed for this slice.
  - Minimal executable regression matrix now groups Cluster, Namespace, Node, Workload, Network, Storage, Config, Autoscaling, and Custom entries by detail entry, YAML, relationship, and error/degraded evidence.
  - `/clusters/nodes` now opens a global Node detail drawer backed by live Kubernetes Node data; detail shows readiness, roles, internal/external IPs, OS/kernel/runtime, CPU/memory capacity, taints, unschedulable state, conditions, and events.
  - Dynamic CRD/custom-resource fallback now returns standard drawer detail via `kind=dynamic`, preserving existing `raw`/`yaml` output while adding identity, labels, annotations, owner references, phase/conditions, events, and explicit no-inferred-relationships semantics.
  - Explicit gaps now tracked: generic CRD relationship inference remains intentionally limited, topology detail drawer Headlamp parity and YAML affordance need validation, Helm drawer action semantics are non-Kubernetes, and permission/source-unavailable states still need route regression evidence.
  - Static audit sources: `rg -n "ResourceDetailDrawer|ClusterDetailDrawer|ResourceYamlDrawer" frontend/src/app frontend/src/components` and `rg -n "detailSource|GatewayClass|NetworkPolicy|HorizontalPodAutoscaler|StorageClass" backend/control-api/src/resources/resources.service.ts`.
  - `cd backend/control-api && npm run test -- resources.service.spec.ts --runInBand`: passed, 10 tests.
  - `cd backend/control-api && npm run build`: passed.
  - `cd frontend && npx tsc --noEmit`: passed.
  - `cd frontend && npm run lint -- --max-warnings=0`: passed.
- Observability center foundation slice:
  - `GET /api/monitoring/observability/summary` added as an additive-safe read endpoint that aggregates monitoring overview, active alerts, events, inspection issues, and resource inventory counts.
  - The response now includes source-level status for metrics/logs/traces/events/alerts/SLO, explicit degradation notes, cluster/namespace/workload/service/pod/node/network entity health rows, per-entity signal status, SLO target/burn-rate/error-budget, alert owner, notification status, signal panels, recent events, and optional external deep-link fields sourced from environment configuration.
  - `/observability` center page added with time-range selector, health score, alert posture, data-source state, entity health matrix, signal linkage table, recent events, and an entity signal drawer. Existing `/observability/cluster-health` and `/inspection` routes remain reachable.
  - `可观测性` navigation now exposes `可观测性中心` while retaining `集群健康` and `资源巡检`.
  - `docs/observability-regression-matrix.md` added for Requirement 9 coverage across data-source degradation, entity health, unified time range, signal linkage, SLO, owner/runbook/notification, and external deep links.
  - `cd backend/control-api && npm run test -- monitoring.controller.spec.ts --runInBand`: passed, 1 test.
  - `cd backend/control-api && npm run test -- clusters.service.spec.ts clusters.controller.spec.ts network.service.spec.ts resources.service.spec.ts monitoring.controller.spec.ts --runInBand`: passed, 5 suites / 24 tests.
  - `cd backend/control-api && npm run build`: passed.
  - `cd frontend && npm run lint -- --max-warnings=0`: passed.
  - `cd frontend && npx tsc --noEmit --incremental false`: passed.
  - `git diff --check`: passed.
- AIOps center foundation slice:
  - `GET /api/aiops/summary` added as an additive-safe read endpoint backed by existing monitoring summary, alerts, and inspection signals.
  - The endpoint returns anomaly overview, incident queue, correlation groups, top impacted services, root-cause candidates with model type and human review state, recommendation records with precheck/approval flags, and audit state.
  - `POST /api/aiops/recommendations/precheck` records a non-mutating precheck audit and returns identity, approval, and rollback checks.
  - `POST /api/aiops/recommendations/approve` requires write permission, records approval/audit evidence, and intentionally returns `not-executed` so cluster mutation remains separated behind a future explicit execution path.
  - `/aiops` center page added with time-range selector, anomaly posture, incident queue, root-cause candidates, and recommendation table; clicking an incident opens an Incident Workbench drawer with evidence timeline, correlation group, topology impact, root-cause candidate, precheck, approval, audit id, and rollback hint. Legacy `/ai-assistant` remains reachable as `AI 助手`.
  - `AIOps中台` navigation now exposes `事故中台` and `AI 助手`.
  - `docs/aiops-regression-matrix.md` added for Requirement 10 coverage across anomaly overview, incident queue, correlation groups, root-cause candidates, recommendation, precheck, approval, audit, and rollback hints.
  - `cd backend/control-api && npm run test -- aiops.controller.spec.ts monitoring.controller.spec.ts --runInBand`: passed, 2 suites / 7 tests.
  - `cd backend/control-api && npm run test -- aiops.controller.spec.ts --runInBand`: passed, 5 tests.
  - `cd backend/control-api && npm run build`: passed.
  - `cd frontend && npm run lint -- --max-warnings=0`: passed.
  - `cd frontend && npx tsc --noEmit --incremental false`: passed.
- Performance and stability hardening slice:
  - `frontend/scripts/performance-switching.mjs` route matrix now includes `/observability` and `/aiops`, so route-switch probes cover the new centers when Playwright dependencies are available.
  - `/observability` and `/aiops` React Query calls now pass `AbortSignal` through their API wrappers into the shared API client, allowing stale requests to be cancelled during route/range changes and auth-expiry broadcast.
  - Monitoring overview live-metrics fanout now uses bounded batches and per-cluster timeout fallback so a slow metrics-server path does not block the whole overview indefinitely.
  - AIOps summary validates inverted `from`/`to` ranges before service execution.
  - `docs/performance-stability-regression.md` added to record request cancellation, degraded-state, route-switch, and current stress/soak constraints.
  - `GET`/`PUT /api/users/preferences/table/:tableKey` now degrade safely when Prisma preference storage is unavailable, removing route-switch 500 noise from table preference probes.
  - `/dashboard` compatibility redirect and `/login` existing-session flow no longer produce blank or dev-console error states.
  - Browser route loop covered `/dashboard`, `/clusters`, `/clusters/nodes`, `/network/networkpolicy`, `/network/gateway-api`, `/network/topology`, `/observability`, `/observability/cluster-health`, `/aiops`, and `/ai-assistant`: 10 routes reachable, `consoleErrorCount=0`, `pageErrorCount=0`.
  - Backend smoke: table preference GET/PUT returned 200, observability summary returned 200 in about 2.46s, AIOps inverted range returned 400 `REQUEST_FAILED`.
  - Pressure smoke: 20 authenticated backend requests at concurrency 5 across capabilities, preferences, observability, and AIOps returned all 200 with no 5xx; p95 about 2554ms.
  - `cd backend/control-api && npm run test -- aiops.controller.spec.ts monitoring.controller.spec.ts --runInBand`: passed, 2 suites / 7 tests.
  - `cd backend/control-api && npm run test -- users.service.preferences.spec.ts users.controller.spec.ts --runInBand`: passed, 2 suites / 9 tests.
  - `cd backend/control-api && npm run build`: passed.
  - `cd frontend && npm run lint -- --max-warnings=0`: passed.
  - `cd frontend && npx tsc --noEmit --incremental false`: passed.
- Documentation slice:
  - `docs/ops-console-delivery-summary.md` added for completed scope, key changes, evidence, known limitations, rollback, and next steps.
  - `docs/ops-console-usage.md` added for prerequisites, configuration, environment variables, first run, health checks, logs, upgrade, rollback, and troubleshooting.
  - `docs/ops-console-binary-deployment.md` added for build, release layout, package placement, foreground/systemd execution, health checks, upgrade, rollback, and uninstall.
  - `docs/ops-console-docker-compose.md` added for image build, Compose config, volumes, network, health checks, upgrade, rollback, and destroy.
  - `docs/ops-console-kubernetes-deployment.md` added for namespace, config, Secret, workloads, services, ingress, PVC, probes, resource notes, upgrade, rollback, and uninstall.
  - 11.6 local executable check completed: `bash scripts/service.sh help`, `bash -n scripts/*.sh`, package script inspection, deploy file existence checks, and `bash scripts/service.sh prod status` passed.
  - 11.6 host limitation recorded: `docker`, `kubectl`, and `kustomize` are missing, so Docker Compose config, K8s render/server dry-run, and real deployment commands were not executed.
  - `git diff --check`: passed.
- Topology/detail parity audit:
  - `docs/topology-detail-parity-audit.md` added for tasks 5.x/6.x, documenting current topology source coverage, synthetic node limitations, YAML gap, and suggested execution order.
  - `/network/topology` now includes NetworkPolicy, GatewayClass, Gateway, and HTTPRoute source tokens and nodes.
  - NetworkPolicy selector relations and GatewayClass/Gateway/HTTPRoute/Service relations were added while preserving existing service/ingress/workload graph behavior.
  - Dynamic Gateway API nodes can open the global detail drawer through `kind=dynamic`; missing CRDs or detail fetch failures degrade to fewer Gateway relations without blocking the graph.
  - 5.3 stabilization added partial-coverage warning for unavailable Gateway API dynamic sources and clears stale focus/detail state when resource-type or abnormal filters hide the selected node.
  - 0.3/5.4 design-aid validation generated `docs/assets/gpt-image2_20260530_095939_1.png` with a dense Kubernetes topology/workbench layout, then mapped the visual intent to shell navigation, topology toolbar, React Flow graph, detail/YAML drawers, degraded banners, and light/dark tokens. Functional parity remains the real gate.
  - Topology detail/YAML follow-up code-wired `ResourceYamlDrawer` into `/network/topology`, enables Namespace dynamic detail, and shows `完整详情` / `YAML` actions only when the focused graph node has resolvable identity. `cd frontend && npx tsc --noEmit --incremental false` passed after the change.
  - Playwright MCP scoped smoke covered `/network/topology`, resource-type filter, workload-domain toggle, and abnormal filter toggle with `consoleErrorCount=0`; React Flow dev warnings remain non-blocking noise and are not counted as 12.2 full-route sign-off.
  - `cd frontend && npm run lint -- --max-warnings=0`: passed.
  - `cd frontend && npx tsc --noEmit --incremental false`: passed.
  - `git diff --check`: passed.
- UI audit slice:
  - `docs/ops-console-ui-audit.md` added for task 12.1, with P0/P1/P2/P3 findings across full-route visual QA, mobile table/drawer risk, topology affordance gaps, accessibility, shared headers, filters, drawer families, tokens, and degraded states.
  - Static verification used route/component/theme/evidence scans plus existing 10-route browser loop evidence; full-site browser sign-off remains task 12.2+.
  - A first 38-route browser smoke attempt found that the Next dev server crossed its memory threshold and restarted during the route sweep. It produced no console/page errors before the restart, but many later routes failed with connection refused, so task 12.2 remains open and should use smaller route batches or production build mode.
  - 1.2/1.3/12.2 audit refresh (2026-05-30) used only local `rg`/code reading and updated `docs/ops-console-ui-audit.md` with a regression gap matrix for shared buttons, tables, drawers, modals, tags, filters, light/dark theme, mobile behavior, and keyboard accessibility.
  - Static evidence found 34 `ResourceTable` call sites and broad adoption of `ResourceTable`, `ResourceTableToolbar`, `ResourceFilterToolbar`, `ResourceClusterNamespaceFilters`, `NetworkResourcePageFilters`, `ResourceDetailDrawer`, `ResourceYamlDrawer`, `ResourceAddButton`, `ResourceActionDropdown`, and theme tokens. These are enough to close the static-foundation portion of 1.2.
  - Static evidence also confirmed remaining 1.2 gaps: many page-local `Modal` / `Modal.confirm` flows, pod-specific action styling, local AntD `Table` exceptions, drawer-family width differences, and many inline `rgba(...)`/hex/gradient colors. The earlier mixed direct tag-color gap has since been closed in `frontend/src` through semantic ops chips.
  - 1.3 and 12.2 remain open because this refresh did not run fresh browser checks for all sidebar routes, light/dark readability, mobile viewport, keyboard navigation, axe-style accessibility, focus return, or modal/drawer/table popover interaction paths.
- Release gate focused regression:
  - 12.2 independent minimum regression audit (2026-05-30) used only non-destructive checks because current local services were not running. `bash scripts/service.sh help` passed and showed the expected `dev`/`prod` lifecycle, build, test, clean, topology, and rollback/switch command surface.
  - 12.2 service status checks passed in read-only mode: `bash scripts/service.sh dev status` and `bash scripts/service.sh prod status` both reported frontend, control-api, and runtime-gateway as `未运行`, with log paths printed. No service was started or stopped in this pass.
  - 12.2 static/runtime-light checks passed: `node --check frontend/scripts/performance-switching.mjs` and `git diff --check` returned exit code 0.
  - 12.2 evidence roll-up can reference existing focused regressions below for cluster/node, NetworkPolicy/Gateway API, topology, global detail drawers, Observability/AIOps, service/deployment docs, performance/stability, and go/no-go inputs. However, this independent pass did not produce fresh browser evidence across all sidebar routes, light/dark themes, mobile viewport, accessibility/keyboard flows, or full degraded-state matrix. Therefore 12.2 remains not fully complete from this pass alone.
  - 12.2 follow-up minimum regression pass (2026-05-30, Asia/Shanghai) first confirmed no existing local dev services: `bash scripts/service.sh dev status` reported frontend/control-api/runtime-gateway `未运行`, and ports 3000/4000/4100 had no listeners. This pass then started only the services it owned with `bash scripts/service.sh dev up --no-gateway`; frontend came up on 3000 and control-api on 4000, while runtime-gateway was intentionally skipped.
  - 12.2 HTTP route reachability covered 39 authenticated frontend paths with a small sleep between requests: `/`, `/dashboard`, cluster, workload, network, storage, config, autoscaling, Helm, IAM/security, observability, AIOps, assistant, inspection, and system-update routes. Result: 38/39 returned HTTP 200. `/storage/pvc` failed once with `curl: (7) Failed to connect to 127.0.0.1 port 3000` immediately after the Next dev log printed `Server is approaching the used memory threshold, restarting...`; subsequent routes returned 200 after the restart.
  - 12.2 browser smoke used Chrome DevTools MCP after logging in as `admin@local.dev`. Desktop checks for `/storage/pvc`, `/clusters`, and `/workloads/pods` rendered their expected page headings/table shells with `console error` count 0. The light-to-dark theme toggle on `/` changed the header control from `moon 深色` to `sun 浅色` with `console error` count 0.
  - 12.2 browser topology attempt navigated to `/network/topology` after the HTTP sweep and hit a second Next dev memory-threshold restart. The page stayed on `正在校验登录态并恢复工作区...`; console errors included `net::ERR_CONNECTION_REFUSED` and `net::ERR_CONNECTION_RESET`. Service status recovered afterward, but this is blocking evidence for 12.2 release-gate completion.
  - 12.2 mobile viewport smoke resized Chrome DevTools to 390x844 and loaded `/clusters/nodes`; the mobile viewport rendered the `Node（工作节点）` shell and controls with `console error` count 0, but the node table remained in loading state for more than 10s, so mobile data-loaded evidence remains incomplete.
  - 12.2 conclusion from this pass: still not complete. Fresh evidence expanded route/theme/mobile coverage, but repeated Next dev memory restarts, one HTTP route miss during restart, topology login-state recovery hang, and incomplete mobile data-loaded evidence prevent a full minimum regression sign-off.
  - 12.3 cluster/node scoped browser regression covered `/clusters` list, cluster detail drawer open/close for `test`, `/clusters/nodes` list, and Node detail drawer open for `worker232`; after replacing deprecated Ant Design `Alert.message` props in the touched drawer path, the scoped retest produced `consoleErrorCount=0`.
  - 12.4 network scoped browser regression covered `/network/networkpolicy` list and `allow-apiserver` detail drawer with `consoleErrorCount=0`.
  - 12.4 Gateway API scoped browser regression covered `/network/gateway-api`, `GatewayClass/traefik` detail drawer, and dynamic YAML drawer. Gateway API rows now open detail through `kind=dynamic` and dynamic ids, avoiding the prior `/api/resources/gatewayclass/.../detail` 404 path. Dynamic YAML read/write support is wired through `ResourceYamlDrawer`; scoped retest produced `consoleErrorCount=0`.
  - 12.7 observability scoped browser regression covered `/observability` summary/degraded source views and `/observability/cluster-health` list, drawer, and manual probe action with `consoleErrorCount=0`.
  - 12.7 AIOps scoped browser regression covered `/aiops` summary, degraded analysis banner, Incident Workbench open, recommendation expansion, Precheck, and approval actions with `consoleErrorCount=0`.
  - 12.7 fixes added contextual Ant Design message usage on AIOps and cluster-health action paths, removed deprecated Ant Design `List` from Incident Workbench, and deduplicated derived AIOps incident ids before rows/recommendations/root-cause candidates are returned.
  - 12.5 topology static regression exposed and fixed a stale `scripts/topology-verify.sh` spec path; `bash scripts/service.sh test topology`, `bash -n scripts/service.sh scripts/topology-verify.sh scripts/topology-clean-artifacts.sh`, and `bash scripts/service.sh clean topology-artifacts --dry-run` now pass.
  - 12.5 topology browser smoke covered `/network/topology`, resource-type picker, network-only filtering, namespace focus, `Service/kubernetes` focus, full detail drawer, and `EndpointSlice` relation jump with `consoleErrorCount=0`. Follow-up hit-target fixes disabled React Flow minimap pointer capture and moved the detail panel to a bottom sheet on narrow viewports; retest confirmed normal namespace and breadcrumb clicks. 12.5 remains open because Headlamp source/YAML parity gaps remain.
  - 12.6 global detail drawer scoped browser regression covered `/namespaces` Namespace detail, `/clusters/nodes` Node detail, `/workloads/pods` Pod detail and YAML, `/storage/pvc` PVC detail and YAML, `/configs/secrets` Secret detail and YAML, `/network/gateway-api` GatewayClass dynamic detail and YAML, and `/network/topology` Service-context selection/detail surface. Normal-path batches produced `consoleErrorCount=0`.
  - 12.6 degraded-state probe intercepted Pod detail calls with `403` and `503`; the drawer showed `资源详情加载失败` plus `重试`. Expected browser network errors were limited to the simulated failed requests.
  - 12.6 limitation: `/workloads/autoscaling` had no live HPA/VPA rows in the current cluster, so autoscaling detail/YAML relationship evidence remains static/backend-only in this run; Node YAML and topology YAML remain documented unsupported actions.
  - 12.8 service script and deployment-document focused regression covered `bash scripts/service.sh help`, `bash -n scripts/*.sh`, `bash scripts/service.sh prod status`, markdown local-link existence, package scripts existence, deploy file existence, and host tool detection.
  - 12.8 host limitation: `docker`, `kubectl`, and `kustomize` are not installed in the current host, so no Docker Compose config, Kubernetes render/server dry-run, or real deployment validation was claimed.
  - 12.9 fresh main-thread regression started local dev services with `bash scripts/service.sh dev up`; `bash scripts/service.sh dev status` then reported frontend/control-api/runtime-gateway healthy on ports 3000/4000/4100.
  - 12.9 fresh browser smoke covered `/dashboard`, `/clusters`, `/clusters/nodes`, `/network/networkpolicy`, `/network/gateway-api`, `/network/topology`, `/observability`, `/observability/cluster-health`, `/aiops`, and `/ai-assistant`; route-switch summary `p50Ms=2279`, `p95Ms=4046`, `maxMs=4046`, `consoleErrorCount=0`, `pageErrorCount=0`, `requestCount=240`.
  - 12.9 fresh interaction smoke covered cluster drawer open (`152ms`), Gateway API segmented tab switch (`343ms`), Gateway API filter panel (`374ms`), topology cluster-selector change (`1823ms`), and observability time-range change (`837ms`) with zero console/page errors.
  - 12.9 follow-up fixed topology selectable-cluster fallback: when live health snapshots do not mark any cluster as `running`, the frontend falls back to backend-selectable clusters instead of rendering `0` graph nodes. Gateway API optional dynamic reads now pass `missingAsEmpty=true`, so missing Gateway API CRDs produce partial coverage without browser 404 console errors.
  - 12.9 fresh graph-focus retest covered `/network/topology` on cluster `ai`: `7` React Flow nodes rendered, first-node focus took `708ms`, `consoleErrorCount=0`, `pageErrorCount=0`, and API 4xx/5xx count was `0`.
  - 12.9 backend pressure smoke covered 20 authenticated requests at concurrency 5 across capabilities, table preferences, observability summary, and AIOps summary; result `20/20` status 200, no 5xx, `p50Ms=9`, `p95Ms=2531`, `maxMs=2532`.
  - 12.9 AIOps error-path smoke confirmed inverted `from`/`to` returned `400 REQUEST_FAILED` with message `` `from` 不能晚于 `to` ``.
  - 12.9 is now closed for the representative release-gate scope. Long soak, heap/memory leak, shutdown/recovery, and production-mode stress remain follow-up depth, not current 12.9 blockers.
  - 12.10 go/no-go and rollback validation passed for available non-destructive checks: service help includes `prod rollback <version>`, shell syntax passed, rollback without version failed with usage only, and isolated `/tmp` release symlink rollback switched `current` to `releases/previous` without touching real systemd or `/opt`.
  - 12.10 release decision remains `No-Go`: 12.2 and 12.5 now have supplemental regression evidence, but Docker/Kubernetes host tooling is missing, no real release archive/systemd/K8s rollback was validated, and release owner has not approved publication.
  - 12.11 release trace (2026-06-02): no annotated tag was created and no tag was pushed. This closes the conditional release-tag task as `not published` for the current run.
- Open task audit (2026-05-30):
  - 0.1 can be marked complete from current evidence. `design.md` freezes additive-safe API/route/permission/rollback governance, `navSections` records route/role boundaries, and delivery/deployment docs record rollback and go/no-go evidence. Remaining real-deploy rollback limits belong to release gate depth, not this freeze task.
  - 0.2 can be marked complete from current evidence. Theme tokens, shell theme toggle, navigation IA, dashboard/AIOps pages, and pod metric degraded semantics exist; full visual QA remains 1.3/12.2 follow-up.
  - 0.3 can be marked complete from current evidence. `docs/assets/gpt-image2_20260530_095939_1.png` exists as a layout validation draft, and `docs/topology-detail-parity-audit.md` maps it to shell navigation, topology toolbar, graph, detail/YAML drawer, degraded banner, and light/dark token behavior.
  - 0.4 can be marked complete for matrix/checklist definition. `docs/global-detail-drawer-audit.md` provides the drawer matrix and source-code-level Headlamp field/action checklist; remaining implementation gaps belong to 6.2/12.5, not the definition checkpoint.
  - 0.5 can be marked complete from current evidence. Observability and AIOps regression matrices, summary APIs, permission-gated nav, approval/audit flows, source degradation, and external deep-link fields are documented and tested.
  - 1.1 can be marked complete from current evidence. `ThemeProvider`, `data-theme`, persisted `kubenova-theme-mode`, AntD token maps, and global CSS variables implement light/dark tokens and shell switching.
  - 1.2 should remain open, but static foundations can be credited as complete. Current code evidence confirms shared table, table toolbar, filter toolbar, Kubernetes detail drawer, YAML drawer, create/action button primitives, semantic status/chip primitives, and theme tokens. Remaining 1.2 work is style normalization: route-local modals, drawer-family widths, local table/action exceptions, page-local filter composition, inline colors, and empty/degraded-state treatment.
  - 1.3 should remain open. Existing route-loop evidence is useful, but no full light/dark readability pass across all routes, mobile viewport, keyboard/accessibility, and lower-traffic pages has been run. Static responsive CSS exists for table/filter toolbars and topology, but browser validation is still required.
  - 5.4 can be marked complete from current evidence. `gpt-image2` produced a topology/workbench design aid and the audit maps it to implemented layout surfaces; Headlamp functional parity remains tracked by 12.5.
  - 6.2 should remain open. Drawer renderer/backend breadth is broad and `docs/global-detail-drawer-audit.md` now contains a source-code-level Headlamp field/action parity checklist, but the checklist confirms incomplete full `spec/status`, universal action affordance, CRD relationship inference, topology metadata/snapshot propagation, and section-level degraded-state parity.
  - 6.2/12.5 audit update (2026-05-30): `docs/topology-detail-parity-audit.md` now records topology-specific metadata/spec/status/conditions/events/relationships/YAML/actions/loading/error/degraded parity. Static evidence used `rg` against `frontend/src/components/resource-detail`, `frontend/src/lib/api/resources.ts`, `backend/control-api/src/resources/resources-detail.contract.ts`, `backend/control-api/src/resources/resources.service.ts`, and `frontend/src/app/network/topology/page.tsx`; no internet sources were used.
  - 6.2/12.5 implementation update (2026-05-31): dynamic Gateway API fallback detail now preserves real creation timestamps, returns raw `spec/status`, adds Gateway runtime fields and GatewayClass/HTTPRoute/Service associations, and GatewayClass/Gateway/HTTPRoute specialized drawer renderers append Spec/Status/YAML summary sections. Focused tests passed: `cd backend/control-api && npm test -- --runInBand src/resources/resources.service.spec.ts`, `cd frontend && npx tsc --noEmit --pretty false`, `cd frontend && npm run build:stable`, and scoped `git diff --check`.
  - 1.2/1.3/6.2 follow-up (2026-05-31): shared control styling now covers buttons, tables, drawers, modals, popovers/dropdowns, inputs, status chips, and topology filter pills through `frontend/src/app/globals.css`; detail section cards now use the shared 8px visual primitive; topology focused-resource jump styling also uses the same radius family. The global `ResourceDetailDrawer` now exposes a drawer-level `YAML` action for supported Kubernetes resources and dynamic detail ids, while Node/Helm remain documented policy exceptions.
  - 1.2 style-primitive follow-up (2026-06-05): direct AntD `Tag` usage and `.ant-tag` CSS were removed from `frontend/src`; `OpsStatusTag`, `OpsFilterChip`, and detail `DetailChipList` now render semantic span-based chips. `OpsFilterTriggerButton` backs `ResourceScopeFilterButton`, `ResourceFacetFilterButton`, and topology toolbar pills with slot-class overrides. `OpsPopoverPanel` footer reset/apply actions and `ResourceActionBar` inline actions now use `OpsIconActionButton`. Shell topbar notification/theme controls, resource detail, YAML, and cluster drawer header/retry actions now use `OpsIconActionButton`. AI assistant icon/new-session/action/quick-prompt/diagnosis controls now use `OpsIconActionButton`; Topology zoom/detail/retry/breadcrumb/quick-action/resource-tree toolbar controls also use `OpsIconActionButton`; Users/RBAC table toolbar create/refresh controls now use `ResourceAddButton` and `OpsIconActionButton`.
  - 12.2/12.5 current verification (2026-05-31): `cd frontend && npm run lint -- src/components/resource-detail/section-primitives.tsx src/app/network/topology/page.tsx src/components/resource-detail/resource-detail-drawer.tsx src/components/resource-detail/detail-section-builders.tsx src/components/resource-yaml-drawer.tsx` passed; `cd frontend && npm run build` passed; `bash scripts/service.sh test topology` passed; `cd backend/control-api && npm run test -- resources.service.spec.ts network.service.spec.ts clusters.service.spec.ts clusters.controller.spec.ts --runInBand` passed, 4 suites / 25 tests; `git diff --check` passed. Playwright MCP logged into the existing local 3000 service with `admin@local.dev`, loaded `/network/topology`, rendered `13` React Flow nodes, and reported no current console errors. This is enough for the current changed-scope regression but does not replace the broader 12.2 all-route/mobile/a11y sign-off.
  - 12.2 browser retry caveat (2026-05-31): a follow-up browser route mini-matrix on the existing local 3000 service showed `/`, `/clusters`, `/network/topology`, and `/aiops` rendering, but `/clusters/nodes` hit the Next error boundary and the run recorded stale chunk load errors. The issue followed cleanup of `frontend/.next` while a pre-existing 3000 service was still active; `cd frontend && npm run build` restored the build output and `/network/topology` recovered with `13` nodes and zero current console errors. Because the active service had been disturbed, 12.2 remains open and should be rerun from a clean, owned service lifecycle.
  - 12.2 clean owned-service rerun (2026-05-31): after restoring `.next`, an owned production frontend was started on port 3100 and stopped after validation. Playwright MCP logged in as `admin@local.dev` and covered `/`, `/dashboard`, `/clusters`, `/clusters/nodes`, `/workloads/pods`, `/network/networkpolicy`, `/network/gateway-api`, `/network/topology`, `/observability`, `/observability/cluster-health`, `/aiops`, and `/ai-assistant`; all 12 routes rendered non-login/non-error content with `consoleErrorCount=0` and `pageErrorCount=0`. Theme toggle changed from `浅色` to `深色`; mobile 390x844 `/clusters/nodes` rendered Node/工作节点 content. 12.2 can close for the current minimum release matrix, with broader accessibility/long-run coverage left as follow-up depth.
  - 12.5 remains open after the update: topology supported real nodes and Namespace can open detail/YAML by code path, and Gateway full-detail raw spec/status now has browser proof, but broader topology YAML paths, Node/synthetic Pod/instance group real detail, and many Headlamp source families remain outside the graph.
  - 6.3 can be marked complete with documented exceptions. Focused browser evidence covered refresh/close/detail/YAML actions, related-resource jumps, and row actions for representative Namespace, Node, Pod, GatewayClass, PVC, Secret, and topology Service paths; Node YAML remains an explicit unsupported-policy exception, and topology YAML is a 12.5 browser-regression follow-up.
  - 6.4 can be marked complete for representative coverage. Generic drawer loading/error/retry paths exist, Pod detail `403`/`503` interception rendered `资源详情加载失败` plus `重试`, and topology/Gateway optional source degradation is documented; route-by-route negative cases remain follow-up depth.
  - 12.2 should remain open. Current static audit matrix identifies what can be credited from code reading, but fresh browser evidence is still missing for all-route coverage, both themes, mobile, keyboard/a11y, and representative modal/drawer/table/filter interactions.
  - `cd backend/control-api && npm run test -- aiops.controller.spec.ts aiops.service.spec.ts monitoring.controller.spec.ts --runInBand`: passed, 3 suites / 8 tests.
  - `cd backend/control-api && npm run test -- clusters.service.spec.ts clusters.controller.spec.ts network.service.spec.ts resources.service.spec.ts --runInBand`: passed, 4 suites / 23 tests.
  - `cd backend/control-api && npm run test -- resources.service.spec.ts network.service.spec.ts --runInBand`: passed, 2 suites / 16 tests.
  - `cd backend/control-api && npm run test -- resources.service.spec.ts network.service.spec.ts clusters.service.spec.ts clusters.controller.spec.ts --runInBand`: passed, 4 suites / 23 tests.
  - `cd frontend && npm run lint -- --max-warnings=0`: passed.
  - `cd frontend && npx tsc --noEmit --incremental false`: passed.
  - `git diff --check`: passed.
