# Authorization Integration Status

## 2026-09-17 Account Editing Boundary

Ordinary user editing no longer displays or submits a role. The shared backend
update method rejects every supplied role before any writes, including valid
administrator roles and mixed profile/role payloads. Creation remains ordinary-user
only. Dedicated privileged role assignment is still pending, as are working MFA
enrollment, assurance, recovery and administrator policy controls.

Verification: three new role-edit regression cases failed before the fix; all 25
authority tests pass afterward. Frontend TypeScript checking and backend build
pass. This source increment has not been rebuilt into the frontend served on
port 3000 or loaded into the running backend; no browser acceptance or production
release is claimed.

Local delivery follow-up: the frontend candidate build passed and is now served
from `frontend/.next-candidate/standalone` on port 3000 (PID 31163). Future builds
must use a different output directory while this process is active. The backend
was restarted locally with the existing development configuration (PID 32044).
Readiness is ok and the login page returns HTTP 200. The full backend suite passes
77 suites / 569 tests. The browser regression first failed against the previous
served editor, then passed against this build: no role selector and the saved
payload contains only the username. Identity binding/removal regression still
passes. These browser flows use mocked API responses. A separate live HTTP check
through port 3000 logged in and confirmed role-edit rejection (400) against a
nonexistent target, without modifying any user. Screenshot evidence is
`frontend/output/playwright/user-profile-editor.png`. MFA and dedicated platform
role assignment remain incomplete; there has been no production deployment.

## Verified locally

PostgreSQL transaction smoke test, 2026-09-17, database `127.0.0.1:5432/k8s_aiops`:

- Created isolated administrator, member and cluster fixtures.
- Created a local identity group with an audit record.
- Added the member, incrementing their authorization version.
- Created a namespaced group grant for the logs capability.
- Evaluated the grant against the real database and confirmed access.
- Listed the grant and verified its group principal.
- Revoked the grant and confirmed subsequent authorization was denied.
- Verified the member authorization version was 4 after membership, grant creation and revocation.
- Verified four audit entries existed before member removal.
- Removed the member and verified the historical membership remained disabled.
- Rolled back the entire outer transaction, including all fixtures.

This exercised compiled UsersService and AuthorizationService against real Prisma/PostgreSQL queries. Nested service transactions were bound to the outer rollback transaction. Kubernetes namespace UID resolution was stubbed with a fixed test UID; no live Kubernetes API was contacted.

## Additional verification, 2026-09-17

- Account directory list/detail now require platform administration permission in the shared service and both controller aliases forward the authenticated actor. PostgreSQL integration verifies administrator reads, ordinary-user 403 responses, and omission of password hashes, external identities and sessions from response objects. Fixtures roll back.

- Users module: 11 suites / 82 tests passing.
- Backend build and PostgreSQL lifecycle test pass after rejecting grants for missing or soft-deleted clusters.
- Injected audit-write failure rolls back the grant and authorization version in PostgreSQL.
- Account creation rejects administrator roles; the frontend creation form no longer offers role selection.
- Frontend production build passed in the inactive `.next-validation` directory and was switched to local port 3000. The previous `.next-candidate` output remains available for rollback.
- Backend runtime has not yet been restarted for these latest validation changes.

## Not yet proven

- HTTP route authentication and controller integration with the refreshed backend process.
- Browser creation, membership and revocation workflows on port 3000.
- Live namespace UID resolution during grant creation.
- Real concurrent writer behavior (injected audit failure rollback is verified).
- Immediate termination of existing terminal/log streams after revocation.
- Keycloak login, MFA, kubectl access and Kubernetes RBAC reconciliation.

The fine-grained authorization enforcement flag must remain disabled until the documented enablement gates pass. This report does not constitute overall acceptance or production release approval.

## OIDC foundation and regression checkpoint

Verified on 2026-09-17:

- Full backend regression: 73 suites, 501 tests passing before the additional six transaction failure cases.
- OIDC transaction store: nine focused tests passing, including unavailable storage, malformed records, missing state and browser binding, single use and expiration configuration.
- Real loopback Redis: two simultaneous consumers of one transaction produce exactly one success; a different browser binding cannot consume it.
- Authorization initiation service persists nonce and PKCE verifier server-side, returning only the authorization URL. The verifier is not placed in the URL; its S256 challenge is tested against the persisted value.
- URL checks reject non-HTTPS remote endpoints, embedded credentials and fragments. HTTP is permitted only for loopback development hosts.
- PostgreSQL integration rejects grants to a soft-deleted cluster without creating audit entries or changing user authorization versions.

Subsequent implementation:

- Added the ExternalIdentity schema and applied its migration locally. Resolution uses the unique issuer/subject pair, denies unbound or inactive users, and does not link by email. Binding administration remains unfinished.
- Added OidcProviderService using installed openid-client for discovery, authorization-code exchange, nonce/state/PKCE checks and explicit signature verification via enableNonRepudiationChecks.
- `node test/oidc-provider.cjs` passes against a loopback test issuer and real Redis: valid signed tokens succeed; wrong nonce, audience, signature, expired tokens and replay fail. The test issuer is not Keycloak and does not prove Keycloak interoperability or MFA.
- Auth unit tests: 5 suites / 33 tests passing. Backend build passes.

Further integration:

- Added disabled-by-default `/api/auth/oidc/start` and `/api/auth/oidc/callback` routes, HttpOnly/SameSite browser binding, callback cookie clearing, no-store responses and a fixed configured callback origin.
- `node test/oidc-http.cjs` verifies real Nest/Express HTTP routing, redirect and cookie headers, disabled 404, missing-binding 401 and successful JSON session response. Provider and session services are test doubles in this HTTP test; it does not prove browser SSO end to end.
- External login reuses AuthService session issuance with local role and authorization version. PostgreSQL integration proves a bound external user can create and validate a session, authorization-version changes invalidate access/refresh, and disabled users cannot log in.
- Fixed environment boolean parsing so the string `OIDC_ENABLED=false` does not enable OIDC.

Browser handoff checkpoint:

- Added public `/login/oidc` page and same-origin POST `/api/auth/oidc/exchange`. The server checks Origin and configured callback origin/path before transaction consumption.
- The page removes authorization parameters from browser history, exchanges once, persists the session with existing sessionStorage behavior (not remember-me), and navigates to the platform home. Failure returns a login retry screen.
- Frontend production build passed and was switched to port 3000 from `.next-candidate` (PID 70954 at verification time).
- Latest backend build is running on local port 4000 from the current worktree (foreground verification PID 79146); `/api/v1/auth/oidc/start` correctly returns 404 while `OIDC_ENABLED` is false.
- `node scripts/oidc-callback-check.mjs` passes in Chromium with a mocked exchange response. It proves browser handoff and persistence, not a live provider-to-platform login. The running backend is still the earlier process and has not loaded these new routes.

The enabled-provider login button is now implemented and browser-tested with mocked provider status. Still missing: binding administration, backend runtime refresh and full Keycloak/MFA end-to-end tests. The complete SSO workflow is not accepted yet.

MFA policy checkpoint:

Safety correction: the policy mutation now returns 503 after administrator and payload validation, without writing any state. The earlier writable flag did not enforce a login challenge and must not be presented as effective MFA. Enrollment and challenge enforcement must land before reopening this endpoint. The authority regression test proves no mutation for either enable or disable requests.

The PostgreSQL identity integration also toggles MFA on an isolated fixture and verifies that existing access, refresh and external login are denied without issuing another session. Fixtures are rolled back. The user UI now labels a true flag as waiting for verification integration rather than claiming protection is active. These safeguards are temporary, not MFA acceptance.

- Added `User.mfaEnabled` with a local migration and `PATCH /api/users/:id/mfa`.
- Policy changes are currently unavailable: the endpoint checks administrator authority and payload shape, then returns 503 without mutation. No successful policy change or corresponding audit event is claimed.
- This field is a policy/status foundation only. TOTP/WebAuthn enrollment, recovery codes, login challenge, forced reset, and frontend status controls remain pending.
- User list/detail responses now include the persisted MFA policy status so the console can present it separately from cluster roles and grants.

## Consolidated Regression Checkpoint (2026-09-17)

Current source was rebuilt with `npm run build --silent` (exit 0). The previously started full backend regression finished successfully: 75 suites, 553 tests. The following integration commands were then rerun against the rebuilt source:

| Check | Result | Evidence boundary |
| --- | --- | --- |
| `node test/authorization-postgres.cjs` | PASS | Real PostgreSQL transactions: grant lifecycle, inherited access, revocation, audit rollback, deleted-cluster rejection, external identity and session invalidation. Fixtures roll back; Kubernetes namespace resolution is stubbed. |
| `node test/oidc-provider.cjs` | PASS | Real Redis and openid-client with a local test issuer: PKCE, nonce, audience, signature, expiry and replay. Not Keycloak. |
| `node test/oidc-http.cjs` | PASS | Nest/Express routing and cookie/cache controls; provider and session issuance are mocked. |
| `node scripts/oidc-callback-check.mjs` (frontend) | PASS | Chromium against port 3000: conditional SSO link, one exchange, sessionStorage and removal of callback credentials. Exchange and provider status are mocked. |

These checks do not establish live Keycloak interoperability, working MFA, complete authorization enforcement, native kubectl access, stream termination, notification delivery, or offsite restore. No production deployment, GitHub publication, authorization enforcement toggle or backend process restart was performed in this checkpoint. The active goal and all unfinished stage gates remain open.

## External Identity Administration Increment

- Added administrator-only GET/POST `/api/v1/users/:id/external-identities` and DELETE `/api/v1/users/:id/external-identities/:identityId` (legacy API alias also supported).
- Explicit issuer/subject binding only; no email matching, role import or reassignment of an existing identity. Issuer uses existing HTTPS/loopback validation and rejects query parameters. Subject length is bounded.
- Binding requires an active local account. Bind/unbind, account authorization-version increment and durable audit commit atomically; account-first locking keeps both mutations in the same lock order.
- Fresh backend build and `test/authorization-postgres.cjs` passed. Real PostgreSQL savepoints verify duplicate identity rejection and wrong-user removal roll back version changes, and successful removal makes identity resolution fail. All test fixtures roll back.
- Not yet accepted end to end: frontend identity administration, verified provider-side subject selection, live Keycloak login, MFA and runtime deployment remain outstanding. Administrators must verify the issuer/subject independently; the API does not contact the provider to attest that a manually supplied subject exists.

Frontend follow-up: user row actions now contain an enterprise-identity modal with existing theme components, explicit issuer/subject entry, loading/error/empty states, disabled-account binding protection and confirmed removal. Changes invalidate the identity query and warn about session invalidation. It is source-only, not deployed to port 3000 or visually accepted yet.

Validation gate: `npx tsc --noEmit --pretty false` currently exits 2 on pre-existing test-file configuration errors: cluster-workspace.test.ts unused ts-expect-error and .ts import extension; topology-surface.test.ts ES2018 regex flags under the configured target. No production-source type error was reported, but the full type-check is NOT passing. Keep the currently running port-3000 build unchanged until this gate and browser interaction checks are resolved.

Gate resolution: moved the existing native-Node import suppression to the actual import-specifier error line and removed redundant dotAll flags from regexes that contain no dot wildcard. No tests were excluded and the compiler target was not changed. Fresh `npx tsc --noEmit --pretty false`, scoped ESLint, and `node --test src/lib/cluster-workspace.test.ts src/modules/topology-kubejojo/topology-surface.test.ts` all pass (30 tests). Node reports only its existing module-type autodetection warning.

`KUBENOVA_NEXT_DIST_DIR=.next-candidate npm run build:stable --silent` also passes, including Next TypeScript checking and all 54 static pages. Candidate output is separate from the verified active `.next-validation/standalone` process on port 3000. No runtime switch was made: backend process refresh and identity-modal browser interaction acceptance remain pending, so the successful candidate build is not a deployment claim.

Local runtime checkpoint: the old backend session was absent and port 4000 had no listener. Restored the compiled backend using the repository's `scripts/_dev-env.sh` development defaults (PID 50453); unauthenticated users endpoint correctly returns 401. Switched frontend port 3000 to `.next-candidate/standalone` (PID 51224), preserving the prior output for rollback. `/login` returns 200. Future builds must use a different output directory while this candidate is running.

`node scripts/identity-management-check.mjs` now passes in Chromium on port 3000: open enterprise identity from the user row, bind with the expected payload, refresh the identity list, cancel deletion without a mutation, then confirm deletion and return to the empty state. API responses are mocked, including the shell's capabilities array; this is browser interaction acceptance, not live Keycloak acceptance. `node scripts/oidc-callback-check.mjs` also passes on the new runtime. No production environment was touched.

## Keycloak Runtime Preparation

Installed Homebrew `openjdk@21` 21.0.12.1 and verified the executable directly at `/opt/homebrew/opt/openjdk@21/bin/java`; no global Java symlink or shell profile was changed. Docker is still unavailable.

Downloaded the official Keycloak 26.7.4 distribution into `/tmp/kubenova-keycloak.AQKtiF`, verified SHA-256 `04823c336b797a7e18889a44262a7a64e6bf624cbbcc518c85e2622176ff2eee` against GitHub release asset metadata, then extracted it. `kc.sh --version` succeeds with Java 21 on this Mac. No realm, test user, identity server, MFA policy or application login configuration was created or changed yet. Next gate is an isolated real-provider authorization-code browser flow, followed by MFA enforcement and recovery testing. Runtime availability is not SSO acceptance.

## Real Keycloak Provider Check

`KEYCLOAK_HOME=/tmp/kubenova-keycloak.AQKtiF/keycloak-26.7.4 JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home node test/keycloak-provider.cjs` passes against Keycloak 26.7.4, real Redis and Chromium. The test launches a loopback-only provider on 18080 with an in-memory database, random realm, client secret and user credentials. It exercises the production OidcProviderService code flow with PKCE, validates the returned signed issuer/subject and rejects replay.

Initial failures were in the browser harness: routing alone did not capture the redirected navigation. Observing the actual callback request fixes capture; the console exchange API is mocked to reject so it cannot consume the test code. Consequently this is genuine provider interoperability, NOT a full browser-to-KubeNova-session acceptance test and NOT MFA verification. The temporary provider exits and its credential-bearing import file is removed in finally. Port 18080 has no listener and the import directory is empty after the successful run. Existing platform users, bindings and MFA flags were not changed.

Extended real-provider check: the same test now requires an explicit loopback `DATABASE_URL` and passes the verified Keycloak identity into the real UsersService/OidcIdentityRepository/AuthService with PostgreSQL. It verifies unbound identity rejection, administrator binding, local user-role session issuance and validation, then unbinding invalidates both access and refresh tokens and blocks future external login. The database transaction deliberately rolls back and the test verifies fixture absence afterward. Fresh run passed both provider and platform-session stages. The browser still does not traverse the real HTTP exchange endpoint, and MFA remains unimplemented; those gates remain open.

Provider-unavailability handling: start now sets no-store/no-referrer before provider I/O and converts provider/storage startup errors to a generic 503 without emitting a binding cookie or redirect. A regression test first failed on the raw error and now passes; the controller suite has 8 passing tests, backend build and HTTP integration also pass. This change is built but not yet loaded into the running backend. A user-friendly browser initiation error screen remains separate unfinished UI work.

Browser initiation follow-up: added same-origin POST `prepare`, reusing the start flow and binding cookie without redirecting the fetch request. Login now shows a loading button, a bounded request timeout and a generic retryable inline error; it never displays provider error bodies. The existing GET redirect entry remains supported. Cross-origin prepare is rejected before contacting the provider. Controller regression tests pass (9 tests); frontend type checking, scoped lint, backend build, Next production build and HTTP integration pass.

Updated local runtime: backend PID 90723, frontend PID 90724 using `.next-validation/standalone` on port 3000. Build future candidates into `.next-candidate`, not this active directory. Updated Chromium callback check passes on port 3000, including simulated provider-start 503 retaining the login screen and re-enabling retry. Real provider full HTTP flow and MFA remain separate open gates; no production release occurred.

Revocation interleaving regression: extended the real PostgreSQL test to revoke an external identity after resolution but before session insertion. The resulting stale session is rejected by both access validation and refresh; no replacement session appears and subsequent external login fails. The test passes and fixtures roll back. This is a deterministic interleaving test, not a concurrent load test. Existing version checks already enforce the boundary, so no redundant production locking was added. This does not prove immediate termination of an already-open terminal or log stream.

Runtime expiry correction: both Go terminal and log stream contexts now use the signed runtime token expiry as their deadline. The shared keepalive closes the socket when its context ends, releasing idle client readers as well as cancelling the Kubernetes stream context. A real WebSocket regression failed before the change (connection stayed open until read timeout), then the httpapi package passed after the fix. This change is not a substitute for grant-revocation push, user disable notifications or live-cluster stream acceptance; it is source-only until the runtime gateway is rebuilt and restarted.

Local gateway delivery: full `go test ./...`, focused race test and `go build` pass. Updated the binary managed by `gui/501/com.kubenova.runtime-gateway` without changing its launch configuration. Previous binary retained as `/Users/beidou/.local/share/kubenova/runtime-gateway/runtime-gateway.before-expiry-fix`. Candidate and installed SHA-256 both equal `a251c1cf8a8b1545f4d2a3a6bbcce934dff40c6786a360b6de629653c7fbca3a`. After LaunchAgent restart, PID 2023 listens on 4100; `/healthz` returns `ok` and `/readyz` returns `ready`. These health checks do not prove a real Kubernetes terminal/log session or immediate revocation. No remote deployment occurred.

Persisted runtime identity boundary: RuntimeSessionService now compares user, type, cluster, namespace, Pod and container between signed claims and the stored session, and rejects ownerless sessions. New tests first reproduced seven accepted mismatches, then passed after the shared validation fix. Four runtime suites / 16 tests and the backend build pass. This prevents accepting an inconsistent signed token, not a demonstrated unsigned-token exploit; signature verification already existed. Built source is not yet loaded into the running control API. Continuous authorization and immediate stream revocation remain open.

Disabled runtime owner: RuntimeRepository now requires an active related user when looking up runtime sessions, so bootstrap validation cannot reconnect a disabled or deleted account using an existing runtime token. A real PostgreSQL regression reproduced the old acceptance, then passed after the shared query fix; the complete authorization PostgreSQL integration and backend build also pass. Test fixtures roll back. This is not version-based runtime revocation and does not terminate already-open streams; disable/re-enable and grant changes still need runtime authorization-version tracking. Running control API has not yet loaded this increment.

Runtime version increment: applied additive local migration `20260917080000_runtime_authz_version` and regenerated Prisma. New runtime sessions capture the active owner's authorization version; lookup requires the same current user version. Null-version legacy sessions fail closed and must be recreated. The real PostgreSQL disable/re-enable regression failed before the change and passes afterward, along with the other authorization integration checks and backend build. The nullable column permits schema rollback without removing data, but reverting enforcement is not a security-safe operational rollback.

Remaining race gate: session creation currently reads the owner's version after controller authorization. Authorization and version capture must be tied to the same validated snapshot before claiming grant revocation is race-safe during new runtime creation. Existing-connection termination still requires a live revocation mechanism. This source increment has not been loaded into the control API process.

Snapshot handoff fix: AuthService validation now attaches the validated session's authorization version to the server-side request context. Both runtime and log-bootstrap controllers forward that snapshot and overwrite any client-supplied version. RuntimeRepository requires a valid matching snapshot and persists it unchanged, so a later revocation cannot upgrade a stale authorization decision into a fresh session. Real PostgreSQL regression first reproduced acceptance of a stale creation snapshot, then passed; controller tests cover forged-version replacement and the logs route, and backend builds pass. Existing stream push revocation and runtime deployment of this increment remain outstanding.

Snapshot local delivery: rechecked all RuntimeService.createSession callers (runtime controller and LogsService), then reran the full backend suite: 76 suites / 563 tests pass. Restarted only the local control API with the same repository development configuration, PID 20327. `/api/health/ready` reports ok; frontend port 3000 `/login` returns 200. A separate Prisma query using the application database role successfully reads the migrated RuntimeSession authorization-version field. Persisted identity, disabled-owner and snapshot fixes are now loaded locally. These checks do not establish real Kubernetes stream success or revocation delivery; no remote deployment occurred.

MFA status audit (2026-09-18): the current `User.mfaEnabled` flag is a fail-closed
policy marker only. `PATCH /api/users/:id/mfa` intentionally returns 503 because
TOTP enrollment, verification, recovery-code rotation and assurance-carrying login
are not implemented. No MFA flag was changed during this audit; the default remains
optional/off. A delegated implementation attempt failed upstream before producing
changes, so no completion claim is made. The next gate remains an isolated TOTP
design with encrypted secret storage, one-time recovery-code hashes, replay/rate
limits, superadmin-only policy/reset and user self-enrollment, followed by real
login and recovery tests before enabling any account.

MFA primitive increment: commit 78f4e3a adds isolated RFC6238-style TOTP helpers
with a +/-1 time window, AES-256-GCM secret encryption and SHA-256 recovery-code
hashing. Two focused tests pass. It is deliberately not wired to the schema,
controllers or login: doing so before a pending-MFA challenge/session model would
either leave accounts locked without enrollment or weaken the existing fail-closed
behavior. The helper is not an MFA feature and no account policy was enabled.

MFA primitive validation follow-up (2026-09-18): integrated c483496, rejecting
empty encryption keys, malformed encrypted envelopes, invalid Base32 secrets and
unsafe time/window inputs. All 30 focused tests pass, including six RFC6238
vectors. Enrollment and login remain incomplete; no account flag or running
service was changed. The clean temporary validation worktree was removed.

Read-only acceptance preparation: local account `loop-read` is active and has
MFA disabled. Its direct/group grant query returns an active viewer grant for
`vke-test`, namespace `ai`, with explicit `exec` capability and no expiry.
Consequently this is not a strictly read-only effective permission set. Preserve
the existing grant during baseline testing; test explicit terminal capability
separately from write-resource denial. Real password login remains unverified
pending test credentials or permission to reset the test account password.

Read-only service check against the real local PostgreSQL grant (2026-09-18):
the compiled AuthorizationService permits `loop-read` scoped resource reads and
explicit exec, and denies resource mutation, logs, secrets, another namespace and
another cluster. Seven assertions passed without changing users or grants. This
is authorization-engine evidence only, not HTTP enforcement, browser login,
live Kubernetes access or revocation acceptance.

MFA challenge-store increment: integrated b846796. Opaque random challenge tokens
use SHA-256 Redis keys, a 300-second TTL and atomic GETDEL consumption. Payloads
contain only user ID, authorization version and enrollment version. Main-thread
verification with MFA_REDIS_INTEGRATION=1 passed 54 tests across challenge and
TOTP suites, including real Redis concurrent consumption and accelerated expiry.
Only test-created keys were removed, and the clean delegated worktree was removed.
This store is not yet registered or exposed by login. Rate limiting, enrollment,
session assurance and the superadministrator boundary remain mandatory gates.

Password limiter integration (2026-09-18): AuthController counts actual transport
IP before authentication; AuthService counts canonical user ID (or normalized
unknown username) before password verification. Redis atomically applies fixed
5-minute windows, 10 account / 100 IP attempts, and generic 429/503 responses.
Client-supplied forwarding headers are ignored. The limiter client closes during
module teardown. New integration regressions failed before wiring and pass now.

Build and complete backend regression passed: 91 suites / 765 tests with real
Redis challenge/limiter gates enabled. Restarted local control API as PID 64309,
notification auto-delivery still disabled. The first HTTP probe encountered 500
because the shell-backgrounded process did not survive; detached Node startup
corrected that. Readiness is 200. Through local port 3000 a random nonexistent
username returned ten 401s then one 429, as expected. No real user's password or
grant changed. Test counters expire automatically after five minutes. Clean
limiter worktree removed. MFA enrollment and successful loop-read login remain
unverified; no production release occurred.

User-reported loop-read entry failure (2026-09-18): reproduced both cluster-list
and dashboard HTTP 500 through port 3000 using the user's existing active local
session, without printing or changing its token. Direct application-role query
identified missing ClusterRoleBinding, despite its migration being recorded.
Restored precisely that existing migration's table/index/FK definitions, then
restored SELECT/INSERT/UPDATE/DELETE for the existing kubenova application role.
Both endpoints now return 200 with the same session. No binding or grant was
created, broadened or modified.

The remaining visibility failure is NOT resolved: ClusterAccessService still
reads legacy bindings, whereas loop-read's grant is in AccessGrant. Do not bridge
this by creating a cluster-wide legacy role: its grant is namespace-scoped to ai.
Resource controllers have inconsistent namespace enforcement (including legacy
workload list paths), so simply allowing a grant through assertCanRead would
broaden access. Next delivery must connect grant-aware cluster discovery and
resource namespace enforcement together, including direct/group expiry and
revocation, and re-run actual local HTTP and browser access tests.
MFA schema work remains unapplied and paused for this defect.

Follow-up resolution (2026-09-21): `ClusterAccessService` now uses effective
`AccessGrant` records for cluster discovery and health-list visibility while
keeping resource reads namespace-scoped. Focused cluster/access tests pass;
the real local `loop-read-access.cjs` regression passes through port 3000 after
an isolated temporary session (the session was removed immediately afterward).
An isolated Chromium check saw `vke-test` on `/clusters` with no 500 and no
console errors. No password, grant, or production account was changed.
# Log Center Acceptance Boundary (2026-09-18)

Inspected LogCenterService.query: authenticated actor ID is mandatory, followed
by assertPlatformAdmin and cluster access enforcement. The selected Elasticsearch
data source is queried with exact id/clusterId/kind/enabled predicates. This is
admin-only access, NOT completed namespace-grant support for ordinary users.
The current 42 log-center tests pass; no permission widening was performed.

Browser regression now offers LOG_CENTER_MOCK_AUTH=1 so UI validation does not
depend on guessing administrator passwords or mutating real sessions. Real-login
mode requires explicitly supplied BASELINE_USER and BASELINE_PASSWORD. Mocked
port-3000 tests passed seven states, light/dark themes and 1440/1024/390 widths;
the dark 390 screenshot was inspected. No live Elasticsearch backend was used.

Remaining integration must derive allowed namespace UIDs and explicit logs
capability on the server, constrain every log query to those namespaces, and
deny missing/unverifiable scope. Client namespace filters alone are insufficient.
Data-source discovery also needs a metadata-only path for such users; do not
expose administrator configuration or secret references to satisfy UI access.
