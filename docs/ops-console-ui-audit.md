# Ops Console UI Audit

Primary spec: `.codex/specs/ops-console-unified-experience`, task 12.1.

This audit is based on static route/component scans plus existing browser route-loop evidence. It is an optimization backlog, not a full visual QA sign-off.

## Evidence Used

- Route map: `frontend/src/config/navigation.ts`
- Shared shell/theme/table/detail components:
  - `frontend/src/components/shell-layout.tsx`
  - `frontend/src/app/globals.css`
  - `frontend/src/components/resource-table/index.tsx`
  - `frontend/src/components/resource-table-toolbar.tsx`
  - `frontend/src/components/resource-detail/resource-detail-drawer.tsx`
  - `frontend/src/components/resource-yaml-drawer.tsx`
  - `frontend/src/components/resource-filter-toolbar.tsx`
  - `frontend/src/components/resource-scope-filter-button.tsx`
- Center pages added during this spec:
  - `frontend/src/app/observability/page.tsx`
  - `frontend/src/app/aiops/page.tsx`
  - `frontend/src/app/network/topology/page.tsx`
  - `frontend/src/app/clusters/nodes/page.tsx`
- Existing browser route-loop evidence from `docs/performance-stability-regression.md`:
  `/dashboard`, `/clusters`, `/clusters/nodes`, `/network/networkpolicy`, `/network/gateway-api`, `/network/topology`, `/observability`, `/observability/cluster-health`, `/aiops`, `/ai-assistant`; result `consoleErrorCount=0`, `pageErrorCount=0`.
- Existing full-site visual backlog baseline from `.codex/specs/ops-console-visual-refresh/design.md`.

## Route Coverage Snapshot

Static navigation currently covers overview, topology, cluster domain, workloads, network, storage, config, autoscaling, Helm, IAM/security, observability, AIOps, and system update routes.

Browser loop coverage is partial. It covers the newly added centers and several high-risk routes, but not every workload, storage, config, Helm, IAM, terminal, logs, or system-management page.

## 1.2 / 1.3 / 12.2 Regression Gap Matrix

Date: 2026-05-30. Source: local static evidence only; no browser run in this pass.

Static evidence commands used:

```bash
rg -l "<ResourceTable" frontend/src/app frontend/src/components -g '*.tsx' | sort
rg -l "<Modal|Modal\\.confirm" frontend/src/app frontend/src/components -g '*.tsx' | sort
rg -n "ResourceTable|ResourceDetailDrawer|ResourceYamlDrawer|BusinessDetailDrawer|ClusterDetailDrawer|NetworkResourcePageFilters|ResourceClusterNamespaceFilters|ResourceFilterToolbar|ResourceScopeFilterButton|ResourceFacetFilterButton|LabelFilter|Tag|Button|Modal|Drawer" frontend/src/app frontend/src/components -g '*.tsx'
rg -n "data-theme|ThemeProvider|ConfigProvider|kubenova-theme-mode|dark|light|--color|rgba\\(|#[0-9a-fA-F]{3,8}|linear-gradient|background" frontend/src/app/globals.css frontend/src/components frontend/src/app -g '*.tsx' -g '*.css'
rg -n "axe|accessibility|a11y|keyboard|Tab|Shift\\+Tab|Enter|Escape|aria" docs frontend -g '*.md' -g '*.tsx' -g '*.ts'
rg -n "@media|768px|640px|max-width|100vw|resource-table-toolbar|resource-filter-toolbar|topology-detail-panel|mobile" frontend/src/app/globals.css frontend/src/app/network/topology/page.tsx
rg -n "path:" frontend/src/config/navigation.ts
```

| Area | Current code evidence | Can close from current evidence | Still needs browser verification |
| --- | --- | --- | --- |
| Shared buttons / row actions | `ResourceAddButton` centralizes create button tooltip/shape; `ResourceActionDropdown` and `renderResourceActionTriggerButton` centralize compact row actions with `aria-label`; `ResourceTableToolbar` uses named search/filter/clear/column buttons. Pod pages still carry pod-specific action CSS variables and some pages compose local buttons. | Shared button primitives exist and cover common create/table/action entry points. This closes the static existence part of 1.2 for shared button foundations. | Visual consistency, hit target, focus ring, disabled/loading state, and popover/dropdown keyboard behavior across representative rows still need browser pass. |
| Shared tables | `ResourceTable` wraps AntD table, normalizes columns, default horizontal scroll, loading/empty state, Headlamp-style toolbar, column visibility, filters, sort, and preferences. Static scan found 34 `ResourceTable` call sites. | Shared table foundation exists and is broadly adopted; static table foundation gap can be marked closed. | Full route table regression remains open: routes with local AntD `Table` (`/aiops`, nested Helm/history tables) and route-specific `bordered`/`size`/scroll choices need desktop/mobile and light/dark browser review. |
| Drawers | `ResourceDetailDrawer` and `ClusterDetailDrawer` use `width: min(50vw, 960px)` plus `minWidth: 720`; `ResourceYamlDrawer` and `BusinessDetailDrawer` use AntD large drawer defaults; cluster/resource drawers have shared loading/error/retry, YAML has edit/download/save actions. | Static drawer behavior is documented enough to close "shared Kubernetes detail drawer exists" evidence. | Drawer-family parity is still open: mobile overflow risk from `minWidth: 720`, YAML/business drawer width differences, close/back/refresh focus order, and nested relationship navigation need browser validation. |
| Modals | Static scan found many route-local `Modal` and `Modal.confirm` implementations across cluster, workload, network, config, storage, IAM, Helm, and AI assistant flows. | Current evidence confirms modal usage is page-local, not yet normalized. This is a documented 1.2 gap, not closable. | Need browser check for modal open/close, confirm/cancel keyboard path, destructive action wording, focus return, and light/dark contrast per representative modal family. |
| Tags / badges | `StatusTag` exists for common states, but pages still use many direct AntD `Tag` colors and inline status styles (`blue`, `gold`, `purple`, `geekblue`, custom hex/rgba), including topology and AI/terminal surfaces. | Static evidence closes inventory: tags are mixed shared/local. | Need visual contrast review in both themes and mobile truncation for long Kubernetes labels and status chips. |
| Filters | `ResourceFilterToolbar`, `ResourceClusterNamespaceFilters`, `NetworkResourcePageFilters`, `ResourceScopeFilterButton`, facet buttons, table filter row, and URL-sync hooks exist. CSS includes responsive toolbar rules at `960px` and table toolbar rules at `720px`. | Static evidence closes the existence of shared filter primitives and responsive CSS hooks. | Still open: route-family consistency between global search, cluster/namespace filters, table column filters, topology popovers, and URL state needs browser interaction pass. |
| Light/dark theme | `globals.css` defines `[data-theme="dark"]` and `[data-theme="light"]` token sets; existing execution plan records `ThemeProvider`, `data-theme`, persisted `kubenova-theme-mode`, and AntD token maps. Static scan also shows many inline `rgba(...)`, hex colors, and gradients in pages/components. | Theme infrastructure can be considered implemented from static evidence. | 1.3 remains open: no current full light/dark route pass for readability, contrast, topology canvas, terminal, AI chat, modals, drawers, tags, and table fixed columns. |
| Mobile / responsive | Shared filter/table toolbar has media rules; topology popovers cap width with `calc(100vw - 24px)` and detail panel has responsive/bottom-sheet CSS. Resource/cluster drawers still use large fixed min width. | Static evidence closes "responsive hooks exist" for filter/table/topology surfaces. | Mobile regression remains open: drawer min width, table horizontal scroll/fixed action columns, toolbar wrapping, topology bottom sheet, AI chat, terminal, and modals need actual viewport checks. |
| Keyboard accessibility | Some buttons have `aria-label`; table filter title stops propagation on click/key; filter toolbar search uses `onPressEnter`; AntD components provide baseline semantics. No docs/source evidence of axe or manual Tab/Shift+Tab/Escape matrix was found. | Static evidence can close only "some accessible names exist on shared actions." | 12.2 accessibility gate remains open: manual keyboard and axe-style pass needed for shell nav, table toolbar/filter popovers, row action dropdowns, drawers, YAML editor, modals, topology canvas/panels, AI assistant, logs, and terminal. |

## 1.2 / 1.3 / 12.2 Closure Notes

- 1.2 can close only for static foundations: shared table, shared Kubernetes detail drawer, shared YAML drawer, shared filter toolbar, create/action button primitives, and theme tokens exist.
- 1.2 remains open for style normalization: modal family, drawer family widths, tag/status semantics, page-local table/action exceptions, empty/degraded-state treatment, and mixed inline colors.
- 1.3 remains open. Existing browser evidence is useful but does not cover all navigation routes, both themes, mobile, or keyboard/accessibility.
- 12.2 remains open. Existing focused regressions can support risk assessment, but this pass did not run fresh browser verification.

## P0 Must Fix Before Release Sign-Off

| Finding | Evidence | Impact | Priority | Proposed Action | Test Status |
| --- | --- | --- | --- | --- | --- |
| Full-site visual QA is not complete. Existing route loop covers 10 routes, not the full navigation tree. | `navSections` contains 30+ reachable entries; browser evidence lists 10 routes. | Undetected layout, console, or access-state regressions can remain on lower-traffic pages. | P0 | Run 12.2 route matrix across all sidebar routes in light and dark theme with console/page-error capture. | Not fully tested. |
| Mobile behavior for large drawers and tables needs real-device verification. `ResourceDetailDrawer` uses `minWidth: 720` and `width: min(50vw, 960px)`, while many tables use horizontal scroll. | `resource-detail-drawer.tsx`, `resource-table/index.tsx`, route pages using `ResourceTable`. | On narrow screens, detail content or drawer controls may overflow or become hard to close/read. | P0 | Add mobile viewport smoke for detail drawer open/close, YAML drawer, table toolbar, and fixed action column. | Not browser-tested. |
| Topology page still has parity gaps that affect UI expectations. Synthetic pod/node/group nodes and YAML gap are documented. | `docs/topology-detail-parity-audit.md`, `network/topology/page.tsx`. | User may expect Headlamp-like detail/YAML affordances from graph nodes but gets partial or synthetic behavior. | P0 | Decide scope wording in UI or implement missing real detail/YAML affordances before release gate. | Static audit only. |
| Accessibility pass is missing for focus order, keyboard operation, and accessible names across drawer/table/filter flows. | Heavy use of icon buttons, custom filter popovers, graph canvas, terminal, chat composer. | Keyboard-only and assistive-tech users may hit traps or unlabeled actions. | P0 | Run axe/manual keyboard audit for shell nav, table toolbar, row actions, detail drawer, YAML drawer, topology, AI assistant, and terminal. | Not tested. |

## P1 High Priority

| Finding | Evidence | Impact | Priority | Proposed Action | Test Status |
| --- | --- | --- | --- | --- | --- |
| Page header hierarchy and density still vary between legacy resource pages and new center pages. | Static scan shows mixed direct `Card`, `Typography.Title`, `ResourcePageHeader`, and center-page custom layouts. | Console feels less unified, especially when switching from resource lists to Observability/AIOps. | P1 | Standardize page title, subtitle, status summary, and primary action placement through shared header patterns. | Static only. |
| Table toolbar/filter patterns are not yet fully normalized across modules. | Shared `ResourceTable`/toolbar exists, but pages still combine `ResourceClusterNamespaceFilters`, `NetworkResourcePageFilters`, page-local controls, and table global search. | Operators may lose muscle memory between resource families; URL/filter state may feel inconsistent. | P1 | Normalize cluster/namespace/keyword/facet/filter-row behavior by route family and document exceptions. | Static only. |
| Drawer width and content structure vary by drawer family. | `ResourceDetailDrawer`, `ClusterDetailDrawer`, `BusinessDetailDrawer`, page-local Helm/AI drawers. | Similar "details" tasks feel different; mobile and dark-theme behavior can drift. | P1 | Define drawer classes: Kubernetes resource detail, business detail, workbench, settings. Align width, footer/action placement, and loading/error states. | Partial browser loop only. |
| Light/dark theme relies on shared CSS variables plus many inline colors. | `globals.css` has token system; scans show route/component inline `rgba(...)`, hex colors, gradients. | Some pages can miss contrast or look off when theme toggles. | P1 | Replace high-use inline colors with semantic tokens on shared surfaces first: shell, tables, drawers, center cards, graph quick links. | Not theme-loop tested. |
| Table row action style is not uniformly quiet. | `resource-action-bar.tsx`, Pod-specific action CSS vars, several pages still use page-local action composition. | Dense resource pages can look visually noisy, especially fixed right columns. | P1 | Use one compact action trigger style for all resource rows; reserve heavier buttons for primary create/apply actions. | Static only. |
| Console error regression is partial. | Existing loop has zero console/page errors for 10 routes. | Untested routes may still produce runtime warnings/errors under auth, empty data, or source-unavailable states. | P1 | Extend browser loop to all nav routes plus drawer/table/filter interactions. | 10-route loop passed; full-site not tested. |

## P2 Medium Priority

| Finding | Evidence | Impact | Priority | Proposed Action | Test Status |
| --- | --- | --- | --- | --- | --- |
| Empty/degraded-state copy and visual treatment vary by page family. | `Empty`, `Alert`, `Skeleton`, degraded alerts appear in many local page implementations. | Failure modes may read as normal empty state or feel inconsistent. | P2 | Define empty/degraded/permission/source-unavailable templates and apply to list, drawer, center, graph pages. | Static only. |
| Pagination and table density have shared CSS, but route-specific `bordered`/size choices still differ. | `ResourceTable` defaults `bordered=true`; some pages override `bordered={false}` or local tables. | Visual rhythm shifts between resources; compactness varies. | P2 | Decide default list table density and allow explicit exceptions only for nested history/detail tables. | Static only. |
| Mixed Chinese/English Kubernetes labels need typography and truncation review. | Navigation and tables include long labels like `HorizontalPodAutoscaler（水平自动扩缩容）`. | Long labels can crowd sidebar, table cells, buttons, and mobile controls. | P2 | Verify truncation/tooltip rules for sidebar labels, table cells, filter summaries, and drawer titles. | Not mobile-tested. |
| Center page time-range controls and status cards should share one semantic model. | `/observability` and `/aiops` both use monitoring time presets and source/degraded states. | Users may read similar health/incident states differently between centers. | P2 | Share time-range, source-state, severity, and freshness components where practical. | Static only. |
| Graph, terminal, logs, and AI chat are special surfaces with different density. | Topology canvas, xterm terminal, log viewer, AI assistant drawer/chat UI. | These may be visually strong but inconsistent with resource list pages. | P2 | Treat them as Level 4 work surfaces with their own surface contract, then align toolbar/header/status only. | Partial browser loop; no deep interaction test. |

## P3 Nice To Have

| Finding | Evidence | Impact | Priority | Proposed Action | Test Status |
| --- | --- | --- | --- | --- | --- |
| Hover/focus/loading animation timing is not centrally defined. | Inline transitions in topology and action styles; AntD defaults elsewhere. | Minor polish inconsistency. | P3 | Add shared motion timing tokens for hover, drawer, popover, skeleton, and graph controls. | Static only. |
| Overview shortcuts can be more operations-dense. | Overview has shortcut links to topology/workloads/Helm. | Lower information density on large screens. | P3 | Compress shortcuts into a task strip or command cluster once release blockers are closed. | Not tested. |
| Component color palette still leans blue-heavy. | Global tokens and inline styles use many blue/cyan accents. | UI can feel one-note across a long session. | P3 | Introduce restrained non-blue semantic accents only for severity, success, warning, and workload category. | Static only. |

## Cross-Cutting Checklist For 12.2+

- Run all navigation routes in dark and light theme.
- Run desktop and mobile viewport smoke for shell, resource list, detail drawer, YAML drawer, topology, Observability, AIOps, AI assistant, terminal, and logs.
- Capture console errors, page errors, failed requests, and unhandled promise rejections.
- Exercise table flows: global search, filter row, column visibility, sort, pagination, row action menu, detail open, YAML open.
- Exercise drawer flows: open, refresh, relationship navigation, back, error state, close, and narrow viewport.
- Exercise degraded states: no cluster, unauthorized route, source unavailable, empty list, slow API, and failed detail request.
- Exercise keyboard flows: sidebar navigation, toolbar controls, row actions, drawer close/back/refresh, popover filters, modal confirm.

## Minimal Static Verification Commands

```bash
rg -n "path:|/observability|/aiops|/network/topology|/clusters/nodes" frontend/src/config frontend/src/app -g '*.ts' -g '*.tsx'
rg -n "ResourceTable|ResourceDetailDrawer|ResourceYamlDrawer|Drawer|Modal|Filter|Search|Select|Segmented|Tabs" frontend/src -g '*.tsx' -g '*.ts'
rg -n "dark|prefers-color-scheme|--color|background|theme|ConfigProvider|token|colorBg|colorText|border" frontend/src -g '*.css' -g '*.tsx' -g '*.ts'
rg -n "browser|console|route loop|Playwright|responsive|mobile|accessib|UI" docs .codex -g '*.md'
git diff --check -- docs/ops-console-ui-audit.md
```

## Current Status

- Static UI audit: complete for task 12.1 scope.
- Existing browser evidence: useful but partial; do not treat as full-site sign-off.
- Release gate follow-up: tasks 12.2-12.10 should convert this backlog into executable regression evidence and go/no-go decision inputs.
