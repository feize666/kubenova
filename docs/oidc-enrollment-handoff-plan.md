# OIDC Reauthentication Enrollment Handoff

Existing provider supports purpose-bound fresh reauthentication; controller only
handles login. Passwordless users cannot currently begin MFA enrollment.

## Scope

Isolated auth worktree: authenticated reauthentication prepare/exchange routes,
live-session identity lookup, and pending MFA enrollment handoff. No user changes,
no administrator MFA policy, no UI rollout in this slice. Reuse existing provider,
transaction store, session repository and encrypted enrollment store.

## Security Gates

- Derive subject, user ID, session ID and authz version server-side. Never accept
  client authority fields. Bind original request time without trusting callback.
- Require same-origin browser POST, independent HttpOnly short-lived binding,
  no-store responses. Separate purpose from normal login; no new login issuance.
- Revalidate live session, current external identity and version before and after
  provider exchange; revoked/expired/changed identities cannot receive enrollment.
- Fresh signed auth_time and exact subject required. Consume transaction once;
  no reusable reauthentication grant in browser storage. Return only existing
  pending enrollment contract after successful exchange.
- Rate-limit start; generic errors, no secret logging. Preserve password flow.
- Tests: stale/revoked sessions, purpose mixing, changed external subject/version,
  wrong origin, replay, provider failure and positive pending enrollment.

Main reviews diff and tests, integrates without dirty-tree loss, builds and runs
real isolated Redis/PostgreSQL acceptance. Local API reload only after gates,
notifications disabled; no real account enrollment or production release.

## Baseline Revalidation

Real openid-client + local signed-provider + Redis test/oidc-provider.cjs passed
freshly: discovery/PKCE/nonce/audience/signature/expiry/replay, fresh auth_time,
original subject, and purpose/user/session/authz-version transaction isolation.
This proves provider baseline only, not new authenticated enrollment endpoints.
Backup/restore script safety checks also rerun successfully; real offsite storage
and application recovery remain unverified, not substituted by mocked shell tests.

Expanded real HTTP/PostgreSQL/Redis enrollment regression: begin enrollment,
logout, then submit the correct pending token/TOTP. HTTP 401 and no credential
or enabled flag verified. Full isolated MFA HTTP suite passed, fixture schema
and Redis keys cleaned; real accounts untouched. New OIDC handoff still pending.

## Source Integration

6d928bf feature patch integrated without baseline 3eaf05f. Build and 17 auth
suites (193 passed, 3 optional skips) passed. Real signed OIDC-provider/Redis
regression and isolated MFA HTTP/PostgreSQL/Redis regression passed separately.
These separate checks do not yet prove new OIDC enrollment HTTP handoff end to
end; add that combined acceptance before API rollout. Existing running API is
unchanged. Committed worktree removed, source recoverable from 6d928bf.

Frontend callback currently always calls completeOidc normal login exchange.
Enrollment UI must explicitly select authenticated enrollment exchange, retain
the original login session and keep returned pending secret only in memory.
Never infer authority from a browser purpose marker; server transaction checks
remain authoritative. No frontend entry should be enabled before this is wired.

## Verified Handoff

Feature 6d928bf integrated. Build, 17 auth suites, signed provider regression,
and expanded isolated PostgreSQL/Redis HTTP regression passed. The HTTP check
proves same-origin/auth guard, independent cookie, pending-secret response with
no new session, and revocation during exchange. API 86934 restarted locally
with notifications disabled. Browser UI/real IdP callback remains intentionally
unreleased pending a dedicated frontend flow and real provider acceptance.
