# Console Stage 2 Increment

Date: 2026-09-16. Local integration only; no push/tag/production change.

## Implemented

- Shared platform/cluster sidebar preference, 248px expanded and 72px collapsed, accessible toggle, 180ms transition and reduced-motion override.
- Cluster mobile menu includes all children; single-section selected keys corrected.
- Pod runtime pages keep context and operations, removing redundant signal cards, chips, decorative window chrome and duplicate telemetry. One compact diagnostic footer remains.
- Active terminal explicit return asks for confirmation; browser reload/close warning enabled. SPA history interception is not implemented.
- Additive admin-only log search endpoint with exact cluster/source binding, bounded time/rows/body/transport, server-owned query DSL and sanitized errors.
- Integration review found environment references were too broad. Added a failing regression test, then restricted credentials to KUBENOVA_ES_API_KEY_ variables. This prevents exporting unrelated API-process secrets through a configured source.

## Verification

- Frontend stable production build passed; changed frontend ESLint passed.
- Sidebar/cluster navigation unit tests: 17 passed.
- Backend production build passed; full Jest suite: 55 suites, 368 tests passed. Log-center subset: 42 tests.
- Local frontend replaced on 3000; backend replaced on 4000. Ready health returned ok. Unauthenticated live log-center POST returned 401.
- Browser script console-shell-check.mjs: 19 samples across light/dark, 1440/1280/1024/390 widths. No document horizontal overflow or uncaught page errors. Shared sidebar persistence and widths asserted; reduced-motion computed transition 0s. Full-screen runtime pages have no sidebar and one status strip.
- Screenshots inspected for collapsed sidebar, light terminal and mobile dark logs. Some resource samples show real asynchronous loading: these prove shell layout only, not populated resource-list correctness.
- Worktrees shell-motion, runtime-ui and log-query were integrated and removed after clean-status checks; commits remain recoverable.

## Open Gates

- Entire redesign is not complete. Log-center frontend, collection lifecycle, granular authorization/OIDC/MFA/kubectl, notification delivery and encrypted restore remain pending.
- No live Elasticsearch, Grafana, SMTP or Kubernetes exec integration was exercised in this increment.
- Pod table scroll/arbitrary filter return restoration and active-session SPA history behavior still need implementation.
- Mobile submenu interaction, collapsed popup keyboard navigation and actual active terminal confirm/cancel need behavioral browser tests beyond layout samples.
- Legacy test-file TypeScript configuration errors reported in worker direct tsc checks remain; production build succeeds without changing those tests.
