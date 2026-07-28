# Resource Topology V2 Execution Plan

## Goal

Deliver a single-cluster Kubernetes resource topology for the workload, network,
storage, and configuration domains without adding live full-cluster reads to page
requests. PostgreSQL remains the inventory source of truth and Redis provides
revision-aware graph caching.

## Scope

- Workload: Deployment, StatefulSet, DaemonSet, ReplicaSet, Pod, Job, CronJob.
- Network: Service, Endpoints, EndpointSlice, Ingress, NetworkPolicy, Gateway API.
- Storage: PersistentVolumeClaim, PersistentVolume, StorageClass.
- Configuration: ConfigMap, Secret, ServiceAccount.
- Single-cluster graph only. Cross-cluster edges, RBAC, generic CRDs, HPA, and VPA
  are deferred.

## Capacity And Performance Gates

- Complete backend graph: 10,000 nodes and 30,000 edges per cluster.
- One frontend expansion: 1,500 nodes and 5,000 edges.
- Default canvas: 600 nodes and 2,000 edges after grouping/collapse.
- Neighborhood focus: 300 nodes and 1,000 edges.
- Redis-hit API latency: p95 below 300 ms.
- PostgreSQL cold graph assembly: p95 below 2 s.
- First interactive canvas: below 3 s on the reference test fixture.
- Over-limit graphs must aggregate explicitly; silent truncation is forbidden.

## Frontend Design Gates

- Treat topology as a full-width operations workbench, not a nested card layout.
- Reuse the committed KubeNova blue/cyan signal palette, 6-12 px radius scale,
  typography, Ant Design controls, and existing topology tokens.
- Preserve identical information hierarchy and interaction behavior in dark and
  light themes, with WCAG 2.1 AA text contrast.
- Encode healthy, warning, critical, stale, and partial states with text or icons
  in addition to color.
- Keep icon-only controls accessible, toolbar controls stable, and interaction
  feedback within 150-200 ms with a reduced-motion alternative.
- On narrow screens, wrap or collapse toolbars and move details to a bottom sheet
  without covering required graph navigation.

## Delivery Phases

### Phase 1: Contract And Core Graph

- Input: current persisted topology graph and inventory records.
- Output: versioned graph contract, stable Kubernetes identity, typed relations,
  evidence, revision, freshness, and per-source coverage.
- Gate: focused backend contract/resolver tests pass and V1 remains compatible.

### Phase 2: Freshness And Cache

- Input: Graph V2 assembler plus existing sync and Redis infrastructure.
- Output: last-success snapshot behavior, stale/degraded coverage, revision-aware
  cache keys, invalidation, and no online-health hard gate for snapshot reads.
- Gate: offline, partial-source, cache-hit, cache-miss, and invalidation tests pass.

### Phase 3: Frontend Consolidation

- Input: Graph V2 API and the three current topology implementations.
- Output: one topology model/engine/canvas, typed edge legend, grouped overview,
  neighborhood focus, explicit stale/partial states, and bounded rendering.
- Gate: lint, typecheck, topology unit tests, and browser interaction smoke pass.

### Phase 4: Performance And Rollout

- Input: integrated backend and frontend.
- Output: 1k/5k/10k graph fixtures, API/layout benchmarks, feature flag, V1 fallback,
  observability counters, runbook, and cleaned test artifacts.
- Gate: agreed latency/render budgets pass and rollback is verified.

## Parallel Matrix

| Expert | Slice | Allowed scope | Depends on |
| --- | --- | --- | --- |
| E1 Backend graph | V2 contract, assembler, typed core-domain resolvers | `backend/control-api/src/topology-graph/**` | none |
| E2 Frontend engine | V2 client contract, unified model/group/layout engine | `frontend/src/lib/api/topology-graph.ts`, `frontend/src/modules/topology-kubejojo/**` | frozen contract |
| E3 Verification | graph fixtures, capacity checks, topology verification hooks | topology test files and `scripts/topology-verify.sh` | frozen contract |
| E4 Cache/freshness | revision cache, stale snapshot and coverage semantics | topology cache/freshness files and focused infrastructure wiring | E1 |
| E5 Page integration | remove legacy query/model fallback and wire the unified canvas | `frontend/src/app/network/topology/page.tsx`, topology styles | E1, E2 |

E1-E3 run in the first batch. E4-E5 run after the first integration gate. The
main thread owns architecture decisions, conflict resolution, integration,
regression, and cleanup.

## Worktree Rules

- Each expert uses an isolated worktree created from a temporary snapshot of the
  current dirty workspace.
- Experts modify only their declared scope and must not revert other changes.
- Each result reports changed files, verification commands, and residual risks.
- The main thread integrates only the commit delta after reviewing scope and tests.
- Worktrees and temporary branches are removed after integration.

## Risks And Rollback

- Dirty baseline: use a temporary snapshot commit without touching the main index.
- Contract drift: publish V2 additively and retain V1 for one release cycle.
- ACK request storms: topology reads never trigger live full-cluster List calls.
- Large graphs: group before layout, cap expansion, and move ELK work off the main
  browser thread.
- Stale data: return the last successful snapshot with visible timestamps and
  coverage status instead of presenting it as current data.
- Rollback: disable the V2 feature flag and return the page to the V1 endpoint and
  previous canvas while preserving inventory data.
