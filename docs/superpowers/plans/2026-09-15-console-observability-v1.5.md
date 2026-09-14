# KubeNova Console Observability v1.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Each task is delivered in an isolated worktree and must pass its scoped verification before integration.

**Goal:** Deliver a modern enterprise blue-white KubeNova console with a redesigned overview dashboard, focused logs and terminal workbenches, first-class cluster-scoped Prometheus/Grafana monitoring, and a clean two-item system settings area.

**Architecture:** Keep the existing Next.js App Router, Ant Design, React Query, xterm, PostgreSQL, Redis, and monitoring APIs. Refactor the presentation into focused workbench components, keep cluster scope in the route/context, and add a server-controlled Grafana embed contract so the browser never receives provider credentials. Existing resource operations, permissions, and API fallbacks remain intact.

**Tech Stack:** Next.js 16, React 19, TypeScript, Ant Design 6, React Query, xterm, ECharts where a chart is required, NestJS, Prisma, Prometheus-compatible APIs, Grafana iframe embedding.

**Spec:** User request confirmed on 2026-09-15: embed Grafana panels in the cluster Prometheus monitoring page; preserve the existing site color direction while modernizing all listed surfaces.

## Global Constraints

- Preserve the existing blue-white visual direction and dark-theme support; do not introduce a new dominant color family.
- Keep every monitoring, log, terminal, and dashboard request scoped to the current cluster workspace.
- Do not expose Grafana service tokens, datasource credentials, or raw secrets to browser JavaScript.
- Keep PostgreSQL, Redis, Kubernetes data collection, RBAC, resource navigation, and existing fallback behavior compatible.
- The only local frontend validation port is `3000`; do not leave additional test servers running.
- Each worktree owns a disjoint file set; shared stylesheet changes are integrated by the root agent after scoped work passes.
- Every completed task must include focused tests, lint/build evidence, and a concise risk note.

## Delivery Matrix

| Track | Scope | Worktree | Can run in parallel |
| --- | --- | --- | --- |
| A | Overview dashboard metrics and visual composition | `kubenova-v15-overview` | B, C |
| B | Logs and terminal workbench UI extraction | `kubenova-v15-runtime-workbench` | A, C |
| C | Cluster navigation, settings split, Prometheus/Grafana embed contract | `kubenova-v15-observability-shell` | A, B |
| Root | Token consolidation, integration, browser QA, release | current `codex/platform-shell` | after A/B/C |

## Task 1: Overview Dashboard

**Files:**
- Modify: `frontend/src/app/page.tsx`
- Create: `frontend/src/components/overview/overview-command-center.tsx`
- Create: `frontend/src/components/overview/overview-metric-strip.tsx`
- Create: `frontend/src/components/overview/overview-trend-panel.tsx`
- Create: `frontend/src/components/overview/overview-risk-panel.tsx`
- Modify: `frontend/src/lib/api/dashboard.ts`
- Modify: `backend/control-api/src/dashboard/dashboard.service.ts`
- Modify: `backend/control-api/src/dashboard/dashboard.controller.ts`
- Test: `backend/control-api/src/dashboard/dashboard.service.spec.ts`
- Test: `frontend/src/lib/api/dashboard.test.ts`

**Requirements:**
- Make the page composition readable by moving query-independent visual sections out of the 800-line route component.
- Build a command-center header with current scope, last collection time, data freshness, refresh action, and direct links to the cluster workspace.
- Present health score, cluster availability, Ready/NotReady nodes, workloads, Pods, namespace count, active critical/warning alerts, and CPU/memory utilization as a consistent metric strip.
- Add explicit `capturedAt`, `freshness`, `source`, and `degradedReason` display for every live metric; never show a synthetic number as live data.
- Reuse the current scoped dashboard API and add only missing trustworthy fields; preserve the existing 5-second server cache and live metrics fallback.
- Use the existing blue/white token system, responsive grid, keyboard focus, skeleton, empty, error, and degraded states. Use ECharts or existing chart primitives for real tooltips and responsive resizing instead of adding a second chart library.

**Verification:** Run the dashboard service/controller tests, dashboard API tests, ESLint for changed files, and `npm run build:stable` in the frontend worktree.

## Task 2: Logs and Terminal Workbenches

**Files:**
- Modify: `frontend/src/app/logs/page.tsx`
- Modify: `frontend/src/app/terminal/page.tsx`
- Create: `frontend/src/components/runtime-workbench/runtime-workbench-frame.tsx`
- Create: `frontend/src/components/runtime-workbench/runtime-context-bar.tsx`
- Create: `frontend/src/components/runtime-workbench/runtime-status-strip.tsx`
- Create: `frontend/src/components/runtime-workbench/runtime-action-menu.tsx`
- Create: `frontend/src/app/runtime-workbench.css`
- Test: `frontend/src/lib/api/logs.test.ts`
- Test: existing runtime websocket/session tests, if present

**Requirements:**
- Keep all existing log query parameters, streaming, follow mode, time modes, severity filters, keyword search, export, reconnect, previous logs, and resource return links.
- Keep xterm as the terminal renderer and preserve resize/input/session semantics.
- Use one frame: compact context bar, one grouped control row, status strip, and a dominant output stage. Remove duplicate decorative cards and duplicated action buttons.
- Provide explicit states for target missing, connecting, connected, reconnecting, stopped, permission denied, empty result, and backend unavailable.
- Make log output and terminal output fill the available viewport, work at 1440px, 1024px, and 390px widths, and preserve dark-mode contrast.
- Keep advanced controls in a discoverable action menu; do not move operational controls into hidden hover-only areas.

**Verification:** Run focused log API/websocket tests, ESLint for the workbench files, `git diff --check`, and a local route smoke test for `/logs` and `/terminal`.

## Task 3: Cluster Navigation, Settings, Prometheus, and Grafana

**Files:**
- Modify: `frontend/src/lib/cluster-workspace.ts`
- Modify: `frontend/src/components/cluster-workspace-shell.tsx`
- Create: `frontend/src/app/settings/layout.tsx`
- Modify: `frontend/src/app/settings/page.tsx`
- Create: `frontend/src/app/settings/ai/page.tsx`
- Modify: `frontend/src/app/system/update/page.tsx`
- Create: `frontend/src/components/monitoring/grafana-panel.tsx`
- Modify: `frontend/src/app/observability/page.tsx`
- Modify: `frontend/src/app/observability/configuration/page.tsx`
- Modify: `frontend/src/lib/api/observability-config.ts`
- Modify: `backend/control-api/src/monitoring/observability.controller.ts`
- Modify: `backend/control-api/src/monitoring/observability.service.ts`
- Modify: `backend/control-api/src/monitoring/monitoring.controller.ts`
- Modify: `backend/control-api/src/monitoring/monitoring.service.ts`
- Test: `backend/control-api/src/monitoring/observability.controller.spec.ts`
- Test: `backend/control-api/src/monitoring/observability.service.spec.ts`
- Test: `frontend/src/lib/api/observability-config.test.ts`

**Requirements:**
- Promote `日志` and `Prometheus 监控` to first-level items in the cluster workspace, each using the current `clusterId`; remove their duplicate placement from the generic operations group.
- Keep inspection, AI assistant, and terminal as separate operational entries without changing their existing route behavior.
- Make `/settings` a settings shell with exactly two secondary entries: `更新管理` and `AI 助手配置`; remove the monitoring/logs shortcut card and keep `/settings/update` and `/system/update` compatibility.
- Add a cluster-scoped monitoring composition with native health/alerts plus Grafana panels. The Grafana panel receives only a server-produced safe embed URL or panel configuration, never a provider token.
- Extend observability configuration metadata with dashboard UID, panel ID, default time range, theme, and optional variable mapping. Validate allowed Grafana origins and panel identifiers server-side.
- The backend must check cluster read access before returning panel configuration, use CSP/frame policy compatible with the configured Grafana origin, and return a clear unavailable state when Grafana is not configured or cannot be probed.
- Keep the current Prometheus, Grafana, Alertmanager, Elasticsearch, and Kibana datasource model and existing admin mutation boundaries.

**Verification:** Run monitoring/observability controller and service tests, frontend API tests, route contract checks, ESLint, and an authenticated browser smoke test for settings and the cluster monitoring route.

## Task 4: Root Integration and Visual QA

**Files:**
- Modify: `frontend/src/app/layout.tsx`
- Modify: `frontend/src/app/globals.css`
- Modify: `frontend/src/app/ops-design-system.css`
- Create: `frontend/src/app/console-v15.css`
- Modify: route contract scripts only when a new canonical route requires it
- Test: `frontend/scripts/check-navigation.mjs`
- Test: `frontend/scripts/check-theme-tokens.mjs`
- Test: `frontend/scripts/ui-tech-smoke.mjs`

**Requirements:**
- Integrate A/B/C without reintroducing duplicate CSS specificity or arbitrary inline colors.
- Add tokens for surfaces, focus, status, chart grid, embedded panel frame, and dark-mode equivalents while retaining existing theme variables.
- Confirm global controls, resource tables, filters, drawers, banners, and menus use the same dimensions and interaction states.
- Use browser screenshots at 1440x900, 1280x800, and 390x844 for `/`, a representative resource list, `/logs`, `/terminal`, and `/clusters/:clusterId/monitoring`.
- Verify Grafana unavailable, Prometheus stale, cluster offline, empty logs, reconnecting terminal, and permission-denied states.

**Verification:** Run frontend lint, stable build, route/theme/UI contract checks, backend build and full tests, then start only port `3000` and perform browser smoke tests.

## Task 5: Release and Cleanup

**Requirements:**
- Review each merged diff for scope violations and security-sensitive Grafana data leakage.
- Remove temporary screenshots, traces, review packages, and stopped worktree artifacts after evidence is recorded.
- Commit the integrated release, tag `v1.5`, and push only after local validation passes; merge to `master` only as an explicit release step after checking branch divergence.
- Record rollback as returning to `v1.4` and disabling the Grafana panel feature flag/configuration if the external panel is unavailable.

