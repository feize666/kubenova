# Global Detail Drawer Audit Matrix

## Scope

Primary spec: `.codex/specs/ops-console-unified-experience`, Requirement 8.

This matrix freezes the current global detail drawer coverage before deeper Headlamp parity work. It records routes, resource kinds, source contracts, supported drawer actions, and known follow-up gaps.

## Baseline Rules

- Drawer entry must preserve list context and open on resource name click.
- Drawer content must include identity, metadata, status/runtime, relationships, events, YAML, refresh, and close when the resource type supports those data.
- Missing APIs or permissions must render explicit unavailable/degraded state instead of hiding the section.
- Navigation from related resources must keep `kind`/`id` stable and avoid full-page route changes.
- YAML action remains separate through `ResourceYamlDrawer` where the list page exposes it.

## Entry Coverage

| Domain | Route | Resource kinds | Detail entry | YAML action | Relationship jump | Current status | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cluster | `/clusters` | Cluster | `ClusterDetailDrawer` | N/A | N/A | Implemented | Fold cluster into global matrix regression once cluster drawer parity is formalized. |
| Cluster | `/namespaces` | Namespace | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify namespace events and owner references against Headlamp. |
| Cluster | `/clusters/nodes` | Node | `ResourceDetailDrawer` | No | Yes | Implemented | YAML action remains intentionally absent on node inventory until Node mutation policy is frozen. |
| Workloads | `/workloads/pods` | Pod | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify logs/events/action availability. |
| Workloads | `/workloads/deployments` | Deployment | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify scale/image actions remain available after drawer refactor. |
| Workloads | `/workloads/statefulsets` | StatefulSet | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify PVC relation grouping. |
| Workloads | `/workloads/daemonsets` | DaemonSet | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify node/pod relationship grouping. |
| Workloads | `/workloads/replicasets` | ReplicaSet | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify owner chain to Deployment. |
| Workloads | `/workloads/jobs` | Job | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify Pod ownership and event sorting. |
| Workloads | `/workloads/cronjobs` | CronJob | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify Job history relation. |
| Workloads | `/workloads/autoscaling` | HPA, VPA | `ResourceDetailDrawer` | Yes | Yes | Implemented | Add explicit autoscaling target relation regression. |
| Workloads | `/workloads/helm` | HelmRelease | `ResourceDetailDrawer` | partial | Yes | Implemented | Helm detail uses custom child content; record non-Kubernetes action limitations. |
| Workloads | `/workloads/helm/repositories` | HelmRepository | `ResourceDetailDrawer` | N/A | Yes | Implemented | Keep repository drawer in non-Kubernetes section of regression matrix. |
| Network | `/network/services` | Service | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify Service-aligned network columns and endpoint pipeline parity. |
| Network | `/network/ingress` | Ingress | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify TLS secret and backend Service jumps. |
| Network | `/network/ingressroute` | IngressRoute | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify Traefik Middleware relation availability. |
| Network | `/network/endpoints` | Endpoints | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify address/subset degraded note. |
| Network | `/network/endpointslices` | EndpointSlice | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify Service and backend Pod relation chains. |
| Network | `/network/networkpolicy` | NetworkPolicy | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify live inventory and live delete path in network tests. |
| Network | `/network/gateway-api` | GatewayClass, Gateway, HTTPRoute | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify spec-derived controller, listeners, parentRefs, backendRefs. |
| Network | `/network/topology` | graph-selected resources | `ResourceDetailDrawer` | Partial | Yes | Partial | YAML is now code-wired for resolvable focused graph nodes; browser-regress Namespace/Service/Gateway paths and keep synthetic entries documented. |
| Storage | `/storage/pv` | PersistentVolume | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify bound-claim relation. |
| Storage | `/storage/pvc` | PersistentVolumeClaim | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify workload mount relation and storage pipeline. |
| Storage | `/storage/sc` | StorageClass | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify provisioner/parameter/mount option rendering. |
| Config | `/configs/configmaps` | ConfigMap | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify consumer workload relation and key visibility. |
| Config | `/configs/secrets` | Secret | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify redaction and TLS/imagePullSecret usage hints. |
| Config | `/configs/serviceaccounts` | ServiceAccount | `ResourceDetailDrawer` | Yes | Yes | Implemented | Verify token/imagePullSecret relationship hints. |
| Custom | dynamic resources via discovery | CRD/custom kinds | `ResourceDetailDrawer` fallback via `kind=dynamic` | dynamic YAML | limited | Partial | Generic detail fallback now returns identity, labels, annotations, owner references, phase/conditions, events, and YAML-compatible raw payload; relation inference remains intentionally limited. |

## Backend Kind Coverage

| Detail source | Kinds currently mapped | Evidence |
| --- | --- | --- |
| workload | Pod, Deployment, StatefulSet, DaemonSet, ReplicaSet, Job, CronJob | `ResourcesService.KIND_META` uses `detailSource: workload`. |
| node | Node | `ResourcesService.KIND_META` maps Node to `detailSource: node`; detail lookup uses live Kubernetes `readNode` and node events. |
| network | Service, Ingress, IngressRoute, GatewayClass, Gateway, HTTPRoute, NetworkPolicy, Middleware, Endpoints, EndpointSlice | `ResourcesService.KIND_META` uses `detailSource: network`; live network detail kinds include the same set. |
| config | ConfigMap, Secret, ServiceAccount | `ResourcesService.KIND_META` uses `detailSource: config`. |
| storage | PersistentVolumeClaim/PVC, PersistentVolume/PV, StorageClass/SC | `ResourcesService.KIND_META` uses `detailSource: storage`. |
| namespace | Namespace | `ResourcesService.KIND_META` uses `detailSource: namespace`. |
| autoscaling | HorizontalPodAutoscaler/HPA, VerticalPodAutoscaler/VPA | `ResourcesService.KIND_META` uses `detailSource: autoscaling`. |
| non-Kubernetes | HelmRelease, HelmRepository | Custom detail builders. |

## 6.x Acceptance Evidence

| Task | Evidence decision | Current state |
| --- | --- | --- |
| 6.1 entry and kind coverage | Full route/kind/source scan is captured above. Static scan shows every core domain page mounts `ResourceDetailDrawer`; all list pages except `/clusters/nodes` expose `ResourceYamlDrawer`, and `/network/topology` now exposes `ResourceYamlDrawer` for resolvable focused nodes; backend `kindMap` covers workload, node, network, config, storage, namespace, autoscaling, Helm, and `dynamic` fallback. Topology-specific exceptions are linked in [topology-detail-parity-audit.md](topology-detail-parity-audit.md). | Enough evidence to mark complete. |
| 6.2 Headlamp field parity | Drawer renderer/backend cover identity, metadata, raw `spec`, raw `status`, conditions, events, relationships, network/storage/config/autoscaling-specific panels, dynamic fallback, and a source-code-level Headlamp field/action checklist. The global drawer now exposes its own YAML action for supported Kubernetes resources while retaining route row actions. Topology synthetic entries and custom-resource relation inference remain tracked as 12.5/known-limit items. | Enough evidence to mark complete. |
| 6.3 actions and navigation | Playwright focused regression covered refresh/close/detail/YAML actions for Namespace, Node, Pod, GatewayClass, PVC, Secret, and topology Service detail where supported. Node YAML remains a policy exception; topology YAML is now code-wired but needs browser regression. | Enough representative evidence for 12.6; not enough for 12.5. |
| 6.4 loading/error/permission/degraded states | Browser request interception forced Pod detail `403` and `503`; drawer rendered `资源详情加载失败` plus retry action instead of hiding the section. Simulated failed requests produced expected browser network errors only. | Enough representative evidence for 12.6; per-kind permission tests remain follow-up. |
| 6.5 representative regression | Browser focused matrix covered cluster-scoped, namespace-scoped, workload, node, network/dynamic, topology, storage, and config categories with `consoleErrorCount=0` on normal paths. Autoscaling had no HPA/VPA sample rows in the current cluster, so only static mount/empty-state evidence was available. | Enough evidence for 12.6 with autoscaling data limitation recorded. |

## Source-Code-Level Headlamp Field/Action Parity Checklist

Static evidence commands used for this checklist:

- `rg -n "buildHeadlampDetailSections|buildMetadataSection|buildSpecSection|buildStatusSection|buildEventsSection|buildYamlSummarySection" frontend/src/components/resource-detail`
- `rg -n "ResourceDetailResponse|ResourceDetailDescriptor|ResourceDetailRuntime|ResourceDetailMetadata|ResourceDetailRelationship" frontend/src/lib/api/resources.ts backend/control-api/src/resources/resources-detail.contract.ts`
- `rg -n "RESOURCE_DETAIL_SECTION_PROFILES|RESOURCE_DETAIL_FIELDS_BY_SECTION|kindMap|buildDynamicResourceFallbackDetail|buildRuntime|buildMetadata|buildRelationshipGroups|buildEventsSummary|buildDescriptor|getYaml|updateYaml" backend/control-api/src/resources/resources.service.ts`
- `rg -n "ResourceDetailDrawer|ResourceYamlDrawer|ResourceRowActions|ResourceActionDropdown|logs|terminal|scale|image" frontend/src/app frontend/src/components frontend/src/lib/api/resources.ts`
- `rg -n "resolveResourceDetailRequest|ResourceDetailDrawer|ResourceYamlDrawer|getDynamicResourceDetail|missingAsEmpty|detailInteractionsDisabled" frontend/src/app/network/topology/page.tsx`

| Headlamp group | Current source-code coverage | Gaps / decision |
| --- | --- | --- |
| metadata | Covered in contract and renderer: `ResourceDetailMetadata` has labels, annotations, ownerReferences, configUsages; `buildMetadataSection`, `buildLabelsSection`, `buildAnnotationsSection`, and `MetadataSection` render counts/details. Backend `buildMetadata` normalizes labels/annotations/owner refs and config usages; dynamic fallback extracts metadata from raw CRD payload. | Metadata is summarized, not a complete Kubernetes `metadata` object. UID is represented by `overview.id`; resourceVersion/generation/managedFields are not part of drawer contract. |
| spec | Covered for standard and dynamic detail responses. `ResourceDetailResponse` exposes `rawSpec`; backend standard detail returns `base.spec`, dynamic fallback returns raw `spec`, and the renderer prefers `detail.rawSpec` before caller snapshots. | Synthetic topology entries without real resource identity still do not open global detail; that limitation belongs to topology parity, not the global drawer contract. |
| status | Covered for standard and dynamic detail responses. `ResourceDetailResponse` exposes `rawStatus`; backend standard detail returns `base.statusJson`, dynamic fallback returns raw `status`, and the renderer prefers `detail.rawStatus` before caller snapshots while also showing summarized runtime fields and conditions. | Condition history remains current-condition oriented, matching the current contract scope. |
| conditions | Covered for supported detail sources. `ResourceDetailRuntime.conditions` is typed in frontend/backend contracts; backend `buildRuntime` and `buildDynamicResourceFallbackDetail` normalize type/status/reason/message/lastTransitionTime; renderers show status condition tags/sections for core, Gateway, autoscaling, Node, and generic status paths. | Condition history is only current condition list; no raw condition object table for every kind. |
| events | Covered with graceful degradation. Contract exposes `events.items`; backend `buildEventsSummary` reads namespaced/all-namespace Kubernetes events with involvedObject field selector and returns empty list on failure after logging `detail events degraded`; renderers show Events or empty state. | Event API failure degrades to empty events without a visible per-section degraded banner; representative drawer error tests covered detail API failure, not event-only failure. |
| relationships | Covered for main domains. Contract has grouped relationship graph (`control`, `network`, `storage`, `config`, `other`); backend `buildRelationshipGroups` merges associations, network pipelines, storage pipelines, metadata/config usages; frontend `RelationshipNavigatorSection` renders relation jumps and calls `onNavigateRequest`. Dynamic fallback intentionally returns no inferred relationships beyond metadata owner refs. | CRD/custom relationship inference remains intentionally absent; topology graph has narrower source families than backend drawer. |
| YAML | Covered as global drawer action and route/list action for supported resources. `ResourceDetailDrawer` derives a YAML target from loaded detail data, supports dynamic detail ids, and opens `ResourceYamlDrawer`; `ResourceYamlDrawer` reads standard `/api/resources/yaml` fallback paths or dynamic detail YAML; backend `getYaml`, `updateYaml`, dynamic YAML read/update exist. | Node inventory and Helm inventory stay policy exceptions. Topology YAML does not apply to synthetic entries; broader topology browser coverage remains in 12.5. |
| actions | Covered outside detail drawer. Row actions use `ResourceRowActions`, `ResourceActionDropdown`, or per-route action menus for describe/detail, YAML, delete, logs, terminal, scale, and image where supported. `ResourceDetailDrawer` itself exposes refresh, close, and back for relationship navigation. | Detail drawer does not provide a universal action bar. Actions remain page/row scoped, so parity is route-dependent. |
| loading | Covered. `ResourceDetailDrawer` renders Ant Design `Skeleton` while `query.isLoading && !hasDetailData`; list pages also pass table loading states. | No issue for generic drawer loading. |
| error | Covered. `ResourceDetailDrawer` renders `Alert` title `资源详情加载失败`, error description, and retry button when `query.error` is an Error. Browser interception already proved 403/503 detail failures. | Per-kind 403/404/503 route matrix remains follow-up depth. |
| degraded | Partial. Topology optional Gateway API reads use missing-as-empty/partial-coverage handling; backend event loading catches failure and logs degraded; cluster/node metrics use N/A/degraded semantics elsewhere. | Drawer contract lacks explicit section-level degraded metadata for events/spec/status sources. Current UI can show full detail API errors, but not all sub-source degradation. |

6.2 result: complete for the global detail drawer scope. Current code gives Headlamp-shaped identity, metadata, spec, status, conditions, events, relationships, YAML, refresh, close, and degraded/error handling across supported detail sources. Remaining limitations are tracked separately: Node/Helm YAML policy exceptions, synthetic topology entries, broad CRD relation inference, and section-level degraded metadata depth.

## Required Regression Matrix

Run this matrix before marking Requirement 8 complete:

| Category | Representative kind | Entry evidence | YAML evidence | Relationship evidence | Error/degraded evidence |
| --- | --- | --- | --- | --- | --- |
| Cluster | Cluster, Namespace | `/clusters` uses `ClusterDetailDrawer`; `/namespaces` uses `ResourceDetailDrawer`. | Namespace page mounts `ResourceYamlDrawer`; Cluster is non-Kubernetes inventory detail. | Namespace owner/event evidence via resource detail; Cluster remains separate drawer family. | Cluster drawer carries local retry/degraded inventory state; namespace needs explicit 403/404 route regression. |
| Namespace | Namespace | `/namespaces` name click opens global drawer. | YAML drawer present on `/namespaces`. | Owner references and events expected from backend namespace detail. | Permission/source-unavailable case not browser-regressed. |
| Node | Node | `/clusters/nodes` opens `ResourceDetailDrawer` with live Node id. | No YAML drawer by policy on node inventory. | Node condition/event detail available; cluster relation not yet formalized. | Node metrics degradation documented as `N/A`; live Node read 404/403 path needs route regression. |
| Workload | Pod, Deployment, StatefulSet, DaemonSet, ReplicaSet, Job, CronJob | Each workload route mounts `ResourceDetailDrawer`; autoscaling console opens detail for HPA/VPA targets separately. | Workload pages mount `ResourceYamlDrawer`. | Owner/child chains, pods, PVC/config/network relations are rendered by `ResourceDetailContent`. | Drawer generic load/error/retry exists; per-kind permission tests pending. |
| Network | Service, Ingress, IngressRoute, Endpoints, EndpointSlice, NetworkPolicy, GatewayClass, Gateway, HTTPRoute | Network list pages and `/network/topology` mount `ResourceDetailDrawer`; topology supports selected real graph nodes and Namespace dynamic detail. | Network list pages mount YAML; topology mounts YAML for resolvable focused graph nodes. | Service/backend, ingress backend/TLS, endpoint pipeline, NetworkPolicy selector, Gateway/HTTPRoute refs are covered in backend/renderers. | Gateway API dynamic source partial warning exists in topology; route-level 403/503 proof pending. |
| Storage | PersistentVolume, PersistentVolumeClaim, StorageClass | `/storage/pv`, `/storage/pvc`, `/storage/sc` mount `ResourceDetailDrawer`. | Storage pages mount `ResourceYamlDrawer`. | PV/PVC/StorageClass binding and workload mount pipeline rendered. | Permission/source-unavailable route regression pending. |
| Config | ConfigMap, Secret, ServiceAccount | Config pages mount `ResourceDetailDrawer`. | ConfigMap/Secret use `ResourceYamlDrawer`; ServiceAccount has page-local dynamic YAML drawer/editor. | Workload/network consumer relations rendered for ConfigMap/Secret/ServiceAccount. | Secret redaction/visibility and permission denial need browser proof. |
| Autoscaling | HPA, VPA | `/workloads/autoscaling` mounts `ResourceDetailDrawer`. | Autoscaling console mounts `ResourceYamlDrawer`. | Target resource and pod relation panel exists. | Metrics/source degraded and permission denial proof pending. |
| Custom | representative CRD | Dynamic discovery detail returns standard drawer detail through `kind=dynamic`; topology Gateway API nodes can construct dynamic detail ids. | Dynamic API exposes YAML through `GET/PUT /api/resources/dynamic/yaml`; route availability depends on dynamic-resource page entry. | Owner references only; inferred custom relations intentionally absent. | Missing CRD/dynamic detail failure degrades to fewer topology relations; generic CRD 403/404 route proof pending. |

## Current Gaps

- Generic CRD/custom-resource relation inference is not implemented; fallback detail intentionally reports no inferred relationships beyond owner references.
- Panorama detail drawer and YAML drawer are code-wired for selected graph resources with real identities, but Headlamp source/group/focus parity and browser proof are not yet complete. Topology-specific coverage and suggested order are tracked in [topology-detail-parity-audit.md](topology-detail-parity-audit.md).
- Some Helm drawers are intentionally non-Kubernetes and need separate action semantics in the final regression matrix.
- Permission-denied and source-unavailable states have representative drawer evidence through Pod detail `403/503` interception; route-by-route negative cases remain follow-up coverage.

## 2026-06-05 Field Ownership Pass

Frontend drawer now applies a kind-owned runtime field whitelist before rendering generic Hero, Status, Spec fallback, and runtime detail sections. This guards against backend descriptor defaults exposing pod/workload fields on unrelated resources.

| Resource family | Drawer field strategy |
| --- | --- |
| Pod | Show pod phase, restart count, images, Pod IP, node, service account, restart/DNS/scheduler policy; keep container summaries and raw spec/status when available. |
| Node | Show Ready, roles, addresses, OS/kernel/runtime, CPU/memory capacity, taints, schedulable state, and conditions. |
| Deployment/StatefulSet/DaemonSet/ReplicaSet | Show replica counts, selector, images, owned pods, controller chain, container summaries, and raw spec/status. |
| Job/CronJob | Show job execution scale/status and owner/job relations; avoid Pod-only image/IP/node fields unless backend raw spec/status carries them inside the actual resource payload. |
| Service/Ingress/IngressRoute/Gateway API/Endpoints/EndpointSlice/NetworkPolicy | Show network-owned service type/IP/ports/routes/listeners/parents/backends/policy selectors/rules; avoid workload replica/image/Pod IP fields in generic summaries. |
| PV/PVC/StorageClass | Show storage phase, capacity, access modes, reclaim policy, claim refs, provisioner, binding mode, expansion, and storage pipelines. |
| ConfigMap/Secret/ServiceAccount | Show metadata counts, key/reference usage, consumer relationships, and Secret redaction context; no runtime phase/replica/image/IP fields. |
| HPA/VPA | Show autoscaling type, target relations, current scale signal when provided, metrics/recommendation hints, and conditions; avoid workload readiness/image/IP fields. |
| Dynamic/CRD | Show identity, metadata, phase/conditions when status provides them, raw spec/status, events, and YAML; relation inference remains intentionally limited. |

## Focused Regression Evidence

Task 12.3 cluster/node regression:

- Browser: `/clusters` list loaded; `test` opened `ClusterDetailDrawer`; drawer close worked.
- Browser: `/clusters/nodes` list loaded; `worker232` opened global `ResourceDetailDrawer` for Node; after replacing deprecated Ant Design Alert `message` props in the touched drawer path, the scoped retest had `consoleErrorCount=0`.
- Backend: `cd backend/control-api && npm run test -- clusters.service.spec.ts clusters.controller.spec.ts --runInBand` passed as part of the 12.3/12.4 focused test set.

Task 12.4 network regression:

- Browser: `/network/networkpolicy` list loaded; `allow-apiserver` opened global `ResourceDetailDrawer`; scoped retest had `consoleErrorCount=0`.
- Browser: `/network/gateway-api` list loaded; `GatewayClass/traefik` opened global detail via `kind=dynamic`; YAML action opened the dynamic YAML drawer and rendered GatewayClass YAML; scoped retest had `consoleErrorCount=0`.
- Backend: `cd backend/control-api && npm run test -- network.service.spec.ts resources.service.spec.ts --runInBand` passed.

Task 12.6 global detail drawer regression:

- Browser normal paths had `consoleErrorCount=0` across the focused batches.
- Browser: `/namespaces` opened Namespace detail for `default`; detail showed supported global drawer content and close/refresh affordance.
- Browser: `/clusters/nodes` opened Node detail for `master231`; conditions/events loaded; Node YAML was not tested because the page intentionally has no Node YAML action.
- Browser: `/workloads/pods` opened Pod detail for `web-854ffd8456-qxqnw`; row action menu exposed `描述`、`日志`、`终端`、`YAML`、`删除`; YAML drawer opened from the row menu.
- Browser: `/storage/pvc` opened `test-deploy-pvc` detail and YAML drawer.
- Browser: `/configs/secrets` opened `kubernetes-dashboard-token-t6xxv` detail and YAML drawer; detail path did not expose obvious raw secret data in the inspected text.
- Browser: `/network/gateway-api` opened `GatewayClass/traefik` dynamic detail; row `更多操作` menu exposed `YAML` and `删除`; dynamic YAML drawer opened. This confirms the route avoids the old `/api/resources/gatewayclass/.../detail` path.
- Browser: `/network/topology` loaded and selected `kubernetes`/Service context with no console errors. This evidence predates the topology YAML wiring, so the new YAML button path still needs browser regression.
- Browser negative-state probe: intercepted Pod detail API with `403` and `503`; drawer rendered `资源详情加载失败` and `重试`. The browser emitted expected network error entries for the simulated failed requests.
- Autoscaling limitation: `/workloads/autoscaling` had no current HPA/VPA sample rows, so detail/YAML relationship proof for autoscaling remains static/backend-only in this run.
- Static coverage: `rg -n "ResourceDetailDrawer|ClusterDetailDrawer|ResourceYamlDrawer" frontend/src/app frontend/src/components`, `rg -n "detailSource|GatewayClass|NetworkPolicy|HorizontalPodAutoscaler|StorageClass|dynamic" backend/control-api/src/resources/resources.service.ts`, and `rg -n "SOURCE_TOKEN_KEYS|resolveResourceDetailRequest|ResourceDetailDrawer|ResourceYamlDrawer" frontend/src/app/network/topology/page.tsx` completed.
- Backend: `cd backend/control-api && npm run test -- resources.service.spec.ts network.service.spec.ts clusters.service.spec.ts clusters.controller.spec.ts --runInBand` passed, 4 suites / 23 tests.
- Frontend: `cd frontend && npx tsc --noEmit --incremental false` passed.
- Frontend: `cd frontend && npm run lint -- --max-warnings=0` passed.

## Minimal Verification

- Static audit command: `rg -n "ResourceDetailDrawer|ClusterDetailDrawer|ResourceYamlDrawer" frontend/src/app frontend/src/components`.
- Contract audit command: `rg -n "detailSource|GatewayClass|NetworkPolicy|HorizontalPodAutoscaler|StorageClass" backend/control-api/src/resources/resources.service.ts`.
- Focused tests:
  - `cd backend/control-api && npm run test -- resources.service.spec.ts --runInBand`
  - `cd frontend && npx tsc --noEmit`
  - `cd frontend && npm run lint -- --max-warnings=0`
