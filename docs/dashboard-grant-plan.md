# Dashboard Namespace Grant Delivery

Scope: connect effective namespace grants to both global and explicit-cluster
overview without exposing cluster-wide workload, network, audit, alert or metric
data. Keep administrator behavior and the existing response contract compatible.
Do not mutate real users or deploy production.

1. Isolated `kubenova-dashboard-grants` backend slice owns dashboard controller,
   module, service and tests. Reuse AuthorizationService and live namespace UID
   resolution. Grants must be effective on each request; failed UID checks exclude
   scopes. Explicit inaccessible cluster requests fail closed.
2. Counts and topology resource inventory must constrain cluster AND namespace
   as pairs, not independent lists. Cache must not mix different scopes/users or
   preserve revoked scopes. Preserve administrator and legacy cluster access.
3. Data without trustworthy namespace identity (cluster metrics, audit entries,
   unscoped alerts) must not be disclosed to a namespace-only viewer. Return
   existing unavailable/degraded metadata instead of presenting fabricated healthy
   measurements. UI integration must respect those flags.
4. Main agent independently reviews browser consumption, source diff and focused
   tests. Test namespace pairs, direct/group grants, revocation/expiry, recreated
   UID, unknown role, explicit/global requests and legacy/admin compatibility.
5. Build integration before local reload. Keep notification delivery disabled.
   Verify on 3000, distinguishing mocked browser tests from live user acceptance.
   Integrate only bounded changes, remove verified isolated worktree, keep goal
   open for remaining network/storage/configuration and end-to-end gates.

Parallel boundary: backend slice and read-only frontend evidence review can run
together. Frontend corrections follow the reviewed API contract. Failed gates
leave the current runtime unchanged; no broad resets or permission widening.

Frontend slice in `kubenova-dashboard-display`: page.tsx and dashboard API
presentation helper/test. Existing metric metadata is authoritative: unavailable
or stale alert/health values render as unknown, not zero/healthy, everywhere in
the overview. Preserve available workload counts and do not mutate response data.
Use focused helper tests and an isolated mocked browser case on 3000 after build.
Backend and frontend own disjoint files; shared contract is existing
metrics.<name>.freshness/degradedReason, not a new authorization scheme.

## Acceptance 2026-09-18

Integrated backend af9f4f0 and the three frontend source/test files from c64c400.
The extra browser script from c64c400 was not integrated: it guessed a real
password. Instead extended existing dashboard-response-check.mjs, intercepting
all APIs without contacting real authentication. It failed on the old runtime
at the missing `active alerts --` state, then passed after local build/switch.

Verification: 102 backend suites, 888 passed and 3 optional skips; six frontend
metric tests; backend and frontend production builds; mocked browser malformed,
valid and namespace-restricted responses. Real read-only service validation via
test/dashboard-grants-local.cjs used loop-read's actual grant, live namespace UID
and PostgreSQL records, checking both global and explicit cluster stats and
foreign cluster denial. This created no sessions or records and is not a real
browser-login test. Semgrep is not installed; security verification here used
source review, authorization tests, and the real service check, not a scanner.

Both isolated worktrees removed after integration. Local frontend PID 91624
serves `.next-validation/standalone` on 3000; API PID 91639 serves current build
on 4000 with notification delivery disabled. Next build must use inactive
`.next-candidate`. User login acceptance and the wider goal remain open.
