# MFA Integration Gates

Self-status endpoint acceptance: guarded GET /api/v1/auth/mfa/status returns only
enabled and passwordReauthenticationAvailable, with no-store. Real isolated HTTP
tests pass enrolled/unenrolled accounts, passwordless account indication, rejected
password enrollment for passwordless accounts, unauthenticated denial and old
session denial after enrollment. No password hashes, secrets or recovery codes
are exposed. Source build includes this endpoint; running local API has not yet
been replaced and personal-security UI remains outstanding.

OIDC isolation acceptance: local signed-provider + real Redis integration now
also covers reauthentication-as-login, login-as-reauthentication, changed user,
changed session and changed authorization version. Every case rejects before
token endpoint traffic and consumes the transaction so corrected replay fails.
All scenarios pass. This does not replace controller live-session validation,
which is still required before exposing reauthentication endpoints.

Latest provider increment: OIDC reauthentication has separate start/complete
methods bound to user/session/authz version/subject/request time. It requests
prompt=login and max_age=0 and checks signed auth_time with 30-second clock
tolerance. Normal login and reauthentication transactions reject purpose mixing.
Build, 31 OIDC unit tests, and real openid-client with a local signed-token
provider plus Redis pass fresh identity, old/missing auth_time and foreign subject
cases. Authenticated controller context, post-callback live-session revalidation
and enrollment handoff remain unimplemented; do not expose this as a completed
OIDC enrollment flow. No runtime deployment or real account changes.

Scope: optional MFA for every role, with policy/reset controlled only by the
superadministrator. Users may enroll their own authenticator, not change policy
or reset other users. Keep existing fail-closed login until all gates pass.

## Ordered delivery

1. Pending login challenge: use existing Redis dependency, random opaque token,
   hashed Redis key, 5-minute expiry, atomic single-use consumption. Bind to the
   password-authenticated user and authorization version. An invalid OTP consumes
   the challenge; retry starts with password authentication. Add server-side
   account/IP rate limiting before exposing challenge endpoints: the current
   AuthController/AuthService contains no login limiter. Single-use challenge
   consumption alone does not limit fresh password/challenge requests. No
   session/token issuance at this gate.
2. Enrollment persistence: encrypted per-user secret, confirmed-at timestamp,
   last accepted TOTP counter and hashed one-use recovery codes. Enrollment secret
   expires and is never enabled until a valid code is verified. Transactions must
   prevent OTP/recovery replay and invalidate old sessions after resets.
3. AuthService integration: password success creates challenge; verified TOTP or
   recovery atomically consumes it before session issuance. Recheck active user,
   authorization version and enrollment generation. Persist MFA assurance in the
   session; refresh never upgrades an unverified session. OIDC must not bypass
   local MFA merely because a provider authenticated the password.
4. User/admin UI: self-enrollment and one-time recovery display; user-management
   status and privileged reset. Never expose secrets in account-list responses,
   audit logs, browser persistent storage or generic error messages. Resolve the
   superadministrator identity model before adding privileged endpoints: current
   administration checks accept both `admin` and `platform-admin` without a
   separate superadministrator distinction. Do not silently grant MFA policy
   management to every existing administrator or infer privilege from username.
5. Local acceptance on port 3000: enrollment, bad/expired/replayed code, concurrent
   verification, recovery reuse, reset, disabled account and OIDC interaction.
   Only then enable an explicitly designated test account. No production publish.

## Parallel boundaries

Current split: isolated TOTP helper worktree returns the matched time-step counter
for database anti-replay compare-and-set; main integration owns the additive
credential/session schema and local PostgreSQL migration verification. Neither
slice enables users. Credential storage uses one row per user, encrypted secret,
enrollment version, confirmed timestamp, last accepted counter and hashed recovery
codes; pending enrollment remains separate from confirmed credentials.

The challenge-store implementation can run in its own worktree while the main
thread reviews current login/session contracts. Schema and session integration
are serial because they share the authentication boundary. Each slice requires
focused failing-then-passing tests and a real Redis/PostgreSQL check as relevant.

## Session contract discovered during integration review

Login limiter delivery slice: an atomic Redis fixed-window counter, independent
account and transport-IP buckets, 10 account attempts and 100 IP attempts per
5 minutes. Count all password attempts to avoid success/error side channels and
concurrent bypass. Hash identifiers in Redis keys. Return generic 429 with a
retry-after value, and generic 503 if counters cannot be persisted. The account
bucket uses the resolved user ID where possible so username aliases cannot reset
the limit. Until a trusted proxy boundary is explicitly configured, use the socket
address, not untrusted X-Forwarded-For. Shared reverse-proxy IP limits need a
separate deployment acceptance check before production enablement.

- AuthService currently returns `AuthSession | null`; the controller immediately
  dereferences session token fields. Introduce a discriminated pending-challenge
  result and update both password and external-login callers together.
- `issueSession`, `refresh` and `validate` all reject `mfaEnabled` today. Do not
  remove these guards globally. Replace them with persisted assurance plus an
  enrollment-version comparison only after verified challenge redemption exists.
- AuthRepository.rotateSession creates a new row with only the authorization
  version. The MFA assurance/enrollment snapshot must be copied transactionally,
  never recomputed from current user state during refresh.
- Enrollment confirmation/reset must increment authorization version and revoke
  previous sessions in the same database transaction; challenge redemption must
  not issue a session from a stale user/version snapshot.

## Rollback

Use additive schema changes. Preserve existing accounts and grants. Do not revert
to password-only access for enrolled accounts. Before local runtime rollout,
retain the prior build; if acceptance fails, disable the new enrollment entry
while keeping MFA-marked accounts fail-closed. Never reset `loop-read` credentials
without the requested password-reset permission.

## Verified Increment

Integrated isolated counter helper commit 16ca77f as d8aae15 after review: 44
focused tests pass, including RFC vectors, skew, zero counter, and collision
ordering. The clean helper worktree was removed after integration. This returns
the matched counter for persistence; it does not itself enable MFA or provide
database anti-replay enforcement.

The pending credential/session migration was rehearsed inside a real local
PostgreSQL transaction with MFA_SCHEMA_REHEARSAL=1. Storage tests verify defaults,
compare-and-set rejecting the same counter twice, rejection of incomplete session
assurance, nonpositive enrollment versions and negative counters, valid assurance,
and user-delete cascade. All DDL and fixtures roll back. Backend build passes.
No migration was permanently applied, no Prisma client regenerated, no account
enabled, and no enrollment/login UI is claimed complete. Next: transactional
credential redemption and persisted session assurance, then explicit
superadministrator policy boundary and UI integration.

Credential redemption increment: MfaCredentialRepository validates challenge
identity/version bounds, reads only confirmed credentials for active MFA-enabled
users, decrypts TOTP secrets with the configured MFA key, and atomically advances
the accepted counter or removes a matching recovery hash. Both conditional writes
recheck user and enrollment versions. It returns assurance only after exactly one
row is changed; it does not issue a platform session or expose an HTTP endpoint.
Focused tests observed RED for valid redemption then passed (7 cases). Real
PostgreSQL rollback rehearsal now exercises the production repository for TOTP
replay, recovery reuse, stale enrollment/authz version and disabled account denial.
Build passes. Cross-connection race tests and atomic assurance/session issuance
remain gates; sequential replay checks are not claimed as concurrent acceptance.

Concurrent redemption gate now passes: test/mfa-concurrency-postgres.cjs creates a
unique local test schema, copies User/Session table definitions and applies the
pending MFA DDL only there. Two Prisma clients prove distinct PostgreSQL backend
PIDs, synchronize after credential reads, then race the production repository's
conditional writes. Exactly one TOTP redemption and one recovery redemption win.
The generated schema is dropped in finally and its absence verified. Public
schema/users remain unchanged. This closes credential-consumption concurrency,
not challenge-to-session atomicity or the public MFA login flow.

Atomic issuance increment: redeemAndCreateSession locks the active MFA-enabled
user at the challenge authorization version, consumes the credential and persists
session assurance in one PostgreSQL transaction. The isolated two-connection test
now proves exactly one session is issued for a raced recovery code; an injected
session-write failure rolls back credential consumption. Session assurance is
verified directly in SQL and the test schema is removed. Build and 8 focused
repository tests pass. Public challenge redemption, refresh assurance propagation,
enrollment/admin boundary and browser flow are still not wired or enabled.

AuthService completion increment: completeMfa consumes the opaque Redis challenge
before invoking atomic credential/session redemption. Refresh tokens are generated
server-side, only their hashes are persisted, and response identity comes from the
transaction result. Invalid codes consume the challenge; replay cannot reach the
repository a second time. Missing MFA dependencies fail closed. Three focused
suites / 29 tests and build pass. No HTTP endpoint/provider wiring was enabled:
normal MFA-marked login remains denied until challenge issuance, session validate
and refresh assurance handling, and frontend challenge flow are integrated.

Refresh lifetime check: real PostgreSQL test reproduced a replacement access
expiry exceeding the original refresh expiry. MFA rotation now caps access expiry
at the persisted absolute refresh deadline. Concurrent rotation/assurance tests
and build pass after the correction. No public MFA entry point is enabled.

Persisted assurance validation now checks credential version, verification time,
revocation, user status and authorization version before accepting an MFA session.
Real database validation exposed timestamp-without-time-zone versus PostgreSQL
session-timezone coercion; database verification timestamps and comparisons now
explicitly use UTC. Fixture setup uses UTC and assurance validation is repeated
under Asia/Shanghai. Reset version and future verification timestamp are rejected.
Focused auth suites (19 tests), build and isolated database race/assurance tests
pass. Refresh and HTTP/provider wiring remain pending; no runtime MFA enablement.

Refresh repository increment: a user-locked transaction conditionally revokes the
old refresh session only with current credential assurance, creates a replacement,
and copies the original MFA timestamp/version without re-verifying or extending
assurance. Real two-connection tests prove only one refresh wins and SQL assurance
is unchanged. Reset/future-time checks now use the active replacement session.
Build and isolated PostgreSQL checks pass; AuthService refresh routing remains
to be connected before enabling the feature.

Login contract increment: password and validated OIDC identities share challenge
issuance for MFA users. AuthLoginResult distinguishes a pending 300-second opaque
challenge from an authenticated session. Both controllers return the pending
shape without token fields; password challenge responses disable caching. Missing
MFA providers still deny access. RED challenge test then 30 focused auth/OIDC
tests and build pass. Module dependencies and frontend handling are deliberately
not enabled until completion endpoint and enrollment flow are integrated.

AuthService refresh now routes MFA-enabled users exclusively to the atomic MFA
rotation repository, while ordinary sessions keep the existing rotation path.
Absent MFA dependencies remain fail-closed before token generation. RED routing
test reproduced blanket denial, then 20 auth tests, build and the isolated
PostgreSQL concurrency suite passed. Module/HTTP challenge issuance and enrollment
remain disabled pending full integration; this is not a deployed MFA login flow.

Module wiring increment: AuthModule now provides MfaCredentialRepository and the
Redis-backed MfaChallengeStore with bounded connection/command timeouts. Store
shutdown disconnects its owned connection. The verification HTTP endpoint uses
the existing IP limiter and strict DTO validation; no-store responses never echo
challenge/code values. Focused store/auth tests pass (30, one optional Redis skip)
and build passes. This source build has not replaced the local runtime: permanent
MFA schema migration and frontend challenge handling must precede rollout. No
user MFA flag or credentials were changed.

Frontend challenge increment: password and OIDC login now retain a pending MFA
challenge only in provider memory, with a bounded expiry and remember preference.
The existing login surface offers TOTP/recovery entry and cancellation; submitted
passwords are cleared. Verification consumes the local challenge before transport,
and failure returns to fresh login without installing tokens. OIDC pending login
routes to /login rather than entering the console. Reused existing form/theme UI.
TypeScript and production candidate build pass. Browser regression first failed
on the absent verification form, then passed against the candidate served on 3000:
no challenge/token storage while pending, failed verification clears password,
OIDC challenge routing, verified session-only persistence. API responses are mocked
in that test; this is frontend acceptance, not real MFA backend end-to-end proof.
Screenshot inspected at /tmp/kubenova-mfa-challenge.png. Local frontend PID 83333
serves .next-candidate/standalone; prior .next-validation remains for rollback.
Backend and real user credentials/flags were not changed. Permanent schema,
enrollment/reset policy and real HTTP/database MFA acceptance remain outstanding.

Local schema increment: full backend regression passed 100 suites / 851 tests
(two optional skips); explicitly enabled real Redis challenge suite passed all 25.
Created PostgreSQL custom-format backup at
/tmp/kubenova-pre-mfa.a3WtT8/k8s_aiops.dump (private temporary directory), and checked
its archive table of contents. This is backup creation evidence, not restore proof.
Verified the MFA table/columns/migration record were absent, then applied ONLY
20260918040000_mfa_credentials, app-role table privileges and SHA-256 migration
history atomically. No accounts, grants, credentials or MFA flags changed.
Prisma client regenerated and backend build passed; storage constraints passed
against the installed schema with all test rows rolled back. The isolated
concurrency fixture initially failed because it copied the now-migrated Session
shape; it now removes MFA columns only from its generated private schema before
rehearsing the migration. Concurrent single-use and session rollback tests pass
again, with fixture schema removal verified. Post-generation auth regression:
18 suites / 205 passed, two optional skips. Backend runtime remains unchanged;
real HTTP login/enrollment/reset integration is the next gate.

Real HTTP integration increment: test/mfa-http-postgres.cjs exercises production
AuthController/AuthGuard/AuthService/repositories through Nest + supertest, with
real PostgreSQL in a unique mfa_http_<uuid> schema and Redis under a run-specific
key prefix. No mocked auth/storage responses. Passed password-only session denial,
single-use challenge even after bad OTP, TOTP verification, no-store challenge and
verification responses, /me, refresh rotation and old-token rejection, credential
version change invalidation of access/refresh, one-use recovery, and strict DTO
extra-field rejection. Also passed ordinary non-MFA password login and logout.
All fixture tables/schema and this run's Redis keys are removed; real users remain
unchanged. This proves the controller/service/storage chain, not production
AuthModule wiring or browser-to-running-backend acceptance. Enrollment and the
explicit superadmin-only management boundary remain open.

Pending enrollment storage increment: MfaEnrollmentStore generates an independent
20-byte Base32 secret, encrypts it before Redis storage, hashes the opaque lookup
token, expires after five minutes and uses GETDEL for single consumption. Bound
to authenticated user ID, session ID and authorization version; mismatched
identity, corrupted ciphertext, missing key and unavailable storage fail closed.
Five focused tests and backend build pass. This store is not yet wired to any
public endpoint. Confirmation still needs an atomic user-lock transaction,
verified TOTP counter, one-time recovery issuance and session revocation before
enrollment can be exposed. No existing user's MFA state changed.

Pending enrollment Redis acceptance: expanded to 12 passing tests with
MFA_REDIS_INTEGRATION=1. Actual Redis verifies five-minute TTL, encrypted payload,
exactly one winner under concurrent GETDEL, and expired request rejection.
Malformed user/session/version identities are rejected before any store write.
Cleanup deletes only the random keys created by the test; shared Redis was not
flushed. This closes the pending-store acceptance gate, not the enrollment
confirmation or administrator-management gates.

Enrollment confirmation repository increment: validates a live session and exact
authorization version under the existing User row lock; rejects enrolled or
disabled users and existing credentials. Valid TOTP creates encrypted credential
with consumed counter, ten random 128-bit recovery codes stored only as hashes,
increments authorization version, revokes all sessions and records mfa-enrolled
in AuthorizationChange within one transaction. Extended isolated PostgreSQL test
failed on missing implementation then passed: concurrent confirmation has one
winner, recovery hashes match, version increments once, sessions are revoked and
one audit record exists. Build and real HTTP login regressions pass. Confirmation
is tested directly at the repository boundary; no enrollment endpoint is exposed
yet, and no real user's MFA was enabled. Audit-failure rollback, stale session
and endpoint wiring still need acceptance before enabling self-enrollment UI.

Enrollment failure acceptance: real isolated PostgreSQL test now rejects stale
authorization versions, revoked sessions, expired sessions and inactive users.
A test-only CHECK constraint forces the final AuthorizationChange insert to fail;
the actual transaction rolls back credential creation, MFA flag/version changes
and session revocations together. Verified no credential/audit row, unchanged
user state and still-active original session after failure. Removed constraint
and verified successful concurrent enrollment afterward. Entire HTTP/storage
regression passes and isolated schema cleanup succeeds. Endpoint/UI wiring still
remains; this gate did not alter production behavior or real user state.

Self-enrollment HTTP source increment: guarded start/confirm routes derive the
principal from the validated session, reject extra user-ID input, recheck session
and account versions, rate-limit start, consume pending enrollment once and return
no-store responses. Real isolated HTTP/PostgreSQL/Redis acceptance passes start,
confirmation/recovery response and old-session invalidation; unauthenticated and
foreign-principal inputs are rejected. One initial integration run ended with a
socket hang-up; immediate fresh run passed with fixture cleanup in both runs.
Backend builds. Enrollment store is deliberately not registered in AuthModule
yet: recent reauthentication (including OIDC-only accounts), UI recovery-code
handoff and production wiring need review before enabling this sensitive flow.
No runtime restart, user enrollment, release or production deployment performed.

Local-password reauthentication increment: starting self-enrollment now requires
bounded password input and verifies the current authenticated account's password
after account rate limiting and live-session/version checks. Wrong password is
rejected; the real HTTP integration passes correct-password enrollment through
confirmation. Password is not placed in pending storage. Backend build passes.
OIDC-only accounts remain fail-closed on this password endpoint; a dedicated
provider reauthentication transaction bound to the current subject/session is
still required. Do not enable AuthModule enrollment provider/UI until that path
and one-time recovery-code handoff are implemented and verified.

AuthModule wiring increment: MfaEnrollmentStore is now a bounded Redis provider
using ConfigService `MFA_ENCRYPTION_KEY` (empty key remains fail-closed at start),
and the environment schema exposes the optional key without inventing a default.
Build, real isolated HTTP/PostgreSQL/Redis integration and 19 auth suites (216
tests, three optional skips) pass after wiring. The provider is now runtime-ready
for password accounts, but no existing MFA enrollment was enabled and no frontend
settings flow has been shipped. OIDC reauthentication and recovery-code UI remain
open acceptance gates.

Configuration consistency correction: enrollment provider preferred normalized
mfaEncryptionKey while credential confirmation/redemption read only the raw
MFA_ENCRYPTION_KEY. A regression with conflicting normalized/raw values reproduced
verification failure. Repository now uses the same normalized-first precedence
for both encryption and decryption; 14 focused tests, backend build and isolated
HTTP/Redis/PostgreSQL regression pass. Personal-center navigation remains unchanged
until a complete recoverable enrollment UI is ready; no broken route was exposed.

Enrollment provider lifecycle: added the standard OnModuleDestroy disconnect for
its owned Redis connection. Regression failed before the hook existed; all 13
enrollment tests including actual Redis now pass, as do build and isolated HTTP
integration. This avoids leaving the newly registered connection alive on module
shutdown. No service deployment or real account changes in this increment.
