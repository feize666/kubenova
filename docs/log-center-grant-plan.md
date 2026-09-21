# Log Center Grant Integration

## Scope

Enable existing namespace-scoped log grants without widening platform roles,
changing real accounts, or exposing Elasticsearch configuration to readers.
Production deployment and release are out of scope until user acceptance.

## Delivery Gates

1. Backend query, isolated in `kubenova-log-grants`: reuse AuthorizationService
   and NamespaceIdentityService. A non-admin query requires an explicit namespace,
   its live UID, and the logs capability in the same effective grant. Require a
   configured namespace UID field and filter Elasticsearch by cluster, namespace
   name and UID. Missing metadata or unavailable identity must fail closed.
2. Metadata discovery: add a reader endpoint returning only source id/name. Keep
   endpoint, secret references and configuration restricted to administrators.
   Source availability must be checked against effective log grants, not role
   labels or cluster discoverability alone.
3. Frontend integration follows the backend contract: ordinary users can open
   the center, but must select an authorized namespace before querying. Replace
   the administrator configuration-list API; do not show configuration commands
   to readers. Preserve existing namespace context, theme and query cancellation.
4. Acceptance on local port 3000: positive grant, missing logs capability,
   foreign cluster/namespace, revoked/expired grant, recreated namespace UID,
   missing UID metadata, and administrator compatibility. Verify source responses
   contain no endpoint or secret fields. Actual Elasticsearch acceptance remains
   separate from mocked query and browser tests.

## Dependencies and Rollback

Backend query development can proceed while the main agent reviews source/UI
contracts. Metadata and frontend integration follow the reviewed backend gate.
Integrate only the bounded patch into the dirty main tree after focused tests;
never replace unrelated changes. Retire the isolated worktree after integration.
Do not reload current services until the relevant backend/frontend gates pass;
keep notification delivery disabled. A failed gate leaves the current runtime
unchanged and the goal open.

## Current Evidence

The source currently rejects all non-platform-admin queries before validation.
The UI uses the administrator observability configuration list and role-based
`canQueryLogCenter`; both need changing together with the backend, not simply
removing the administrator check. Existing log metadata has no namespace UID
field, so namespace-name-only historical queries are not safe for scoped grants.

## Integrated Local Checkpoint

Backend query/discovery and reader UI are integrated. The source configuration
form now exposes optional namespace UID mapping; it has no guessed default.
Non-admin query refuses sources without this mapping. Reader queries require an
explicit namespace and live UID grant; discovery returns only basic metadata.

Fresh validation: 102 backend suites passed (883 tests, 3 optional skips), backend
build passed, frontend build passed, and eight log API tests passed. The existing
browser script on port 3000 passed 11 mocked states with seven queries and no
page errors, including reader scope selection, denied query/source and resetting
to all namespaces. Inspected the dark 390px screenshot. This is not live
Elasticsearch or actual loop-read login acceptance.

Runtime: frontend PID 71698 serves `.next-candidate/standalone` on 3000; API PID
72361 serves the integrated build on 4000 with notification delivery disabled.
Build the next frontend candidate in inactive `.next-validation`, not the active
`.next-candidate`. Unauthenticated source discovery returns 401. Both isolated
worktrees have been integrated and removed; real users/grants were unchanged.
