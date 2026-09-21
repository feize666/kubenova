# Explicit Superadministrator Boundary

## Goal and Constraints

Implement the explicit privilege distinction required by the accepted optional
MFA design. No account is selected automatically and no existing user's role,
password, MFA setting or grant is changed. The absence of an explicit designation
must deny MFA administration, not promote all platform administrators.

## Architecture

Use deployment-owned `SUPERADMIN_USER_ID` containing one immutable local User ID.
It is not a username, email, OIDC subject or browser-supplied role. Resolve it
through existing ConfigService/environment validation. An eligible actor must
match that ID and the current database account must be active with an existing
platform administrator role. No schema migration or new role hierarchy is needed
for this boundary. Selecting the real account remains an operator action outside
this slice; leave the current environment unconfigured.

Ordinary administrators must not be able to take over the designated account by
changing its password, username, active state or external identity bindings, or
deleting it. Protect those existing mutation paths before any lookup/write that
could change the target. Do not restrict ordinary resource reads or unrelated
user administration. The designation never grants general administration to a
non-administrator.

## Task 1: Backend Boundary

- Independent worktree, feature commit separated from dirty integration baseline.
- Add `SUPERADMIN_USER_ID` validation: optional exact nonempty ID, no surrounding
  whitespace, maximum 256 characters; reject malformed configured values.
- Add one UsersService helper for checking the explicit active database identity.
  Reuse it for protected-account mutations and MFA administration.
- Write failing tests for ordinary admins, username `admin`, absent designation,
  wrong ID, disabled/demoted designated actor, and all protected mutation routes.
- Implement the guards and run focused UsersService/config tests plus build.
- `setMfaEnabled` remains fail-closed after authorization; do not turn it into a
  raw Boolean update. A reset requires fresh authentication, atomic credential
  destruction, version increment, session revocation and durable audit.

## Task 2: Integration Gate

- Review every UsersService identity mutation and config consumer.
- Run the focused tests and complete backend regression after integration.
- Keep local runtime designation absent, notifications disabled and frontend 3000.
- Document the explicit configuration and pending reset/step-up gate.
- Remove the feature worktree after verification; preserve its commit.

## Subsequent Reset Gate

Implement one-use, action/target/session-bound reauthentication proof for local
password and OIDC accounts before adding the reset UI. Enrolled administrators
must retain MFA assurance. Reset must lock actor/target identity and invalidate
sessions transactionally with audit; revoked proofs cannot be replayed. Do not
expose reset until real isolated database tests and browser flow pass.

## Lockout Guard Increment

Before reset work, reject deletion or deactivation of SUPERADMIN_USER_ID even by
its owner and even if another ordinary administrator exists. Existing
setUserState adapter must inherit the same guard. Name/password maintenance,
unrelated user management and unconfigured installations retain existing rules.
Unit RED/GREEN runs in the isolated superadmin-lockout worktree; main integration
owns rollback-only PostgreSQL acceptance covering actual unchanged user rows.
No real identity designation is introduced by testing.

## Rollback

Remove only this feature's configuration and guard changes if rejected. Do not
enable the existing Boolean MFA endpoint or mutate accounts as a workaround.

## Verified Integration (2026-09-19)

Integrated feature `40e5045`, not baseline `55ad7e4`. Focused config/authority
tests pass 59 cases after 21 observed failures. Integration build and all 110
backend suites pass (1068 tests, 3 skipped). `test/superadmin-postgres.cjs` uses
real local PostgreSQL inside a rollback-only transaction: ordinary administrator
takeover paths reject, the protected row stays unchanged, and disabled/demoted
designated actors are denied. MFA administration still returns 503 for an eligible
actor because reset/reauthentication support is not implemented.

Local API PID 24058 now runs this boundary, with SUPERADMIN_USER_ID absent and
notification delivery disabled. Port 3000 proxies unauthenticated MFA status to
401; the existing loop-read real-grant dashboard check passes. No real account
designation or mutation occurred. Worktree and dependency symlink were removed.

Operational designation must use the immutable database User ID of an active
admin/platform-admin account, placed in the protected deployment environment.
Do not supply a username/email or commit the environment file. Changing this
configuration requires a controlled API restart. This single-owner configuration
does not provide an in-app ownership transfer workflow.

Lockout increment `36d404c` now rejects deletion/deactivation of the designated
owner before any mutation, including legacy state requests. Real PostgreSQL
acceptance first failed because self-deletion succeeded with two administrators;
after integration it passes with the user row unchanged. The 42 authority tests
and backend build passed. Local API PID 31094 includes the fix; designation is
still absent and notifications remain disabled. Feature worktree was removed.
