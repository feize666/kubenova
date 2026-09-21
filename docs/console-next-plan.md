# Console Modernization Execution Plan

Baseline: v1.5 (2c5a2a6). Local validation only on frontend port 3000.
Production publication and deployment require user acceptance of local results.

## Accepted Scope

- Preserve blue/white and dark themes; normalize controls, motion, responsive tables and filters.
- Pod container logs and terminal are full-page contextual operations, not navigation entries.
- Cluster log center includes query, collection configuration and log alert rules.
- Existing Elasticsearch/Kibana preferred; optional Fluent Bit Helm and single-host stack.
- Authorization owns Keycloak/OIDC, groups, MFA and cluster/namespace grants. Only superadmins grant rights.
- MFA optional, administered only by superadmins; users enroll their own authenticators.
- Personal kubeconfig download opt-in; short-lived OIDC credentials over VPN via a revocation-aware gateway. Direct API access cannot meet the accepted immediate-termination requirement.
- Four preset roles; sensitive capabilities explicit. No automatic grants to future clusters.
- Monitoring owns cluster notification channels, delivery records and recovery notifications.
- Settings contains updates, AI configuration, backup/restore.
- Encrypted offsite OSS/S3 backups, 7 daily and 4 weekly copies; logs excluded by default.

## Stages and Gates

1. Baseline audit: route/component inventory, screenshot evidence, permission and deployment gaps.
2. UI/navigation: shared controls, responsive behavior, full-page Pod actions and return context. Gate: route tests, lint/build, light/dark screenshots.
3. Identity: additive schema, OIDC login, grants and Kubernetes reconciliation, MFA administration. Gate: cross-namespace denial, revoked sessions, native kubectl checks on supported clusters.
4. Logs: bounded scoped search, collection Helm lifecycle, retention settings. Gate: real collection/query, isolation, preview and rollback.
5. Monitoring: Grafana, log evaluation and cluster notification channels. Gate: trigger/recovery, duplicate suppression, retry and expired delivery behavior.
6. Operations: optional Compose profiles, resources, backup/restore. Gate: restore rehearsal, limits and upgrade rollback.
7. Local acceptance: build/test suites, browser responsive matrix, screenshots and explicit external integration gaps.

## Parallel Ownership

Root owns integration, migration ordering, shared interfaces, browser evidence and this plan.
Each active feature worker uses its own worktree and commits only its assigned files.
Initial independent tracks: UI audit; navigation/Pod-action audit. Identity/logs interface review follows.
No worker publishes, deploys remotely or changes user clusters during an audit.
Integrate only after scoped review and checks, then remove clean owned worktrees.

## Risks and Rollback

- API Server OIDC/issuer reachability varies by provider; expose unsupported state rather than claim support.
- Existing kubectl streams cannot be forcibly closed through RBAC changes alone.
- Workload creation can escalate via ServiceAccounts/privileged Pods; presets require explicit security boundaries.
- Kibana access requires verified data isolation; ordinary users have native scoped search until then.
- Single host is not HA. ES/Grafana/Keycloak require measured memory/disk budgets.
- Use additive migrations and feature gates; keep audited local-admin recovery during identity migration.
- Back up DB/config before migration. Do not force-reset existing branches or overwrite prior data.

## Progress

### 2026-09-20 Current Local State (Supersedes Earlier Checkpoints)

- Backend full regression: 129 suites, 1342 passing tests, 4 skipped before the
  latest runtime expiry correction. That correction passes 33 runtime tests.
- Event-driven runtime revocation is implemented and enabled locally: migration,
  PostgreSQL LISTEN, Nest watch and Go consumer. Isolated DB-to-WebSocket and idle
  upstream cancellation passed. Real user/cluster stream acceptance is pending.
- Native personal access now has an opt-in configuration table/admin API,
  read-only GET gateway, scoped authorization, RBAC planning/sync/readiness and
  TLS transport. No clusters are enabled. Discovery, exec, admission-protected
  writes, reconciliation orchestration, PKCE and actual kubectl remain unfinished.
- Effective group grants include membership expiry. Runtime validation now caps
  the stream deadline by live grant and stored session expiry, not only token
  expiry. A deadline shortened during lease opening fails closed.
- loop-read's live namespace/grant/dashboard check passes, but no unexpired login
  session exists for the requested real browser acceptance. No sessions forged.
- Logs, monitoring, UI and offsite backup gates below remain open. The native
  access work does not certify those workflows. Production has not been changed.

### 2026-09-21 Runtime and Navigation Increment

- Runtime push-revocation is now enabled by default in the local, Docker,
  Kubernetes and systemd environment templates. Gateway tests pass with
  fail-closed status enforcement; production deployment remains pending
  acceptance.
- Removed standalone log-query and terminal shortcuts from the overview;
  Pod-level actions remain the entry point for container logs and terminal,
  while the cluster-level entry remains the separate Log Center.
- Notification delivery now has explicit opt-in and SMTP wiring in the local,
  Docker, Kubernetes and systemd environment templates. Delivery remains off by
  default; channel lifecycle tests pass without sending external messages.

### 2026-09-20 Integration Checkpoint

- Fresh complete backend regression: 120 suites passed, 1312 tests passed and
  4 skipped. Local port-3000 login returned HTTP 200. This does not prove actual
  loop-read password login, external collection or native kubectl access.
- Native bearer verification, live account binding, request classification and
  namespace/capability authorization helpers are integrated and tested, but have
  no exposed gateway route. Transactional PostgreSQL notification migration is
  verified in an isolated schema only. Running console streams still use
  five-second status polling; immediate revocation is not implemented.
- Log-center preview now includes constrained Filebeat deployment manifests and
  optional CA Secret. Official Filebeat TLS fixture checks passed. Real Kubernetes
  collection, Helm lifecycle and Elasticsearch ingestion remain unaccepted.
- Real PostgreSQL + Restic local encrypted streaming recovery passed for both
  application/identity-shaped fixtures. Explicit configuration backup and isolated
  configuration restore added; actual Restic fixture recovery passed. A daily
  systemd backup service/timer is supplied but not installed or Linux-validated.
- Offsite S3, full production schema/startup/decryption recovery, backup status UI
  and failure notification still need delivery. These must not be inferred from
  fixture recovery or command-double tests. Runtime frontend remains on 3000;
  nothing is published or deployed to production.

Next priority: complete event-driven gateway invalidation and real native
transport, then remaining external integration and full-site user acceptance.
Keep all stage gates below open until their actual end-to-end evidence exists.

### 2026-09-19 Scope Reconciliation

- Subsequent backup increments: `a68345f` adds independent Keycloak archive/tag
  selection and retention; `b15a7d8` adds guarded identity restore/readback.
  Feature-only patches integrated, baseline snapshots excluded. Backup guards,
  restore guards and the actual shell/Node pipeline with external-tool doubles
  pass locally. Owned temporary worktrees removed. No live offsite upload or
  Keycloak recovery was performed; these remain stage 6 gates.

- Rechecked the real kubeconfig export: administrator-only ServiceAccount token,
  not personal OIDC. Added `native-access-delivery-plan.md` with readiness, pure
  RBAC planning, owned reconciliation, download and real kubectl acceptance gates.
  Direct native streams cannot promise immediate termination via RBAC deletion;
  this remains an explicit gate, not a reduced revocation requirement.
- Rechecked backup scripts: only the application DB is uploaded. Keycloak DB,
  encryption keys, deployment configuration, offsite transfer/restore and backup
  settings remain incomplete. Existing local dump restore is not disaster
  recovery acceptance. Keep stage 6 open.
- Corrected stale Keycloak documentation about unimplemented MFA routes; routes
  now exist but no real superadministrator is designated and actual reset login
  acceptance is still open. No real account or cluster was changed.
- Current loop-read session check reports no unexpired session. Read-only actual
  grant/dashboard verification passes and port-3000 login returns 200. These do
  not substitute for renewed real-account browser acceptance.
- A new bounded read-only audit agent could not start (agent thread limit).
  Root completed the source audit; no agent or worktree reclamation is claimed.

### 2026-09-18 Alert Lifecycle Prerequisite

Code tracing found no alert ingest/upsert path, only manual resolution. The
resolution endpoint also lacked actor/cluster authorization. Added shared service
write-role checking plus permission against the persisted alert's cluster (not a
client scope), with platform-admin restriction for null/orphaned cluster alerts.
The controller forwards the authenticated identity. Five regressions reproduced
the missing checks before the fix; ten focused monitoring tests and backend build
pass afterward. This is a necessary security prerequisite, not delivery lifecycle
completion. The next lifecycle slice must add authenticated per-cluster ingest,
idempotent firing/resolved transitions and transactionally persisted delivery
outbox before implementing retry/recovery dispatch. Fine-grained authorization
enablement remains gated; current checks reuse the existing cluster access model.

### Active Stage 5 Slice: Cluster Notification Ownership

- Backend worker: additive nullable cluster ownership for notification templates;
  exact-scope listing, immutable ownership, controller authorization for every
  CRUD/test route. Keep configuration and endpoints admin-only in this slice,
  preserving existing write authority; do not expose webhook credentials to
  viewers. Existing null-cluster templates remain platform-owned.
- Frontend worker: requests and query keys include the route cluster; create
  submits clusterId; update/delete/test carry expected cluster scope. Reuse the
  current controls. Reset open editors on cluster changes so stale dialogs cannot
  submit against another cluster.
- Root integration: independent worker worktrees, review diffs, run scoped tests,
  additive local migration, local build/HTTP/browser validation on port 3000.
- Contract: list/create use clusterId query/body respectively; update/delete/test
  carry optional clusterId query as expected scope (omitted means platform scope).
  No movement of templates between scopes. Cross-scope access returns not found.
- Gates: platform list excludes cluster entries; cluster A excludes platform/B;
  ordinary users denied; cross-scope writes/test do not mutate or send requests;
  frontend cache and payload remain scoped when switching clusters.
- Delivered locally: nullable scope migration applied after a restricted local
  pg_dump backup; old records retain null platform ownership. API/UI worktree
  changes integrated, 61 focused backend tests and 598 full-suite tests pass;
  real PostgreSQL isolation/version/cascade test passes with rolled-back fixtures.
  Four frontend request tests pass. Port-3000 browser regression proves exact
  A/B listing, cache separation, stale editor reset and scoped creation using
  mocked APIs. Backend and frontend builds pass; readiness is healthy.
  Frontend PID 55908 serves `.next-validation/standalone`; build future candidates
  into `.next-candidate`, not the active output. Backend PID 55920.
  Both temporary worker worktrees removed after integration, branches preserved.
  Only the backend was delegated; root implemented the UI in its independent
  worktree. The completed agent has no running task; no close-agent API is exposed.
- Rollback: preserve old null-owned data and additive column; revert application
  code only if needed. No remote release. Delivery lifecycle, SMTP and recovery
  remain later dependent slices, not claimed complete by these checks.

- [x] Stage 1 initial code audit and representative browser baseline (see console-stage1-results.md)
- [ ] Stage 2 UI/navigation
- [ ] Stage 3 identity
- [ ] Stage 4 logs
- [ ] Stage 5 monitoring
- [ ] Stage 6 operations
- [ ] Stage 7 local acceptance

Initial stage 2 fixes are implemented and tested; stage 2 is not complete. Remaining gates are recorded in console-stage1-results.md.

Second increment: persistent shell collapse, simplified full-screen workbenches and admin-only log query foundation are integrated. See console-stage2-batch.md for ownership/contracts and console-stage2-results.md for actual verification and unresolved gates. Stage 2 and stage 4 remain incomplete.

Current verification increment (2026-09-18): backend build and full Jest suite pass
(`88` suites, `696` tests). This confirms regression safety for the current source,
not completion of the roadmap. MFA enrollment/login challenge, full log-center
acceptance, fine-grained enforcement, scheduler opt-in and encrypted restore
rehearsal remain open.
