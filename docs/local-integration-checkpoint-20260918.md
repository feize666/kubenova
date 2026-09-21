# Local Integration Checkpoint

This is partial acceptance, not a release or completion claim.

## Email Lifecycle Acceptance (2026-09-20)

Follow-up: the same test now posts through the actual Nest
AlertIngestionController over HTTP, rather than directly calling ingestion.
Invalid bearer credentials return 401 and malformed status returns 400 with no
alert rows created. Valid firing/recovery each traverse the actual database,
worker and TLS SMTP receiver once despite duplicate HTTP submissions. Fresh run
passed and test fixtures were cleaned. The server is an isolated Nest instance,
not the deployed port-3000 proxy; no actual Alertmanager binary was exercised.

- `test/notification-email-lifecycle.cjs` now passes the continuous local chain:
  authenticated ingestion service, real PostgreSQL alert/outbox, concurrent
  workers and actual TLS SMTP receiver. Duplicate firing/resolved submissions
  produce exactly one alert email and one recovery email, both marked sent.
  MIME-encoded subjects are checked against explicit alert/recovery titles.
- Fixed the test's RFC header unfolding: remove CRLF but preserve continuation
  whitespace. No production transport code change was required.
- Random disabled test cluster, alerts, channel, receiver credential and audit
  records are cleaned by the test. Local certificate fixtures and the temporary
  SMTP dependency installation were removed. No real recipient was contacted.
- This is service-to-SMTP acceptance, not a real Alertmanager HTTP webhook or
  production mail-provider acceptance. Notifications remain disabled globally.

## Notification Transport Revalidation (2026-09-19)

- Re-ran `test/notification-worker-postgres.cjs`: actual local HTTP/PostgreSQL
  claim and concurrent suppression, firing/recovery payloads, 503 backoff,
  lease recovery, expired delivery, disabled channel and unsolicited-recovery
  suppression pass. Random test cluster/alerts cleaned by the script; no real
  cluster configuration was changed.
- Re-ran `test/notification-email-timeout.cjs`: an actual slow/trickling SMTP
  peer connection closes at the bounded deadline.
- Re-ran `test/notification-email-smtp.cjs` using an isolated smtp-server install:
  actual TLS and STARTTLS, envelope/body, rejected recipient and untrusted
  certificate denial pass. Certificate fixtures and temporary dependency install
  removed after execution. All network destinations were loopback test servers.
- This verifies transports and queue behavior separately, not email recovery
  through the entire ingestion/worker/SMTP chain or a production mail provider.
  External notifications remain disabled; no production rollout or publication.

## Helm Privileged Boundary (2026-09-19)

- Collection-lifecycle audit found direct Helm routes lacked scoped read checks
  and accepted old operator writes while using saved cluster credentials. All
  18 routes now reuse the existing platform-administration permission check.
  Raw values/manifests and arbitrary chart installation are not safe namespace
  reader features. No capability was added to loop-read.
- 18 denial tests failed before the change; 36 deny/admin-forwarding tests pass
  afterward and Nest build passes. Resource detail's separate Helm adapter was
  inspected: it exposes a scoped summary, not raw values/manifests. No Helm
  command or real cluster mutation was executed during these checks.
- Feature committed in independent worktree and integrated; owned worktree
  removed. API restarted locally; frontend remains 29526 on 3000. This closes
  a prerequisite security defect, not Fluent Bit lifecycle implementation.

## Latest Log Resource Filters (2026-09-19)

- Integrated feature 87a0a6d only, not its baseline snapshot. Pod/container exact
  filters are wired from existing-theme inputs to bounded Elasticsearch terms;
  mandatory scope filters remain in place. The positive test failed before the
  change, then all 69 log-center tests and backend/frontend builds passed.
- Port 3000 browser check passed with intercepted APIs: submitted filters,
  result/reset/error/denial states, light/dark at 1440/1024/390, no page errors or
  horizontal overflow. Desktop light and mobile dark screenshots reviewed.
  This is not real Elasticsearch or collection-lifecycle acceptance.
- API PID 29525 serves current build on 4000; frontend PID 29526 serves
  `.next-validation/standalone` on 3000. Next build uses `.next-candidate`.
  Notifications disabled; no superadministrator designated. Owned feature
  worktree removed; screenshot artifacts cleaned after review. No publication.

## Latest MFA Reset UI and Local Runtime (2026-09-19)

- UI feature `9bfbf30` integrated (not prerequisite snapshot `eb68f9a`):
  server-gated user action, two-step password/factor or OIDC reset, memory-only
  proof and expiry handling. Production Next build/TypeScript passed.
- `frontend/scripts/mfa-reset-check.mjs` passed mocked password and OIDC flows on
  desktop/mobile, explicit confirmation, storage checks and no page exceptions.
  Reviewed mobile screenshot; repaired shared primary danger-button colors.
  Screenshots removed after inspection; isolated UI worktree removed.
- API PID 13146 now runs the current build on 4000; frontend PID 12588 serves
  `.next-candidate/standalone` on 3000. Next frontend build must use inactive
  `.next-validation`. Notifications remain disabled and SUPERADMIN_USER_ID unset.
- Fresh backend run: 137 tests passed, one optional Redis test skipped. Earlier
  explicitly enabled Redis/real PostgreSQL HTTP acceptance also passed. A request
  through 3000 to reset/prepare without a session returns 401, not 404/500.
- Real account reset was not attempted. Actual OIDC-provider-to-reset-browser
  acceptance, negative UI scenarios and loop-read relogin acceptance remain open.

### Reset UI Denial Regression

- Extended and freshly ran `frontend/scripts/mfa-reset-check.mjs` on 3000:
  missing management capability, rejected password, expired proof and mixed
  enrollment/reset callback purposes do not issue reset confirmation. Existing
  password/OIDC success scenarios still pass. APIs are fully intercepted; this
  does not count as a live-user or real-provider browser test.
- Temporary desktop/mobile screenshots from this rerun were removed. Negative
  UI scenarios listed above are now covered; actual provider/browser handoff and
  loop-read login acceptance remain open.

## Latest MFA Reset OIDC Boundary (2026-09-19)

- Integrated action-bound OIDC reauthentication context (`17f35ca`). Reset
  transactions carry an explicit purpose and target/version snapshot; enrollment
  and reset callbacks cannot be exchanged for one another.
- Focused integrated OIDC tests passed (3 suites, 41 tests) and the Nest
  production build passed. The underlying reset store/repository also passed
  real Redis/PostgreSQL rollback and concurrency checks.
- Public MFA reset routes remain disabled. Password step-up, MFA factor step-up,
  controller/UI wiring, and real loop-read browser acceptance remain incomplete.

## Latest Superadministrator Lockout Guard (2026-09-19)

- Integrated feature 36d404c, not baseline 393cd38. The shared last-administrator
  guard now protects SUPERADMIN_USER_ID from deletion/deactivation even when
  ordinary administrators remain. Existing profile maintenance remains available.
- Real PostgreSQL owner self-removal test observed RED then passed after build;
  all fixture transactions rolled back. Main reran 42 authority tests and build.
- API PID 31094 now serves this source; frontend remains PID 13842 on 3000.
  No real designation/account change; notification delivery remains disabled.
  Through port 3000, unauthenticated MFA status correctly returns 401.
- Feature worktree/dependency link removed. Next reset implementation contract:
  docs/mfa-reset-delivery-plan.md. Reset endpoint remains unavailable.

## Latest Superadministrator and Provider Acceptance (2026-09-19)

- Integrated 40e5045 explicit deployment-owned SUPERADMIN_USER_ID boundary and
  protected-account mutation guards; no real designation was configured. MFA
  reset remains fail-closed pending action-bound reauthentication and atomic reset.
- 59 focused tests, full 110 suites / 1068 passed / 3 skipped, build and real
  PostgreSQL rollback-only identity/protected-account checks pass.
- Extended test/keycloak-provider.cjs against actual Keycloak 26.7.4: existing SSO
  cookie still requires explicit password entry, signed fresh auth_time and exact
  subject are accepted, and reauthentication replay is rejected. Existing binding,
  platform session and unbind revocation checks also pass. Not a full console HTTP
  enrollment end-to-end test. Test provider stopped; import directory empty and
  port 18080 closed afterward. No real user was changed.
- API PID 24058 now runs integration source; notifications disabled. Frontend
  remains PID 13842 on 3000, candidate output; next build uses `.next-validation`.
  Worktree and dependency symlink removed; feature commit retained.

## Latest Personal MFA Frontend Acceptance (2026-09-19)

- Integrated b79dbc9 feature only; independent baseline 3195cc4 was not merged.
  Personal Center is reachable from the avatar. System settings remain unchanged.
- Mocked browser enrollment, recovery memory/storage isolation, delayed refresh,
  second-tab storage events, OIDC callback and prepare navigation, failure paths
  and 390px dark layout passed. Existing MFA login/OIDC challenge regression passed.
  Isolated real backend MFA HTTP/PostgreSQL/Redis passed; actual Keycloak browser
  and real-user enrollment remain unverified. No real user was changed.
- Fixed the shared mobile breadcrumb minimum-width override found during testing.
  Build passed. Frontend PID 13842 serves `.next-candidate/standalone` on 3000;
  next build uses inactive `.next-validation`. API PID 86934 remains unchanged.
- Full backend regression: 110 suites, 1045 passed, 3 skipped. Feature worktree
  and dependency symlink removed after integration; feature commit remains.
- See mfa-personal-center-plan.md. Superadministrator policy/reset is still
  incomplete; do not describe the entire access-control goal as complete.

## Latest OIDC Enrollment Handoff Acceptance

- 6d928bf integrated guarded OIDC enrollment prepare/exchange routes with a
  separate HttpOnly binding cookie, server-derived subject/session/authz version,
  one-use transaction and no login issuance. Build and auth suites passed.
- Expanded isolated PostgreSQL/Redis HTTP test passed: origin and missing bearer
  denial, pending handoff, no session count increase, and mid-exchange revocation
  preventing credential creation. Provider cryptography remains covered by the
  separate signed-provider integration test; HTTP handoff doubles only the
  external provider and never touches real users.
- API PID 86934 locally restarted with notification delivery disabled. Frontend
  remains on 3000. No MFA state changed in production DB.
- OIDC enrollment UI entry and real external IdP browser callback remain open;
  route is not exposed through the general login page yet.

## Latest Monitoring and AIOps Runtime

- e19a9d5 monitoring and 8167fcc AIOps integrated preserving dirty baseline;
  monitoring patch applied relative to its baseline after cherry-pick refused
  existing modifications. No baseline commits or unrelated files overwritten.
- Nest build, 17 focused suites/194 tests and full 108 suites/1029 tests passed
  (3 optional skips). Real read-only monitoring-scope-local.cjs passed scoped
  alerts, inspection, observability summary, AIOps summary, forged precheck denial,
  unavailable global metrics and Grafana denial using actual grants/live UID.
- API PID 72983 now runs fixes; notification delivery disabled. Port 3000 proxy
  denies unauthenticated overview with 401. Frontend remains PID 69622 on active
  .next-candidate; next frontend build must use .next-validation.
- Two committed worktrees and three dependency/source symlinks removed; original
  targets untouched, source preserved in commits and integration tree.
- Actual password-entry/browser authorization and external monitoring acceptance
  remain unverified; no real alert resolution, approval or cluster write performed.

## Latest Frontend Monitoring Null-state Acceptance

- Integrated 9589dc9: nullable monitoring contracts, neutral -- for unavailable
  health score, no numeric suffix; genuine zero remains 0 / 100.
- Production frontend build passed. Browser regression on old runtime reproduced
  0 instead of --; after local switch test passed both null/zero with mocked APIs
  and no page errors. Script: frontend/scripts/monitoring-unavailable-check.mjs.
- Frontend PID 69622 on 3000 now uses .next-candidate/standalone. Next build must
  use inactive .next-validation. Committed UI worktree removed.
- API remains PID 49856; monitoring/AIOps authorization patches are NOT yet
  integrated or deployed. This is UI contract acceptance, not live monitoring.

## September 19 Topology and Multi-cluster Integration

- Integrated 51725d3 and 1dd3460 without committing unrelated work. Corrected
  topology SQL helper overloads with narrow structural filter types after the
  integrated compiler exposed 17 incompatible Prisma predicate errors.
- Build passed; 107 backend suites, 1009 passed, 3 optional skips.
- Real DB/effective-grant/live-UID checks passed for topology summary/v1/v2 and
  multi-cluster workload/network/config/storage queries. Summary RED (9 buckets,
  8 unauthorized) is now GREEN (ai only). No sessions or records created.
- Local API PID 49856 includes both fixes; notifications disabled. Frontend stays
  on 3000, unauthenticated topology request returns 401. Real loop-read HTTP
  acceptance awaits a new login; expired session was not recreated.
- Both committed worktrees and dependency symlinks removed; source commits and
  integrated fixes preserved. Monitoring access, MFA UI/management, real OIDC/
  kubectl, external notifications and offsite acceptance remain unfinished.

## Latest Runtime After Config Grants

- API PID 25570 on 4000 includes config namespace/Secret grant enforcement;
  notification delivery remains disabled. Frontend unchanged on 3000.
- Backend build and 105 suites passed: 972 tests, 3 optional skips.
- Config DB/live-UID and existing loop-read session HTTP checks passed. HTTP test
  reproduced old 396-row leak before restart, then verified authorized count 1
  and denied Secret detail/revisions/diff after restart.
- Config worktree removed after committed patch integration; see
  config-grant-plan.md. Broader goal remains incomplete.

## Latest Existing loop-read Session Acceptance

- Fresh `test/loop-read-access.cjs` passed through the actual port 3000 HTTP
  proxy with the account's existing unexpired session. No password reset or
  fabricated session: this supersedes the earlier expired-session blocker.
- Verified exactly vke-test is visible, only ai namespace is listed, workload
  lists/detail/drawer/dynamic ReplicaSet detail/YAML are accessible; foreign
  namespace/cluster/direct-ID access, Secret/Node reads, logs and out-of-scope
  terminal are denied. No actual shell was opened.
- Fresh dashboard and network/storage read-only DB/live-UID checks passed;
  `/login` returned HTTP 200. Browser visual acceptance is still unavailable:
  native Mac locked and browser tool authentication unsupported. Existing-session
  API acceptance does not prove the password-entry/login UI flow.
- Config/Secret scope hardening is now integrated and verified as recorded above.

## Latest Runtime After Network/Storage Grants

- API PID 7899 on 4000 includes scoped network and storage services; automatic
  notification delivery remains disabled.
- Frontend unchanged: PID 91624, port 3000, `.next-validation/standalone`.
- Backend build and 104 suites passed: 929 tests, 3 optional skips. Real DB/live
  UID read-only scope check passed; no actual login or mutation acceptance.
- Next frontend build must use inactive `.next-candidate`.
- See network-storage-grant-plan.md for exact evidence and remaining gaps.

## Latest Runtime After Dashboard Grants

- Frontend PID 91624, `.next-validation/standalone`, port 3000; next build uses
  inactive `.next-candidate`.
- API PID 91639, port 4000, includes dashboard namespace grants; notification
  delivery disabled.
- 102 backend suites / 888 passed / 3 skipped; six metric UI tests; both builds
  passed. Mocked browser unavailable-metric rendering passed after reproducing
  the old runtime bug. Real loop-read service/DB/live-UID scope validation passed
  without creating sessions. Actual login remains unverified.
- Details and remaining boundary: dashboard-grant-plan.md.

## Current Runtime (Updated After Log Grant Integration)

- Frontend now PID 71698, `.next-candidate/standalone`, port 3000.
- API now PID 72361, port 4000, includes current MFA/OIDC and log-grant source.
- Next frontend build must use inactive `.next-validation`; never rebuild active
  `.next-candidate`. Notification delivery remains disabled.
- Fresh backend regression: 102 suites, 883 passed, 3 skipped. Log reader browser
  check: 11 mocked states, 7 queries, no page errors. See log-center-grant-plan.md.

## Previous Runtime

- Frontend: port 3000, PID 49486, `.next-validation/standalone`.
- Control API: port 4000, PID 36467, predates the latest MFA/OIDC source work.
- Build subsequent frontend candidates in inactive `.next-candidate`, never in
  the serving directory. Copy static/public assets before switching processes.
- Automatic external notification dispatch remains disabled.

## Fresh Evidence

- Full backend regression: 101 suites, 864 passed, 3 optional integration skips.
- MFA HTTP regression separately exercises actual PostgreSQL and Redis with
  isolated fixture schemas; login, recovery, enrollment transaction rollback,
  current-user status, session revocation and refresh rotation pass.
- OIDC provider integration verifies signed tokens and purpose/session/subject
  isolation against a local provider, not a real Keycloak deployment.
- Frontend shell: 19 mocked-API browser scenarios, no page errors; reduced motion,
  sidebars, runtime fullscreen layout and responsive widths pass.
- Dashboard browser regression: malformed response produces recoverable error;
  normal mandatory counts render. Optional payload validation is not exhaustive.
- Log center browser regression covers seven states and light/dark responsive
  layouts. No live Elasticsearch was used.
- Notifications: local HTTP/database worker and mocked browser configuration tests
  pass. No external email or Webhook was sent.
- A pre-MFA archive was restored into a disposable PostgreSQL database, counts
  inspected and database removed. Offsite encryption/transfer is not verified.

## Required Remaining Work

1. Finish personal MFA UI, recovery-code handoff and OIDC reauthentication
   controller integration; define explicit superadministrator management authority.
2. Integrate namespace grants across network/storage/configuration, dashboard
   aggregates and log-center metadata/query paths without widening access.
3. Validate real loop-read login/workspace operation with its actual credentials;
   no password reset or fabricated real-user session is permitted.
4. Complete actual Keycloak/kubectl authentication and Kubernetes authorization
   reconciliation acceptance, including revocation.
5. Validate real log-source and Grafana integration, Pod streams and terminal,
   notification lifecycle with approved external receivers.
6. Configure and verify encrypted offsite backups, restore/login acceptance,
   protected key/config/Keycloak backup, scheduling and failure notifications.
7. Update local services only after relevant gates, repeat integrated browser
   acceptance on 3000 and obtain user acceptance before any release/deployment.
