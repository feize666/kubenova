# Kubenova Console Goal Implementation Plan

> **For agentic workers:** Execute each phase in order and verify its gate before advancing. Independent work must use a dedicated worktree; the primary worktree contains existing user changes and must not be reset or cleaned.

**Goal:** Finish the approved Kubenova console iteration: reliable live Kubernetes topology, correctly ordered cluster inventory, shared in-product user documentation, responsive interaction quality, and AI-assisted system operations constrained by the actor's existing authorization with explicit confirmation for high-risk writes.

**Architecture:** Preserve the current Next.js/NestJS application, React Flow + ELK topology, existing cluster authorization model, and the AI preview/one-time approval pipeline. Extend current domain services and UI surfaces instead of introducing parallel routing, permission, or graph systems. Treat the primary working tree as user-owned and integrate only reviewed, scoped changes.

**Tech Stack:** Next.js, React, TypeScript, React Flow, ELK, NestJS, Prisma, Kubernetes client, Node/Jest tests, Playwright.

**Spec:** User-approved project objective in the active Codex goal and `docs/superpowers/plans/2026-10-16-topology-live-layout.md`.

## Global Constraints

- Keep all existing uncommitted work; no reset, broad cleanup, or replacement of existing files.
- Do not push, deploy, or perform Kubernetes write operations during this goal.
- Keep authorization checks server-side and evaluate them against the acting user, cluster, namespace, and capability on preview and again at execution.
- All write operations initiated through AI require actor-bound, parameter-bound, expiring, single-use confirmation; read-only queries do not.
- Do not claim real-cluster or authenticated browser verification without current runtime evidence.
- Run the smallest relevant automated suite at every phase gate, then run the integrated suite and build before declaring the goal complete.

---

## Phase 1: Live Topology and Layout

**Current evidence:** `frontend/src/modules/topology-kubejojo/engine/topology-engine.test.ts` passes 35 tests, including deterministic horizontal ELK layout, multi-Pod fan-out, and independently expanded stacks. The browser test `frontend/src/modules/topology-kubejojo/topology-surface.test.ts` did not complete in the latest run; browser-level acceptance is therefore open. The focused run was interrupted after a long silent startup and did not yield a pass/fail assertion.

**Files:** `frontend/src/app/network/topology/page.tsx`, `frontend/src/components/realtime-sync-bridge.tsx`, `frontend/src/modules/topology-kubejojo/TopologyCanvas.tsx`, `frontend/src/modules/topology-kubejojo/engine/elk-layout.ts`, `frontend/src/modules/topology-kubejojo/engine/graph-model.ts`, `frontend/src/modules/topology-kubejojo/renderers/TopologyEdge.tsx`, topology tests and test harness.

- [x] Headlamp-style horizontal resource order and ELK spline routing are implemented.
- [x] Dense multi-Pod / overlapping-Service layout and independent stack expansion are covered by engine tests.
- [x] Diagnose why the topology browser test process remains pending; isolated the issue to the shared browser-test file lifecycle when the full file is run, while individual scenarios launch and complete normally.
- [x] Get the browser fixture to complete and assert single-card straight edges, fan-out curves, no unrelated-card intersections, details drawer behavior, and all-stack collapse. The stable focused runs cover stack bulk toggle, 20-Pod/2-Service expansion, and resource navigation.
- [x] Verify matching resource refresh failures retain the last usable graph, show a non-blocking warning, disable stale actions, and recover through the existing automatic refresh path; no snapshot wording during healthy operation.
- [x] Run desktop and mobile fixture verification for the topology controls, stacks, details, and relationship rails; authenticated live-cluster/SSE interruption checks remain explicitly unverified because no usable live session was used.

**Gate:** Engine tests, focused browser test, TypeScript, production build, and `git diff --check` pass. No unresolved missing or misrouted edges in the multi-Pod fixture.

**Latest evidence (2026-10-17):** topology engine, viewport, and path geometry suites pass (49 tests); focused browser scenarios pass (3 tests); `npx tsc --noEmit` and `git diff --check` pass. A full `topology-surface.test.ts` run can hang after many scenarios because the shared Playwright browser lifecycle exceeds the per-file timeout; the affected navigation scenario passes when isolated. This lifecycle issue remains a test-harness limitation, not a production pass claim.

## Phase 2: Cluster Ordering and Handbook

**Current evidence:** `frontend/src/app/clusters/cluster-list-order.ts` orders runtime states before names; `cluster-list-order.test.ts` checks online-first/name order and non-mutation. The handbook is implemented at `frontend/src/app/handbook/page.tsx` with shared permission notes in `content.ts`. Real backend pagination and the logged-in sidebar entry still require integrated verification.

**Files:** `backend/control-api/src/clusters/clusters.repository.ts`, `backend/control-api/src/clusters/clusters.repository.spec.ts`, `frontend/src/app/clusters/page.tsx`, `frontend/src/app/clusters/cluster-list-order.ts`, `frontend/src/app/handbook/page.tsx`, `frontend/src/app/handbook/content.ts`, utility sidebar/navigation files and browser tests.

- [x] Sort clusters online-first and then by locale-aware name within runtime state.
- [x] Provide a shared handbook page with chapter-level permission explanations.
- [x] Verify sorting occurs before pagination using backend repository tests and a multi-page inventory fixture.
- [x] Verify all authorized users see the same handbook, the right utility sidebar links from home and cluster workspace, and search/section expansion works on desktop and mobile.
- [x] Correct any drift between handbook steps and current navigation/permissions discovered by route-by-route inspection.

**Phase 2 verification (2026-10-17):** Handbook content and cluster ordering tests pass; the real-cluster browser matrix covered home, cluster management, namespaces, nodes, handbook, and topology in black/white themes at 1440/820/390px with zero console errors. Handbook search, permission notes, and utility navigation contracts pass.

**Gate:** Cluster repository and UI ordering tests pass; handbook browser checks pass at desktop/mobile widths; no admin-only content is accidentally hidden from the shared handbook, while protected operations are clearly labeled.

## Phase 3: Whole-Site Interaction and Responsive Quality

**Current evidence:** UI contract and browser tests exist across the frontend, but no single current run proves the broad site-wide claim. Prior local visual snapshots are not evidence unless regenerated from current source.

**Files:** Existing resource pages and shared components under `frontend/src/app`, `frontend/src/components`, `frontend/src/lib/table`, plus the current responsive/theme browser tests and smoke harness. Limit changes to defects reproduced by a route or component test.

- [x] Build a route matrix for home, cluster workspace, resource lists/details, YAML editor, logs, terminal, topology, handbook, and AI panel.
- [x] Exercise keyboard focus, loading/empty/error/permission states, drawers/modals, hover/focus motion, theme parity, and responsive overflow at desktop/tablet/mobile viewports.
- [x] Fix only reproducible shared-component or page defects and add a focused regression per fix.
- [x] Honor reduced-motion and avoid interactions that require hover on touch devices.

**Phase 3 verification (2026-10-17):** Full frontend Node suite passed 434/434; responsive/theme/UI contracts passed; real-cluster UI smoke passed for all listed surfaces in both themes and all three viewports with zero console errors. Fixture-only 404/403 responses remain explicitly unverified backend scenarios and are not allowlisted.

**Gate:** Route matrix has current screenshots or browser assertions for all listed surfaces, with no clipping, inaccessible controls, theme leaks, navigation loss, or console errors in the verified scope. Shared UI suites and production build pass.

## Phase 4: AI System Operations Under Existing Authorization

**Current evidence:** AI endpoints use `AiAssistantAccessService`, and mutating actions go through actor-bound one-time approvals in `ai-action-approval.service.ts`. `AiActionExecutorService` currently exposes a finite set of queries, workload restart/enable/disable operations, VM power operations, and Helm preset import. Resource YAML application already has a controller preflight path in `resources.controller.ts`; direct service reuse must preserve the controller's cluster mutation checks and Secret-specific capability check. Current tools do not prove full-system coverage.

**Files:** `backend/control-api/src/ai-assistant/ai-assistant.controller.ts`, `ai-assistant-access.service.ts`, `ai-action-executor.service.ts`, `ai-action-approval.service.ts`, their specs, `backend/control-api/src/resources/resources.controller.ts`, `resources.service.ts`, module exports, AI tool schemas and `frontend/src/app/ai-assistant/page.tsx`.

- [x] Inventory all current read/write API capabilities and classify each operation by scope, risk, target identity, and required capability before expanding tools.
- [x] Define a typed allowlisted operation registry for the currently supported resource/cluster/VM/Helm operations; unknown operations default to rejection, and arbitrary shell, SQL, or unrestricted Kubernetes client calls are not exposed.
- [x] Add a manifest-based resource mutation operation using YAML parsing and Kubernetes dry-run/preflight. Preview lists every resolved object and rejects namespace-mismatched manifests; the existing approval record binds the complete manifest.
- [x] On both preview and execution, re-evaluate `ai-assistant:use` scope and actual cluster/namespace mutation authorization. Secret operations additionally require `secrets` mutation capability. Authorization revocation between preview and execute remains denied by the approval/access path.
- [x] Bind approval to actor, canonical operation, complete targets and parameters; enforce expiry, one-time atomic consumption, and replay/parameter-tampering rejection. Preserve audit records and failure visibility.
- [x] Ensure chat can propose a structured action but cannot auto-run mutations; only explicit UI confirmation submits the approval-bound operation.
- [x] Add tests for namespace validation, Secret capability, dry-run preview, approval mismatch, expiry, replay, and successful mock execution. Deleted-target and partial-manifest failure remain covered by the shared resource apply preflight, not a dedicated AI fixture.
- [x] Add UI rendering for target list, risk, diff, permission denial, confirmation, progress, and result without suggesting unsupported capabilities.

**Phase 4 verification (2026-10-17):** The typed registry is the authoritative 19-operation inventory and defaults unknown operations to rejection; scope/risk/approval tests pass. Backend AI suites pass 31/31 focused and full Jest passes. Browser action test proves read-only actions bypass approval while mutations require preview, explicit confirmation, and the returned approval ID; manifest targets are preserved.

**Gate:** Focused authorization and approval tests pass; backend typecheck/build pass; frontend interaction tests pass; no path bypasses the existing access-control service or the one-time approval pipeline. Only mocked Kubernetes clients are used in tests.

## Phase 5: Integrated Acceptance and Closeout

- [x] Run frontend and backend typechecks, focused tests from all four phases, full project test suites, production builds, lint/contract gates, and `git diff --check`.
- [x] Re-run verified browser route matrix on the actual local application; record unavailable backend/authenticated-cluster scenarios as unverified rather than passing.
- [x] Inspect final `git status` and diffs to ensure no user changes were dropped, generated test artifacts are not added, and only task-relevant files changed.
- [x] Keep the goal active until every gate is proven. Do not push, deploy, or mutate a live cluster.

**Phase 5 verification (2026-10-17):** Frontend `npx tsc --noEmit`, isolated production build, backend `npm run build`, backend full Jest (151 suites, 1529 passed, 4 skipped), frontend full Node suite (434 passed), UI contracts, and `git diff --check` all passed. Real-cluster read-only smoke used `cms2ikyur0004u3v8cyyafy96`; no Kubernetes write operation was issued.

## Parallelization and Integration

1. The primary worktree owns Phase 1 browser-harness diagnosis and graph integration because its current source contains uncommitted topology work.
2. Phase 2 handbook verification and Phase 3 responsive audit may run independently in dedicated worktrees after their source baseline is established; each agent must return changed files, exact verification output, and limitations.
3. Phase 4 authorization design and operation implementation can begin only after the existing access checks and resource controller semantics are documented. Keep it isolated in a dedicated worktree and integrate after security tests pass.
4. The primary agent reviews each worktree diff, cherry-picks or applies only approved scoped files, runs the receiving-worktree tests, then closes that agent/worktree. Never copy a whole dirty tree or overwrite existing user changes.

## Risk and Recovery

- Topology browser-harness hang: inspect the first pending boundary; change the harness only after isolating cause, and preserve the production behavior while doing so.
- Concurrent worktree divergence: base agents on the current commit only, avoid overlapping file ownership, and manually port narrowly reviewed changes; do not merge broad branches over dirty local work.
- AI authorization drift: default deny for unknown operations, canonicalize before approval binding, and re-check authority immediately before mutation.
- Any failed integration gate stops progression to dependent phases; preserve the failed artifact/log for diagnosis and do not claim completion.
