# Console Baseline and First Fixes

Date: 2026-09-16. Integration branch: codex/console-next. No remote publication or production deployment.

## Verified Scope

- Two independent worktree audits: shared UI and Pod/navigation flows. Reports integrated; clean audit worktrees removed.
- Existing localhost:3000 v1.5 baseline inspected before changes. Rebuilt frontend and control-api now serve the integration worktree on 3000 and 4000. Runtime gateway remains on 4100.
- Browser samples: 12 routes in light/dark at 1440x900, 5 routes at 390x844. All 24 desktop route responses were 200, no observed uncaught page errors; all 29 samples had no document-width overflow. This is representative coverage, not all-route/overlay acceptance.
- Viewed screenshots of homepage, Pod logs/terminal and mobile monitoring. Grafana integration remains unconfigured; no live Grafana acceptance is claimed.
- Frontend stable build and changed-file ESLint pass. Cluster-workspace tests: 15 pass. Navigation and UI-evidence contracts pass.
- Backend build passes. Full suite: 53 suites, 326 tests pass, including 5 new runtime authorization tests.

## Implemented

1. Removed Pod logs and terminal from cluster navigation while preserving operation URLs.
2. Cluster-scoped logs/terminal use a full-page main surface with authentication and cluster context retained.
3. Pod runtime return links preserve namespace, keyword, phase, page and page size. Empty filters are no longer replaced with the selected resource name. Full scroll and arbitrary column-filter restoration remain open.
4. Overview no longer labels absent/stale aggregate data as stable. Counts render proportional bars with shared denominators; count-based pseudo-trend arrows removed.
5. Dashboard refresh uses shared action-button styling; cluster entry points explicitly target overview.
6. Runtime HTTP endpoints check existing cluster read/write permissions and reject forged body user IDs. Log queries/stream bootstrap check cluster access, and stream ownership uses the authenticated actor.

## Remaining Gates

- Cluster authorization fixes are an immediate existing-model safeguard, not the planned namespace/capability model. Add revocation, gateway enforcement and OIDC reconciliation in stage 3.
- UI: sidebar collapsed state, motion policy, duplicate workbench status bars, excessive homepage summary height, common control sizes, form spacing and narrow-column content constraints.
- Pod return state: restore arbitrary column filters and scroll; test actual context return through a populated Pod action menu.
- 1024/1280 widths, keyboard/overlay interaction and real exec/log streaming remain required acceptance tests.
- Independent log center, Keycloak, notification delivery/recovery and backup/restore remain unimplemented.
- Old ui-tech-smoke fixtures reference obsolete routes; new console-baseline script records factual geometry rather than asserting obsolete text. It is a diagnostic baseline, not an end-to-end integration acceptance suite.

## Next Order

Finish shared shell/workbench UI and Pod contextual navigation, then establish additive authorization/data-source contracts before log-center and identity implementation. No release tag until user local acceptance.
