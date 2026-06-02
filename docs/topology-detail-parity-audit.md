# Topology and Detail Drawer Parity Audit

## Scope

Primary spec: `.codex/specs/ops-console-unified-experience`, tasks 5.x and 6.x.

This audit records current `/network/topology` source coverage, detail drawer entry behavior, resource-kind gaps, and low-conflict follow-up order.

## Static Evidence

| Area | Current evidence | Notes |
| --- | --- | --- |
| Topology source tokens | `SOURCE_TOKEN_KEYS` contains `service`, `ingress`, `ingressroute`, `endpoints`, `endpointslice`, `networkpolicy`, `gatewayclass`, `gateway`, `httproute`, `deployment`, `statefulset`, `daemonset`, `pod`. | Panorama resource filter covers network + workload domains, including Gateway API optional sources. |
| Topology data queries | `/network/topology` queries `topology-network`, `topology-gateway-api`, `topology-deployments`, `topology-statefulsets`, and `topology-daemonsets`. | No topology query for ReplicaSet, Job, CronJob, autoscaling, storage, config, namespace inventory, Node inventory, or broad CRD/custom resources. |
| Synthetic topology nodes | Pod nodes are synthesized from controller replica counts and generated names. Node-group nodes are synthesized from derived node names. | Synthetic Pod/Node group nodes do not carry backend resource detail ids, so global detail drawer cannot open for them. |
| Detail request resolution | `resolveResourceDetailRequest` can build dynamic Namespace requests and real-resource requests from `kind`/`id` or dynamic identities; it returns `null` for `instancegroup`, synthetic `node`, and synthetic Pod entries without backend identity. | Namespace topology nodes now have a detail/YAML path; synthetic Pod/Node group entries remain glance-only. |
| Detail drawer integration | `/network/topology` mounts `ResourceDetailDrawer`, passes `onNavigateRequest`, and mounts `ResourceYamlDrawer` for focused resources with resolvable YAML identity. | Drawer relationship navigation works after drawer opens; topology YAML action is now code-wired but still needs browser regression evidence. |
| Global detail source coverage | Backend resource detail supports workload, node, network, config, storage, namespace, autoscaling, and dynamic fallback kinds. | Backend drawer breadth is wider than topology source breadth. |

## NetworkPolicy and Gateway API Update

The topology graph now includes `NetworkPolicy`, `GatewayClass`, `Gateway`, and `HTTPRoute` source tokens.

- NetworkPolicy nodes use the existing network API and connect to matching workload nodes through `podSelector`, ingress peer `podSelector`, and egress peer `podSelector`; an empty `podSelector` is treated as namespace-wide workload selection.
- Gateway API nodes use the dynamic resource API for `gatewayclasses`, `gateways`, and `httproutes`.
- Gateway relations are added for `GatewayClass -> Gateway`, `Gateway -> HTTPRoute`, and `HTTPRoute -> Service`.
- Dynamic Gateway API nodes can open the global `ResourceDetailDrawer` through `kind=dynamic`.
- If Gateway API CRDs are missing or dynamic detail fetch fails, existing topology graph rendering continues with fewer or no Gateway API relations.

Verification:

- `cd frontend && npm run lint -- --max-warnings=0`: passed.
- `cd frontend && npx tsc --noEmit --incremental false`: passed.
- Playwright MCP scoped smoke on `/network/topology`: login redirect returned to topology, resource-type popover opened, workload-domain filter toggled, abnormal filter toggled; result `consoleErrorCount=0`. Dev runtime still emitted React Flow nodeTypes warnings, so this is scoped 5.3 evidence, not full 12.2 release sign-off.
- `git diff --check`: passed.

## 12.5 Focused Regression Evidence

- 2026-05-30 static recheck of `frontend/src/app/network/topology/page.tsx`: source tokens currently include Service, Ingress, IngressRoute, Endpoints, EndpointSlice, NetworkPolicy, GatewayClass, Gateway, HTTPRoute, Deployment, StatefulSet, DaemonSet, and synthetic Pod.
- 2026-05-30 static recheck confirmed the graph has Gateway API partial-coverage handling, auth/service-timeout failure categories, connected-component focus state, filter-hidden focus cleanup, React Flow minimap pointer capture disabled, and `ResourceDetailDrawer` integration.
- 2026-05-30 static recheck confirmed `/network/topology` still has no `ResourceYamlDrawer`; `resolveResourceDetailRequest` still returns `null` for Namespace, instance group, and Node, and synthetic Pod/Node-group entries still do not carry real backend resource identities.
- 2026-05-30 `bash scripts/service.sh test topology`: passed. The static regression verified topology file presence, cleanup/service hooks, focus/detail/layout functions, connected-component internals, unavailable/auth-expired symbols, and 12.5 task markers.
- 2026-05-30 `bash -n scripts/topology-verify.sh scripts/topology-clean-artifacts.sh`: passed.
- 2026-05-30 `git diff --check`: passed.
- No browser smoke was run in this recheck because the requested non-destructive static checks already proved the current regression harness and known parity gaps; no services were started and no browser artifacts were produced.
- 2026-05-30 main-thread browser follow-up fixed the empty topology issue caused by frontend health-derived selectable-cluster filtering. When no fresh `running` health snapshot exists, `getClusters({ selectableOnly: true })` now falls back to backend-selectable clusters instead of returning an empty selectable set.
- 2026-05-30 main-thread browser follow-up added optional dynamic-resource `missingAsEmpty` handling for Gateway API topology reads. Missing Gateway API CRDs now return `200` empty lists for this optional read path and no longer create browser 404 console errors.
- 2026-05-30 Playwright MCP retest loaded `/network/topology`, selected cluster `ai`, rendered `7` React Flow nodes, focused the first node in `708ms`, and produced `consoleErrorCount=0`, `pageErrorCount=0`, and no API 4xx/5xx responses. React Flow dev warnings remain non-blocking development warnings.
- `bash scripts/service.sh test topology`: initially failed because `scripts/topology-verify.sh` targeted the retired `.codex/specs/resource-topology-headlamp-parity/tasks.md` path. The script now defaults to `.codex/specs/ops-console-unified-experience` and validates `scripts/service.sh` topology hooks instead of a non-existent root `package.json`.
- `bash scripts/service.sh test topology`: passed after the compatibility fix.
- `bash -n scripts/service.sh scripts/topology-verify.sh scripts/topology-clean-artifacts.sh`: passed.
- `bash scripts/service.sh clean topology-artifacts --dry-run`: passed.
- Playwright MCP focused smoke loaded `/network/topology`, opened the resource-type picker, toggled workload-domain off so the graph became network-only, focused namespace `default`, selected `Service/kubernetes`, opened full detail drawer, and used the `EndpointSlice` relation jump. Result: `consoleErrorCount=0`.
- Follow-up hit-target fix disabled React Flow minimap pointer capture and moved the detail panel to a bottom sheet on narrow viewports. Retest confirmed normal clicks for namespace focus and breadcrumb navigation with `consoleErrorCount=0`.
- 2026-05-30 main-thread follow-up added topology detail/YAML affordances for resolvable graph nodes: `NodeDetailPanel` now shows `完整详情` when `resolveResourceDetailRequest` returns a request and `YAML` when `resolveResourceYamlTarget` returns an identity; `/network/topology` now mounts `ResourceYamlDrawer` and dynamic/core YAML targets. `cd frontend && npx tsc --noEmit --incremental false` passed after the change.
- 2026-05-31 main-thread follow-up fixed dynamic Gateway API detail parity in the global drawer. Dynamic fallback detail now preserves real `metadata.creationTimestamp`, exposes Gateway runtime fields and GatewayClass/HTTPRoute/Service associations, and passes raw `spec/status` into the GatewayClass/Gateway/HTTPRoute specialized renderers. `GET /api/resources/dynamic/.../detail` for `Gateway/traefik-gateway` returned `200` with `rawSpec`, `rawStatus`, real creation time, and GatewayClass relation.
- 2026-05-31 Playwright MCP stable-frontend retest covered `/network/gateway-api?kind=httproute` and confirmed the HTTPRoute segment is selected from the query string. It also covered `/network/topology` -> namespace `traefik` -> `Gateway/traefik-gateway` -> `完整详情`; the drawer rendered real creation time, GatewayClass runtime field, GatewayClass relation, `Spec`, `Status`, and YAML summary with `consoleErrorCount=0` and all relevant resource API requests returning `200`.
- 2026-06-02 Playwright MCP focused regression loaded `/network/topology` on the local dev stack, rendered `13` React Flow namespace nodes in global view, confirmed toolbar controls for cluster, namespace, resource type, grouping, abnormal-link focus, refresh, reset, and zoom, and produced `consoleErrorCount=0`.
- 2026-06-02 regression focused namespace `calico-apiserver`, verified breadcrumb transition from `Global` to `cluster / test` and `namespace / calico-apiserver`, opened the side detail panel, and confirmed group-member sections for network, workload, and Pod resources.
- 2026-06-02 regression selected `Service/calico-api` through relation jump, verified component/resource breadcrumb expansion, confirmed focused relation edges, opened `完整详情`, and verified the global drawer rendered Service metadata, high-frequency fields, relations, status/spec sections, and real backend detail data.
- 2026-06-02 regression opened topology YAML for `Service/calico-api` and confirmed the YAML drawer rendered `apiVersion: v1`, `kind: Service`, metadata, spec, reload, download, and save controls.
- 2026-06-02 regression switched grouping to `实例`, confirming the graph re-rendered `156` nodes and `80` edges; toggled `异常链路`, confirming an abnormal-focused graph with `17` nodes and `15` edges; then used `回到全局`, confirming breadcrumb reset to `Global`, detail panel closed, and global namespace overview restored.
- 2026-06-02 code hardening changed React Flow `nodeTypes` to a stable `useState`-initialized `NodeTypes` object and fixed `OpsDrawerShell` Ant Design `DrawerProps` type compatibility for `classNames/styles`.
- 2026-06-02 verification: `cd frontend && npx eslint src/app/network/topology/page.tsx src/components/ops/ops-drawer-shell.tsx` passed; `cd frontend && npx tsc --noEmit --pretty false --incremental false` passed; `git diff --check -- frontend/src/app/network/topology/page.tsx frontend/src/components/ops/ops-drawer-shell.tsx` passed.
- Current parity limitations remain: topology still excludes several Headlamp source families, synthetic Pod/Node/instance group entries are glance-only, and broader permission/source-unavailable matrices are still follow-up depth. Task 12.5 can close as a focused regression gate because representative Headlamp behaviors now have fresh browser evidence and residual gaps are explicitly tracked.

## GPT Image 2 Layout Validation

- Generated artifact: [gpt-image2_20260530_095939_1.png](assets/gpt-image2_20260530_095939_1.png), 1536x1024 PNG.
- Prompt intent: dense enterprise Kubernetes operations console, left navigation, top toolbar, central topology graph, right detail drawer, metadata/conditions/events/relationships/YAML action, degraded banner, light/dark split-screen token comparison.
- Design-to-code mapping:
  - Left navigation and route grouping map to `frontend/src/config/navigation.ts` plus shell layout.
  - Top toolbar maps to `/network/topology` cluster, namespace, resource-type, group-mode, abnormal-link, refresh, reset, and zoom controls.
  - Central graph maps to React Flow topology nodes/edges, namespace stack/overview/focus layouts, partial-coverage warning, and connected-component focus.
  - Right detail area maps to `NodeDetailPanel`, `ResourceDetailDrawer`, and `ResourceYamlDrawer`.
  - Degraded banner maps to topology unavailable/category alert and Gateway API partial-coverage alert.
  - Light/dark validation maps to global `data-theme`, AntD token maps, and topology CSS variables.
- Validation decision: artifact is accepted as a layout aid for tasks 0.3 and 5.4. It does not close functional Headlamp parity by itself; 12.5 remains governed by code behavior and browser regression.

## 12.5 / 6.2 Topology Detail Field/Action Checklist

Static code evidence:

- `rg -n "SOURCE_TOKEN_KEYS|queryKey: \\[\"topology-|NetworkPolicy|GatewayClass|HTTPRoute|EndpointSlice" frontend/src/app/network/topology/page.tsx`
- `rg -n "resolveResourceDetailRequest|setDetailRequest|ResourceDetailDrawer|ResourceYamlDrawer|getDynamicResourceDetail|detailInteractionsDisabled" frontend/src/app/network/topology/page.tsx`
- `rg -n "buildHeadlampDetailSections|buildSpecSection|buildStatusSection|buildYamlSummarySection|RelationshipNavigatorSection|EventsSection|MetadataSection" frontend/src/components/resource-detail`
- `rg -n "ResourceDetailResponse|ResourceDetailRuntime|ResourceDetailMetadata|ResourceDetailRelationshipGroup" frontend/src/lib/api/resources.ts backend/control-api/src/resources/resources-detail.contract.ts`

| Headlamp detail group/action | Topology current state | 12.5 parity status |
| --- | --- | --- |
| metadata | Real topology nodes that open `ResourceDetailDrawer` can receive backend metadata through standard detail API. Dynamic Gateway API fallback now preserves real resource creation timestamps instead of substituting request time. | Covered for supported real nodes; synthetic entries still have no authoritative metadata. |
| spec | Detail renderer uses backend `detail.rawSpec` before client snapshot. Dynamic Gateway API fallback supplies raw `spec`, and GatewayClass/Gateway/HTTPRoute specialized renderers now append the Headlamp-style Spec summary. | Covered for supported real nodes with backend detail; unsupported/synthetic nodes remain excluded. |
| status | Detail renderer uses backend `detail.rawStatus` before client snapshot. Dynamic Gateway API fallback supplies raw `status`, conditions, and Gateway runtime fields. | Covered for supported real nodes with backend detail; unsupported/synthetic nodes remain excluded. |
| conditions | Supported when backend detail or dynamic fallback returns `runtime.conditions`; Gateway API dynamic fallback extracts `status.conditions`. | Covered for real nodes; not available for synthetic Pod/Node group entries. |
| events | Covered through backend detail API for real resource ids; drawer renders Events section or empty state. | Covered for real nodes, but not topology-specific regressed per kind. |
| relationships | Drawer relationship navigation works after a detail opens; topology graph relations cover network/workload/Gateway families currently in source tokens. Dynamic Gateway fallback now adds Gateway -> GatewayClass and HTTPRoute -> Gateway/Service associations. | Partial: missing Headlamp families remain ReplicaSet, Job, CronJob, HPA, VPA, PV/PVC/SC, ConfigMap, Secret, ServiceAccount, Node, broad CRDs. |
| YAML | `/network/topology` now mounts `ResourceYamlDrawer`; the focused-node panel exposes a `YAML` button when `resolveResourceYamlTarget` can derive a core or dynamic identity. Detail drawer still only shows YAML summary text. | Improved. Gateway full-detail browser regression passed; broader Namespace/Service/GatewayClass YAML path remains pending. Synthetic entries without real identity still have no YAML affordance. |
| actions | Topology exposes focus/filter/grouping quick actions and drawer refresh/close/back; row-level actions like delete/logs/terminal/scale/image are not part of topology. | Partial by design; action parity is weaker than list pages. |
| loading | React Query/topology loading and drawer `Skeleton` cover loading state. | Covered generically. |
| error | Topology has unavailable/auth-expired handling and drawer error/retry for detail API failures. | Covered generically; per-resource detail error matrix still missing. |
| degraded | Gateway API optional dynamic source failure can degrade to partial coverage; missing CRDs can return empty optional reads; detail interaction disables when cluster data unavailable. | Partial: no explicit degraded metadata for all missing source families or event-only failures. |

12.5 result: focused regression complete as of 2026-06-02. Current topology can open global detail/YAML for supported real nodes and Namespace dynamic identity, relationship jumps work, Gateway full-detail raw spec/status evidence exists, and Service detail/YAML plus grouping/filter/reset flows have fresh browser evidence. Source and drawer parity remain incomplete because several Headlamp resource families are absent and synthetic Pod/Node/instance group entries still lack real identities.

## Filter, Regroup, and Partial Coverage Update

The topology view now handles two 5.3 stability gaps in the graph UI:

- Gateway API dynamic source failures are no longer silent. The graph records unavailable `GatewayClass`, `Gateway`, or `HTTPRoute` lists and renders a partial-coverage warning while preserving the rest of the topology.
- Resource-type and abnormal filters clear stale focused nodes and open detail requests, so a hidden resource cannot keep an outdated side panel after regrouping or filtering.
- Focused-node rendering is derived from the currently visible node set, which prevents detail panels from surviving when the selected node is filtered out.

Verification:

- `cd frontend && npm run lint -- --max-warnings=0`: passed.
- `cd frontend && npx tsc --noEmit --incremental false`: passed.

## Gap Matrix

| Spec task | Gap | Impact | Low-conflict fix |
| --- | --- | --- | --- |
| 5.1 graph source selection | Topology source picker now includes NetworkPolicy, GatewayClass, Gateway, and HTTPRoute. It still excludes ReplicaSet, Job, CronJob, HPA, VPA, PV, PVC, StorageClass, ConfigMap, Secret, ServiceAccount, Namespace, Node, and broad CRD/custom kinds. | Resource panorama is closer to Headlamp-equivalent network coverage but still not a global Kubernetes graph source selector. | Add workload batch next, then storage/config/autoscaling. Keep existing network/workload default selection stable. |
| 5.1 namespace grouping | Namespace grouping only derives namespaces from active network resources plus Deployment/StatefulSet/DaemonSet. Empty namespaces or namespaces with only config/storage/autoscaling/custom resources are missing. | Breadcrumb and namespace overview can hide valid resource scopes. | Add namespace inventory as optional source and merge namespace set without changing existing node ids. |
| 5.1 connected-component focus | Connected components ignore unsupported source kinds because those nodes never enter the graph. | Focus can under-report blast radius around policies, routes, jobs, PVCs, or config consumers. | Add new node kinds behind existing `baseFilteredNodeIds` pipeline, then reuse current component builder. |
| 5.2 node glance/detail | Namespace nodes can now open global detail via dynamic core `namespaces` identity. Cluster, synthetic Pod, synthetic Node, and instance group nodes remain glance-only. | Operator can inspect namespaces from the graph, but runtime placement and synthetic pods still cannot show authoritative detail. | For pod/node, either ingest real Pod/Node list or clearly mark synthetic nodes as no-resource-detail. |
| 5.2 relation jump | Existing relation links cover Ingress/IngressRoute -> Service, Service -> controllers, Endpoints/EndpointSlice -> Service/controllers, NetworkPolicy selector edges, and Gateway/HTTPRoute refs. Missing relation families remain PVC mount edges, ConfigMap/Secret consumers, HPA target refs, owner chains for ReplicaSet/Job/CronJob, and CRD owner refs. | Headlamp-style relation jumps are improved for network resources, but many cross-domain jumps remain absent. | Add relation extractors in the same order as remaining source expansion. |
| 5.3 filter/regroup stability | Resource filters clear hidden focus/detail state and focused-node rendering is derived from visible nodes. Synthetic pod ids still use controller id + index and generated pod labels. | Filter/regroup stale panel risk is reduced; synthetic nodes still cannot be verified against backend resource identity. | Treat synthetic pods as visual replica placeholders, or replace them with real Pod inventory before claiming Headlamp parity. |
| 5.3 degraded/error state | Topology shows categorized API failure when required source queries fail. Gateway API dynamic source failure is surfaced as partial coverage. Missing future kind coverage is still docs-only. | Operators can see Gateway API partial coverage, but still must rely on this audit for unsupported non-network domains. | Extend partial-coverage metadata as remaining Headlamp source families are added. |
| 6.1 entry coverage | `docs/global-detail-drawer-audit.md` now links this topology exception matrix and records route/kind/source coverage. Topology mounts `ResourceDetailDrawer`, supports real network/workload/Gateway dynamic nodes, and explicitly excludes namespace/instancegroup/node/synthetic nodes from detail requests. | 6.1 can be accepted for global entry inventory because supported and unsupported topology entries are both documented. | Keep topology source expansion in 5.x/6.5 rather than blocking the 6.1 inventory checkpoint. |
| 6.2 Headlamp field parity | Global drawer renderer/backend now cover raw spec/status, conditions, events, relationships, and drawer-level YAML for supported resources. Topology still does not pass `kindLabel`, `apiVersion`, `namespace`, or `name` for every request; it relies on `kind` + `id` plus backend detail resolution. | Global 6.2 can close; topology-specific metadata breadth remains part of 12.5. | Prefer additive request metadata from topology raw resource where available; do not change backend contract. |
| 6.3 YAML/action availability | `/network/topology` now mounts `ResourceYamlDrawer` and exposes YAML from the focused-node panel for resolvable resources. Current detail drawer itself still only has refresh/close/back. | Topology YAML gap is reduced, but still not browser-regressed and not available for synthetic entries. | Run browser path: select Namespace, Service, GatewayClass/Gateway if present, open YAML, reload, close, verify console/page errors. |
| 6.4 unavailable/permission states | Detail drawer has load/error/retry state; topology disables detail interactions when cluster data unavailable. Permission-denied/source-unavailable per kind is not route-regressed. | Meets generic error handling, but lacks 6.4 evidence matrix. | Add route-level regression cases for 403/404/503 detail calls after source expansion. |
| 6.5 representative regression | No browser or static regression matrix specifically checks topology detail parity across resource domains. | 6.5 remains open. | Add a static smoke first, then Playwright path: select Service, Deployment, namespace, synthetic Pod, unavailable source, and a relationship jump. |

## Suggested Execution Order

1. Freeze current evidence by linking this audit from `docs/global-detail-drawer-audit.md` and `docs/ops-console-unified-execution-plan.md`.
2. Browser-regress the new topology Namespace detail and YAML affordances.
3. Replace synthetic Pod/Node detail ambiguity: either load real Pod/Node inventory or label synthetic nodes as non-resource placeholders with no detail drawer action.
4. Add workload batch: ReplicaSet, Job, CronJob, plus owner-chain relations.
5. Add autoscaling/storage/config relations: HPA/VPA target refs, PVC/PV/StorageClass binding, ConfigMap/Secret/ServiceAccount consumers.
6. Add CRD/custom-resource fallback only after core Kubernetes kinds have stable source and relation behavior.
7. Run browser regression for graph focus, filter/regroup identity, detail open, refresh, close, relationship navigation, YAML decision, and degraded/error state.

## Minimal Verification Commands

Static scans:

```bash
rg -n "SOURCE_TOKEN_KEYS|RESOURCE_DOMAIN_META|resolveResourceDetailRequest|queryKey: \\[\"topology-|ResourceDetailDrawer|ResourceYamlDrawer" frontend/src/app/network/topology/page.tsx
rg -n "ResourceDetailDrawer|ClusterDetailDrawer|ResourceYamlDrawer" frontend/src/app frontend/src/components
rg -n "detailSource|GatewayClass|NetworkPolicy|HorizontalPodAutoscaler|StorageClass|dynamic" backend/control-api/src/resources
```

If this document changes:

```bash
git diff --check -- docs/topology-detail-parity-audit.md
```

## Current Audit Result

Tasks 5.1, 5.2, 5.3, and 5.4 have enough evidence for the NetworkPolicy/Gateway API, filter/regroup stabilization, and design-aid validation slices. Task 6.1 has enough evidence after linking the global drawer matrix with this topology exception matrix. Task 6.2 can close for the global drawer scope after raw spec/status and drawer-level YAML action support. Task 12.5 can close for focused regression evidence after the 2026-06-02 browser pass. Synthetic-node semantics, broader topology source parity, and permission/source-unavailable regression remain follow-up depth rather than release-gate blockers.
