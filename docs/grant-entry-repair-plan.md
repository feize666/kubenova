# Grant-Aware Workspace Repair

User acceptance: loop-read must see vke-test, enter its workspace, and read only
authorized namespace ai. Existing explicit exec is preserved, not silently
treated as read-only. No password reset or production deployment is authorized.

1. Shared effective-grant lookup: direct and group grants, active membership and
   group, role validation, time bounds, revocation, non-deleted cluster and explicit
   namespace UID. Unit and actual PostgreSQL evidence required.
2. Route audit in independent worktree: map list/detail/dynamic/legacy endpoints,
   identify exact scope enforcement sites and bypass paths. Read-only audit.
3. Connect cluster discovery to effective grants without treating a namespaced
   grant as a legacy cluster-wide binding. Enforce namespace restrictions at
   resource fetch boundaries, including unfiltered and direct-ID requests.
4. Align namespace selector and workspace entry with effective scope. Keep
   mutation and logs/exec/secret capabilities independently checked.
5. Build and reload locally, test port 3000 with loop-read's existing session;
   verify allowed namespace, different namespace/cluster, resource detail and
   permissions. Password-based login remains a separate credential-dependent gate.

Rollback: retain existing grants/accounts, do not manufacture legacy bindings;
retain previous local build. No release until user acceptance. Schema restoration
has already resolved the missing legacy-table 500 independently of this work.

Progress: shared `AuthorizationService.listEffectiveGrants` now powers both
scope discovery and individual authorization, preserving grant boundaries rather
than merging role/capability combinations. Eleven focused tests and backend build
pass. Actual local PostgreSQL lookup for loop-read confirms exactly one effective
viewer grant with namespace ai. This is not yet connected to workspace entry;
do not claim the visible issue resolved. No runtime restart or grant mutation.

Next source increment: cluster listing/detail now use a distinct discovery check;
legacy resource-wide assertCanRead remains unchanged. Namespace-grant detail
skips node inventory rather than leaking cluster-scoped resources. Namespace
listing now receives the actor and filters cluster/name/live UID before paging
and counting. Integrated e005e19 and removed its clean worktree. Six focused
suites / 78 tests and backend build pass. Not reloaded yet: workload resource
scope enforcement and full local HTTP/browser acceptance remain outstanding.

Local delivery: regression `test/loop-read-access.cjs` first failed against the
old runtime with an empty cluster list. Restarted only local control API (PID
86629), preserving notification delivery disabled. The same existing loop-read
session now passes through port 3000: exactly vke-test visible, cluster detail
accessible with no node inventory, namespace list exactly ai. No password was
read/reset and no session/grant was created. This does not prove password login,
rendered browser interactions, workload resource scope or mutations; those gates
remain open. Workload controller/service scoping is delegated in isolation.

Expanded actual HTTP acceptance reproduced unauthorized namespace rows in the
old workload list (read-only requests; no resource mutation). The regression now
covers explicit cluster and unfiltered lists, the v1 legacy kind alias, and direct
access to a known out-of-scope workload ID. This is an open security defect until
the delegated workload enforcement is integrated, rebuilt and rerun successfully.

Workload delivery: integrated d84f247; reviewed the legacy mutation branch to
retain platform-role restrictions, and preserve independent grant role decisions.
Full backend build passes. Regression: 93 suites, 787 passed / 2 optional Redis
tests skipped. Restarted local control API PID 95653 with notification delivery
disabled. `DATABASE_URL=<local> node test/loop-read-access.cjs` now passes all
read-only HTTP assertions through port 3000: exact cluster and namespace, allowed
workload detail, explicit/unfiltered/legacy lists limited to ai, other namespace
and cluster empty, out-of-scope actual record ID denied. No grants, passwords or
resource mutations changed. Browser visual acceptance and other domains remain
open; this is not full platform authorization completion.

Drawer route follow-up: actual frontend uses `/api/resources/:kind/:id/detail`.
The live acceptance test reproduced 404 there despite workload detail succeeding.
Opaque workload scope resolution now returns the database namespace; grant-only
drawer callers require its live UID and grant decision before fetching detail.
Legacy resource access remains unchanged; kinds without verified namespace scope
remain denied rather than being widened. Three focused suites / 46 tests and
build pass. Restarted local API PID 98444; expanded loop-read HTTP acceptance now
passes including the real ReplicaSet drawer endpoint. No resource mutation or
credential changes. Dynamic/YAML and non-workload detail kinds still need scope
integration and rendered-browser acceptance remains open.

YAML read increment: grant-only callers use kind metadata to reject cluster-wide
resources even when a namespace is supplied. Namespaced YAML and drawer reads
share live UID authorization; Secret requires the explicit secrets capability
regardless of the legacy feature flag for these callers. Three new test cases
failed before wiring, then both focused suites passed (36 tests); build passed.
Local control API restarted PID 4514 with notification delivery disabled.
Expanded real loop-read HTTP test passed through port 3000: authorized workload
YAML returned successfully, while Secret and Node YAML requests returned 403
before resource lookup. No live resource writes or account changes were made.

Dynamic detail source increment: grant-only requests must first pass cluster
discovery, then use the API-discovered resource kind and namespaced flag before
live namespace UID authorization. A client-supplied namespace cannot turn a Node
into a namespaced resource, and discovered Secret kinds require secrets access.
Existing cluster-wide paths retain their checks. Three focused suites / 44 tests
and backend build pass; this increment is not yet loaded into the running API
and real dynamic-resource acceptance remains pending.

Dynamic local acceptance: expanded loop-read test first reproduced the old
runtime's 404 on an authorized ReplicaSet dynamic detail. Full backend regression
passes 94 suites / 794 tests (2 optional Redis checks skipped). Restarted local
control API PID 9017, notification delivery disabled. Through port 3000 the same
test now passes: actual ReplicaSet dynamic detail returns kind/namespace as
expected, and Node/Secret dynamic reads return 403 despite supplying namespace ai.
Prior cluster/workload/YAML isolation assertions also pass. No cluster resource,
account, session or grant was created or modified by these read-only checks.

Runtime capability integration: legacy access denials (403/404 only) now evaluate
explicit namespace capabilities even with enforcement flag disabled. Exec is
independent of resource mutation permission. Database/infrastructure failures do
not trigger grant fallback. Local API PID 11892 includes this change; notifications
remain disabled. Backend build and 95 suites / 796 tests passed; subsequent focused
runtime/log regression passed 4 suites / 15 tests including infrastructure failure
and stream-denial checks.

Expanded loop-read HTTP acceptance includes log-query/stream denials and terminal
denial outside the granted namespace. This new increment could not run because
the existing loop-read session is no longer active; no session was fabricated and
no password was reset. Earlier cluster/workload HTTP acceptance passed against
PID 11892. Rendered acceptance remains unverified (locked Mac/browser connection
failure). The Nest Socket.IO gateway is a skeleton, not proof of the actual runtime
data plane; locate the active terminal/log transport before claiming long-lived
stream revocation or terminal end-to-end completion.

Transport audit: actual frontend runtime uses the Go runtime-gateway. Its terminal
and logs handlers fetch bootstrap once and set a token-expiry deadline, but do not
yet call the existing control-api session status endpoint while streaming. Thus
immediate long-lived stream revocation remains an explicit delivery gap.
Real PostgreSQL authorization integration passes all eight lifecycle groups after
correcting an outdated test that expected profile editing to change roles. The
test now proves role escalation is rejected without changing authorization state,
and password/username/disable changes invalidate sessions. All fixture writes roll
back; real accounts and grants are unchanged.

Go runtime increment: integrated fd2ff15 (isolated worktree, reviewed helper) and
wired status checks into terminal/log handlers before upstream startup and every
5 seconds thereafter (2-second request timeout). False/malformed/error/redirect
responses fail closed; invalidation cancels context and closes the websocket before
any writes. Normal log disconnect now cancels upstream, verified by a test that
failed before the fix; terminal message pump also cancels on exit. Full Go race
suite and binary build pass. Local gateway replaced PID 2023 with PID 32739 on
4100; healthz passes. Worktree removed after clean-status verification; helper
commit retained. No production deployment. Real cluster streaming/browser tests
remain pending, and polling gives an approximately 7-second detection window,
not zero-latency revocation. Grant/membership natural expiry without authzVersion
changes still requires live grant revalidation; do not mark authorization complete.

Live runtime grant increment: shared signed-session validation now rechecks the
current user's legacy cluster role or effective namespace capability, using live
namespace UID. This applies to bootstrap and repeated status checks, so natural
grant/membership expiry no longer depends on authzVersion being incremented.
Three RED tests reproduced expiry/recreated namespace/removed capability access;
all now pass. Real PostgreSQL transaction tests prove group and grant expiry
invalidate an otherwise valid signed session without changing authzVersion, with
fixtures rolled back. Full backend suite: 96 suites, 802 passed, 2 optional skips;
build passes. Actual long-lived Kubernetes/browser interaction remains pending.

WebSocket transport acceptance: full Go race suite now includes real local HTTP
and WebSocket servers plus client-go reading an idle mock Kubernetes log stream.
After revocation or status HTTP 503, both websocket and upstream HTTP request close
without any log output. A RED transport-error test also reproduced runtime-token
exposure in bootstrap error URLs; error wrapping is now sanitized and GREEN.

Deployment correction: the earlier claim that gateway PID 32739 loaded the new
binary was wrong. LaunchAgent automatically restarted old binary PID 32725, and
32739 exited due to port conflict. Updated the actual managed binary atomically,
preserving rollback binary at /tmp/kubenova-runtime-rollback.scVwic/runtime-gateway,
then launchctl kickstart. Current listener PID 39369 is the managed service; its
installed binary SHA256 matches verified build
947407f11e62b417f96ffef4c9abe8bcba4da153b5b86673ca6d7e7c78780c8b.
readyz passes; backend listener PID 36467 is the current build. Real Kubernetes
cluster interaction and browser acceptance still remain, not implied by mock
transport tests. No production services were updated.
