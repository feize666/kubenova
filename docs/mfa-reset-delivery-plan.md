# MFA Reset Delivery Contract

This continues the accepted optional-MFA design and explicit superadministrator
boundary. It does not authorize selecting a real superadministrator or resetting
real users during development.

## Required Behavior

The existing PATCH user MFA Boolean endpoint must not directly enable MFA or
delete credentials. Enabling always requires the user's verified enrollment.
Administrative reset is a separate confirmed action for the designated active
superadministrator, bound to one target user and one current credential/version.

## Reauthentication

- Local-password administrators verify their current password through the
  existing password verifier and account/IP rate limit. Do not infer fresh
  password verification from Session.createdAt: refresh creates replacement rows.
- OIDC-only administrators use the existing signed-provider reauthentication
  implementation with prompt=login, max_age=0, exact issuer/subject and fresh
  auth_time. Add an explicit reset purpose and target snapshot to the stored
  transaction; enrollment callbacks must reject reset transactions and vice versa.
- If the administrator has MFA enabled, require a fresh TOTP or recovery-code
  verification using the existing anti-replay credential repository. OIDC primary
  authentication alone must not remove local MFA assurance requirements.
- Recheck current session, active account, administrator role and configured
  immutable superadministrator ID before and after external provider exchange.

## One-Use Reset Proof

Reuse the existing Redis pattern: 32 random bytes, opaque base64url token,
SHA-256 lookup key, SET NX EX 300, atomic GETDEL. The server payload binds action
`mfa-reset`, actor user/session/authz version, target user/authz version, current
credential version and absolute expiry. No client-supplied scope or role confers
authority. Missing storage, malformed payload, wrong identity/purpose/target,
expiry and replay all fail closed. Do not persist the proof in browser storage.

## Atomic Reset

After consuming the proof, lock the actor and target user rows in deterministic
ID order (one lock for self-reset). Recheck active actor, live session and version,
target snapshot and current credential. In one transaction delete the target MFA
credential, set mfaEnabled=false, increment authzVersion, revoke all target
sessions and write AuthorizationChange with actor, target and fixed reset reason.
Audit failure must roll back everything. A stale proof must never reset a new
enrollment. Do not delete the user, cluster grants or external identity bindings.

## Serial Implementation and Acceptance

1. Isolated worktree: backend proof storage and transactional reset, failing-first
   unit checks plus real Redis/rollback PostgreSQL tests. No public route yet.
2. Same action contract: local-password and OIDC reauthentication/controllers,
   DTO limits, rate limiting, no-store and origin/binding checks. Test purpose
   mixing, target substitution, mid-flight logout, expired/demoted actor and
   simultaneous reset/enrollment. Only then expose the route.
3. User-management action visible only from server-derived capability. Show the
   exact target and effect, reauthenticate, then require explicit confirmation.
   Do not place recovery codes or authenticator secrets in the admin interface.
4. Mocked UI checks and isolated real HTTP tests on the local stack; retain port
   3000 for frontend acceptance. No real account reset and no release.

## Integrated Core Acceptance 2026-09-19

### HTTP Integration Acceptance

- Follow-up `a7fabb2` upgraded the isolated database test to real Nest HTTP with
  real AuthGuard, AuthService, Redis and PostgreSQL. Main rerun passed password
  prepare/confirm, invalid session/origin/body and ordinary-admin denials, target
  session revocation and replay denial. OIDC browser reset is still unverified.
- `88b12fd` exposes `canManageMfa` in the existing MFA status response, derived
  from current designation, live role/account and available dependencies. Main
  reran 30 service tests and Nest build successfully. Frontend does not consume
  this field yet. The proof worktree was removed after acceptance.

- Integrated feature `88dcf87`: guarded password prepare/confirm and OIDC
  prepare/exchange routes, strict request DTOs, origin allowlist, socket-IP rate
  limit, independent reset cookie and module/store registration.
- Main integration: 7 suites / 152 tests passed with real Redis enabled; Nest
  production build passed. `test/mfa-reset-stepup-postgres.cjs` passed using
  isolated PostgreSQL tables and a unique Redis prefix: actual password checking,
  proof issuance/consumption, reset, target session revocation and replay denial.
- HTTP tests use the real Nest guard/validation pipeline but mocked services;
  database acceptance calls the real services directly. Combined real HTTP/DB
  acceptance and frontend OIDC reset handoff remain required. Do not present
  these tests as complete browser acceptance.
- Feature worktree and dependency symlink removed after integration. The commit
  remains recoverable. Running API/frontend have not been restarted; no public
  deployment, real account reset or real superadministrator designation occurred.

- Fresh integration run: `MFA_REDIS_INTEGRATION=1 node
  node_modules/jest/bin/jest.js --runInBand mfa-reset.store.spec.ts
  mfa-credential.repository.spec.ts`: 2 suites, 73 tests passed.
- Nest production build passed. The built repository passed
  `test/mfa-reset-postgres.cjs` against local PostgreSQL: reset, self-reset,
  concurrent single winner, session revocation, stale identity rejection and
  audit rollback. The test uses an isolated temporary schema, not real accounts.
- No public reset route or UI has been enabled. No real superadministrator was
  designated and no real credential was reset. Reauthentication wiring and
  HTTP/UI acceptance in steps 2-4 remain required; core acceptance does not
  establish end-to-end completion. Running services were not restarted.

## Reauthentication Integration Boundaries

### Step-up Service Acceptance 2026-09-19

- Integrated feature `6fba86e` (supersedes `83578a2` with denial tests), not
  worktree baseline `5b72e56`.
  AuthService now prepares reset proofs after password or provider-verified OIDC
  authentication, requires fresh TOTP/recovery redemption for enrolled actors,
  and rechecks actor/session/target state before proof issuance. Confirmation
  consumes the target-bound proof before invoking the atomic repository reset.
- Main integration ran four focused suites with real Redis enabled: 102 tests
  passed, then 108 passed after additional null-password, disabled-actor,
  mid-flight logout/password change and OIDC binding-change cases. Nest
  production build passed. The feature worktree and dependency symlink were
  removed after acceptance; the feature commit remains recoverable.
  These are service-level tests; public
  routes and store provider registration are still unwired, and no real account
  was changed. The existing local processes were not restarted.
- Remaining HTTP gates: request-origin validation, trusted-IP limiting, strict
  DTO validation, separate reset cookie and OIDC callback routing, no-store
  responses, server-derived admin capability, and real isolated HTTP acceptance.

### OIDC Boundary Acceptance 2026-09-19

- Fresh real Keycloak regression after purpose-binding integration passed:
  browser code/PKCE flow, signed identity, explicit fresh reauthentication with
  exact subject, replay denial, identity binding and unbind session revocation.
  Executed `test/keycloak-provider.cjs` against the local Keycloak 26.7.4
  distribution and local PostgreSQL. Database fixtures rolled back; port 18080
  is closed and the temporary realm import directory is empty. This covers the
  existing enrollment-purpose provider path, not a public reset HTTP/UI flow.

- Integrated the isolated OIDC purpose-binding slice (`17f35ca`) after source
  review. The transaction stores an explicit `enrollment` or `mfa-reset`
  purpose; reset contexts bind target user, authorization version and MFA
  credential version.
- Focused OIDC flow/provider/controller tests passed: 3 suites, 41 tests in the
  integrated tree. The isolated slice reported 50 tests including its full
  provider set; no route or account was changed.
- Production Nest build passed after integration. Purpose mixing, target
  substitution, malformed targets and callback replay are rejected before any
  reset route is exposed.

- OIDC slice owns transaction context, flow, provider and their focused tests in
  an independent worktree. It adds explicit enrollment/reset purpose and the
  reset target/version snapshot; no reset controller is exposed by this slice.
- The subsequent reset service should reuse `AuthRepository.findValidSessionById`,
  `verifyPassword`, `LoginAttemptLimiter`, and `MfaCredentialRepository.redeem`.
  `redeemAndCreateSession` is inappropriate for step-up: no new login session is
  needed or permitted. The existing `redeem` primitive already enforces TOTP and
  recovery-code single use.
- Recheck the actor and target snapshot after primary/factor verification and
  before issuing a proof. Confirmation consumes the proof against a fresh
  server-derived snapshot and delegates the atomic mutation to `reset`.
- HTTP wiring must rate-limit both account and trusted request IP, validate
  origin and body, use no-store, and provide a separate OIDC reset binding cookie.
  Do not share the enrollment callback or browser purpose marker accidentally.
- Cleanup completed core worktrees only after integrated source comparison and
  validation; preserve their feature commits for recovery.

## Earlier Prerequisites

`test/keycloak-provider.cjs` already verifies real Keycloak fresh reauthentication
with an existing SSO cookie, signed auth_time, exact subject and replay rejection.
`test/mfa-http-postgres.cjs` covers enrollment and session invalidation;
`test/superadmin-postgres.cjs` covers explicit identity/target protection. These
are prerequisites, not proof that administrative reset is implemented.
