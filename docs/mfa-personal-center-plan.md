# Personal MFA Enrollment Delivery

## Scope

Add self-enrollment to the existing avatar Personal Center entry. Keep system
settings limited to update management and AI configuration. MFA remains optional
for every role. No policy editing, administrator reset, real account enrollment,
production deployment or release is authorized by this implementation slice.

## Contract and Blocking UI Hazard

The authenticated status, password enrollment, OIDC enrollment prepare/exchange
and enrollment confirmation endpoints already exist. Confirmation atomically
enables MFA, increments authorization version and revokes every existing session.
It returns recovery codes only once.

The current shell redirects immediately when authentication becomes false, while
background requests and refresh can expire authentication. Rendering recovery
codes inside an ordinary authenticated page is therefore unsafe: successful
confirmation may redirect before the user can save them. Do not implement the
page without the recovery handoff gate below.

## Serial Delivery Gates

1. Add an in-memory recovery handoff to the auth owner. After successful
   confirmation, clear revoked local credentials and cached resource data but
   retain only the recovery result in an isolated completion view. Stop
   authenticated background traffic. Do not bypass authentication for resource
   routes. Reload intentionally loses the one-time result. Explicit completion
   clears it and navigates to login. Verify background 401, refresh races and
   a second-tab logout cannot hide an already delivered recovery result.
2. Implement Personal Center status, password reauthentication, authenticator
   secret entry, OTP confirmation and recovery completion using existing theme
   tokens and controls. Do not persist secret, token or recovery codes in browser
   storage, URLs, logs or analytics. Failed/expired confirmation requires restart.
3. Add OIDC reauthentication routing to the existing callback. A browser purpose
   marker is routing only, never authorization. Call the authenticated enrollment
   exchange, never ordinary login exchange. Preserve the original principal;
   handle missing session, wrong purpose and consumed transaction explicitly.
4. Mocked browser acceptance on port 3000: password and OIDC enrollment, expired
   session, confirmation failure, recovery handoff, reload, dark theme and mobile.
   Repeat isolated real HTTP/PostgreSQL/Redis acceptance; do not enable MFA for
   loop-read or alter its password. Build into the inactive Next output before
   swapping the local frontend.

## Parallel Boundaries

Use a dedicated worktree for frontend enrollment after the handoff contract is
approved by code review. Independent read-only review may examine backend
principal/session binding in parallel. Keep auth context, callback and shell in
one implementation slice because they share the recovery transition. Integrate
only the feature diff, verify it, then remove the isolated worktree and agent.

## Rollback

Hide the new personal enrollment entry if frontend acceptance fails. Preserve
backend enforcement for already-enrolled accounts; never restore password-only
access or undo unrelated changes in the integration tree.

## Evidence: 2026-09-19

Fresh test/mfa-http-postgres.cjs passed authenticated enrollment, session
invalidation, audit rollback, concurrent confirmation, recovery replay protection,
ordinary login, logout-before-confirm and OIDC handoff with provider double.
Isolated fixture cleanup passed; real users were unchanged. This is not browser
enrollment acceptance or a real Keycloak end-to-end test.

Implementation worktree: `kubenova-mfa-personal-ui`, branch
`codex/mfa-personal-ui`. Baseline snapshot `3195cc4` contains existing integration
frontend changes and must not be merged as a feature commit. Integrate only the
subsequent personal-center implementation diff.

Fresh baseline regression: 110 backend suites passed (1045 tests, 3 skipped).
Existing mocked-browser MFA login and OIDC challenge checks passed against local
port 3000. This protects existing login behavior, not the new enrollment UI.

## Integrated Personal Center

Feature commit `b79dbc9` integrated without its baseline commit. Personal Center
now provides password and enterprise-identity reauthentication, manual
authenticator setup, OTP confirmation and a one-time recovery view. The app-level
recovery gate unmounts authenticated consumers before confirmation, cancels
resource requests and preserves recovery codes only in auth-owned memory.

Build passed and frontend PID 13842 serves the candidate standalone build on
127.0.0.1:3000. The next build must use inactive `.next-validation`.
`scripts/mfa-enrollment-check.mjs` passed password enrollment, a delayed stale
refresh response, real second-tab local-storage events, credential/secret storage
absence, reload-to-login, authenticated OIDC callback selection, consumed and
missing-session/wrong-purpose rejection, rejected OTP secret removal and OIDC
prepare navigation. These browser tests mock all identity API responses; they do
not prove real Keycloak browser integration or enroll any actual user.

Mobile dark-theme acceptance initially failed: a later desktop breadcrumb rule
overrode the mobile minimum width and pushed the avatar beyond the viewport.
The shared mobile override was corrected. Fresh 390px browser acceptance passed,
and dark mobile setup plus desktop recovery screenshots were visually reviewed.
Existing MFA login/OIDC challenge browser regression passed again. Temporary
screenshots are removed after review.

Remaining: explicit superadministrator-only policy/reset, real Keycloak browser
acceptance and actual user acceptance. No release or production deployment.
