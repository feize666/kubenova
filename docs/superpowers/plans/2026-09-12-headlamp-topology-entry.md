# Headlamp-Inspired Topology Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task.

**Goal:** Make resource topology workload-scoped: Namespace filters resources, while Deployment/StatefulSet/DaemonSet/Job/CronJob open the complete associated graph.

**Architecture:** Keep the existing topology API and relation semantics unchanged. Add a small entry-policy module that resolves valid workload roots and projects the root's connected resource component before the existing capacity, grouping, and ELK layout pipeline. The page follows Headlamp's resource-map model: scope selection filters the inventory, an explicit resource selection opens the graph, and related resources remain navigable details rather than new graph roots.

**Tech Stack:** Next.js App Router, React, TypeScript, Ant Design, React Flow, ELK, Node test files, ESLint.

**Spec:** User requirement: Namespace must not open an independent topology; Deployment/DaemonSet/StatefulSet and equivalent workload resources must open topology; related Service/Pod/Ingress/storage/configuration resources remain in the graph without independent topology scenes; align interaction with Headlamp.

## Global Constraints

- Preserve the existing four-domain graph and relation semantics.
- Preserve resource detail/YAML navigation and single-cluster workspace behavior.
- Keep Namespace as a filter context only.
- Do not reintroduce a non-workload "expand associated graph" root action.
- Keep the blue/white site theme and existing dark-mode tokens.
- Verify with the smallest relevant tests, ESLint, TypeScript/build, and `git diff --check`.

### Task 1: Root policy and connected projection

**Files:**
- Create: `frontend/src/modules/topology-kubejojo/engine/topology-entry.ts`
- Modify: `frontend/src/modules/topology-kubejojo/engine/index.ts`
- Test: `frontend/src/modules/topology-kubejojo/engine/topology-engine.test.ts`

- [ ] Define valid workload root kinds and exact resource resolution.
- [ ] Project the complete connected component for a selected workload through the existing capacity limits.
- [ ] Test accepted/rejected kinds, exact identity resolution, chain preservation, and missing roots.
- [ ] Run the topology engine test file and ESLint for the touched modules.

### Task 2: Workload-scoped page experience

**Files:**
- Modify: `frontend/src/app/network/topology/page.tsx`
- Modify: `frontend/src/app/topology-kubejojo.css`
- Test: `frontend/src/modules/topology-kubejojo/topology-surface.test.ts`

- [ ] Add explicit workload-root state and derive the graph from the selected root projection.
- [ ] Keep Namespace selection as a filter and clear the selected root when the scope changes.
- [ ] Render a workload picker empty state before a root is selected.
- [ ] Remove non-workload independent neighborhood graph controls.
- [ ] Add compact, theme-token-based workload picker styling and source-level regression assertions.

### Task 3: Canvas interaction alignment

**Files:**
- Modify: `frontend/src/modules/topology-kubejojo/TopologyCanvas.tsx`
- Test: `frontend/src/modules/topology-kubejojo/topology-surface.test.ts`

- [ ] Prevent Namespace/isolated aggregate cards from creating a new focus scene.
- [ ] Keep component expansion, detail selection, double-click management navigation, and relation highlighting intact.
- [ ] Allow workload nodes to reassert the active workload root without changing relation data.
- [ ] Run ESLint and the production build after the interaction changes.

### Task 4: Headlamp alignment review and acceptance

**Files:**
- Review: `frontend/src/components/resourceMap` from Headlamp source
- Review: `frontend/src/modules/topology-kubejojo`

- [ ] Compare namespace filtering, resource-scoped graph entry, detail actions, and layout behavior with Headlamp's resourceMap patterns.
- [ ] Run build, relevant tests, and static checks; record unrelated pre-existing failures separately.
- [ ] Remove temporary source-audit artifacts and close accepted subagent worktrees.

