# Resource Topology Live Layout Implementation Plan

> **For agentic workers:** Execute this plan in order and verify each step before moving on.

**Goal:** Keep the topology current from cluster resource events and render multi-Pod / multi-Service relationships as stable, readable curves.

**Architecture:** Reuse the existing authenticated cluster SSE stream and React Query cache invalidation. Improve the current ELK layout and SVG edge renderer without replacing React Flow or changing Kubernetes relationship data. Keep the last graph visible during a stream interruption, show a connection-state notice, and prevent resource mutations until a successful refresh restores current data.

**Tech Stack:** Next.js, React Query, React Flow, ELK, NestJS SSE, Jest/Node tests, Playwright.

**Spec:** User-approved topology behavior in the current conversation; reference screenshots at `/var/folders/5b/k58qwx7n4ml2kw4fxbl5px_h0000gn/T/codex-clipboard-9b3c38dc-63af-4c9a-af1c-93759493eb8d.png` and `/var/folders/5b/k58qwx7n4ml2kw4fxbl5px_h0000gn/T/codex-clipboard-c9024086-7efe-4395-89e6-d15f06f4ae0f.png`.

## Global Constraints

- Preserve one visual node per Kubernetes resource.
- Keep the visual order Deployment → ReplicaSet → Pod → Service → Endpoints/EndpointSlice → Ingress.
- Preserve current theme colors, resource detail drawer behavior, namespace filters, and relation data.
- Normal connected operation must not display snapshot wording.
- A disconnected graph stays visible but is read-only until refreshed.
- Layout updates preserve viewport transform and selected resource whenever possible.

## Verification Checkpoint (2026-10-16)

- Automated checks passed: `node scripts/run-node-tests.mjs` (419 tests), `npm run build:stable`, `npx tsc --noEmit`, targeted ESLint (0 errors; 9 existing unused-variable warnings in the topology page), and `git diff --check`.
- The 20-Pod / overlapping-Service browser fixture verifies complete nodes and edges, horizontal stage order, no card overlap, and routes that do not cross unrelated cards.
- Manual refresh no longer forces `fitVersion`; the visible viewport is preserved while cluster, namespace, and graph queries refresh. The browser regression test covers retained graph visibility during reconciliation.
- Real logged-in cluster screenshots and SSE transport interruption/recovery remain unverified because this session has no reusable authenticated browser connection.
- Dense relationship readability remains open: edge bundling/count affordances for heavily overlapping fan-out have not been implemented or accepted visually. Do not mark Tasks 3 or 4 complete until this is resolved and rechecked.

---

### Task 1: Prove event-driven topology invalidation

**Files:**
- Inspect: `frontend/src/components/realtime-sync-bridge.tsx`
- Inspect: `frontend/src/components/realtime-sync-utils.ts`
- Modify: `frontend/src/app/network/topology/page.tsx`
- Test: `frontend/src/app/network/topology/*test*`

- [ ] Add a focused test that a workload, Pod, Service, Endpoint, EndpointSlice, or Ingress event invalidates the active `topology-v2` graph query for the same cluster.
- [ ] Confirm the event bridge handles reconnect and cluster filtering without losing the visible graph.
- [ ] Set topology queries to refresh on matching SSE events and perform a bounded periodic reconciliation while visible.
- [ ] Keep cached graph visible during transient fetch errors; expose stale/read-only state only while the connection or refresh is actually unhealthy.
- [ ] Run relevant tests and confirm normal state contains no “snapshot” messaging.

### Task 2: Make multi-resource layout deterministic

**Files:**
- Modify: `frontend/src/modules/topology-kubejojo/engine/elk-layout.ts`
- Modify: `frontend/src/modules/topology-kubejojo/engine/graph-model.ts`
- Test: `frontend/src/modules/topology-kubejojo/engine/topology-engine.test.ts`

- [ ] Add deterministic ordering for same-kind nodes using relationship neighborhoods followed by stable namespace/name/identity keys.
- [ ] Preserve node weight partitions for the approved left-to-right resource order.
- [ ] Use ELK's layered routing and node placement settings to keep parallel edges on distinct, smooth lanes; do not manually distort routed curves around unrelated nodes.
- [ ] Add fixtures for one ReplicaSet → 1/5/20 Pods, many Pods → one Service, and multiple Services selecting overlapping Pods.
- [ ] Assert repeat layouts produce stable columns, node ordering, and edge endpoints.

### Task 3: Render clean relation bundles and preserve navigation state

**Files:**
- Modify: `frontend/src/modules/topology-kubejojo/renderers/TopologyEdge.tsx`
- Modify: `frontend/src/modules/topology-kubejojo/renderers/path-geometry.ts`
- Modify: `frontend/src/modules/topology-kubejojo/TopologyCanvas.tsx`
- Test: `frontend/src/modules/topology-kubejojo/*test*`

- [ ] Keep a single centered line for a single relation and smooth parallel curves for fan-out.
- [ ] Bundle only truly overlapping parallel relations with a count affordance; selecting or hovering the bundle reveals its individual curves and targets.
- [ ] Retain the selected resource and viewport while a refreshed graph is laid out.
- [ ] Verify resource clicks still open the detail drawer and blank-canvas clicks restore global topology.
- [ ] Check reduced-motion behavior and keyboard access for bundle expansion.

### Task 4: Browser verification on real cluster data

**Files:**
- Modify if needed: `frontend/scripts/ui-tech-smoke.mjs`
- Evidence: local screenshots and test output (do not commit transient artifacts)

- [ ] Run the graph with a workload that has multiple Pods and at least two Services, including overlapping selectors if available.
- [ ] Capture desktop and mobile screenshots; verify no node overlap, missing edges, abrupt routing, or stale snapshot banner while connected.
- [ ] Simulate SSE interruption and recovery; verify retained read-only graph, clear status, automatic refresh, and restored actions.
- [ ] Run TypeScript, topology tests, production build, and `git diff --check`.
