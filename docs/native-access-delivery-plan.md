# Personal kubectl Access: Delivery Gates

Status: not implemented or accepted. Inspection date: 2026-09-19.

## Personal Kubeconfig Delivery (2026-09-20)

`GET /api/users/native-access` lists only the current active console user's
clusters which have an enabled configuration, matching ready/synced revision,
an effective `kubeconfig` capability and exactly one current external identity
binding for the configured issuer. `GET
/api/users/native-access/:clusterId/kubeconfig` applies the same checks and
returns a no-store attachment only after they pass.

The generated file uses a `kubelogin` exec stanza with the public
`kubenova-kubectl` audience, the configured issuer and the VPN gateway path.
It contains no access token, ServiceAccount credential, client secret,
certificate-authority data or identity subject. Each kubectl request still goes
through the native gateway for live grant and namespace verification.

The personal-center UI now lists only these eligible clusters and exposes the
download action. Backend acceptance includes negative cases for stale revision,
unbound identity, inactive account and missing capability. The candidate frontend
build and backend build passed; 25 focused backend tests passed. A local launchd
job serves the candidate frontend only at `127.0.0.1:3000`; profile routing
returned 200 and unauthenticated native list/download routes returned 401.
Browser verification stopped at the legitimate login redirect because no session
was fabricated. No native configuration is ready/enabled locally, no kubeconfig
was downloaded, and no live cluster or identity service was changed.

## Controlled Native RBAC Reconciliation (2026-09-20)

Native access configuration now carries `syncState`, `syncRevision`,
`syncMessage` and `syncedAt`. Saving any configuration resets it to `pending`;
a previously ready revision is never represented as current after settings change.
The additive local migration `20260920030000_native_access_sync_state` has been
applied only to the local database.

Platform administrators can explicitly invoke
`POST /api/users/native-access/:clusterId/reconcile`. It requires a live active
administrator session, an enabled native configuration, a server-owned kubeconfig
with verified TLS, and live namespace UID matches. It expands only current
effective grants carrying `kubeconfig`, applies owned namespace Role/RoleBinding
pairs, and records the exact configuration revision only after the whole pass.
Failures leave state `error`, never `ready`.

The cleanup pass removes only labelled KubeNova-owned stale pairs with live UID,
resourceVersion and namespace identity preconditions; it unbinds before deleting
the Role. Ownership conflicts or namespace recreation fail closed. It does not
enable clusters, generate personal kubeconfigs or make a remote cluster change
until an authenticated administrator deliberately invokes the endpoint.

Eight low-level sync/revocation checks, three reconciliation checks, the
configuration reset checks, an HTTP unauthenticated route check and a production
build passed locally. The live 3000 route now rejects a missing console token
with 401. No authenticated reconciliation has been attempted. Automatic job
scheduling, persisted per-pair history and real-cluster acceptance remain open.

## Gateway Service Composition Acceptance (2026-09-20)

`node test/native-gateway-service.cjs` passed in an isolated worktree and again
after integration. It runs the actual NativeGatewayService with signed RS256
tokens, an HTTP loopback JWKS issuer, the installed Kubernetes client, an
ephemeral trusted HTTPS Kubernetes fixture, real RBAC readiness and transport.
Discovery and PodList retrieval share one JWKS fetch; requests carry the expected
server-generated impersonation identity. Stream completion disposes the lease.
Foreign namespace, Secret access, missing RoleBinding, namespace recreation,
revoked grants and disabled identity stop before workload retrieval.

Persistence, identity/grant lookup, namespace resolution and notification delivery
remain controlled dependencies. This does not prove real PostgreSQL-to-OIDC-to-
Kubernetes acceptance, PKCE login, RBAC provisioning or kubectl usability. No live
account/session/cluster settings were changed. Test servers and certificates are
cleaned up by the test; the delivery worktree is removed after integration.

## Shared OIDC Verifier Runtime Checkpoint (2026-09-20)

Discovery and resource requests now share the cluster/revision-keyed OIDC
authenticator, preserving its remote JWKS cache. Identity mapping is still
checked per request; revision changes rebuild the verifier. Failed initialization
does not retain a rejected cache entry or remove a newer entry.

Fresh verification: six gateway service/controller tests passed, the signed-token
and real-JWKS transport check passed, and the control API build succeeded. The
local launchd API was restarted with that build. This is not positive end-to-end
kubectl acceptance and does not enable native access for any cluster.

## Real kubectl Discovery Compatibility (2026-09-20)

`KUBECTL_BIN=/opt/homebrew/bin/kubectl node test/native-kubectl-discovery.cjs`
passed with the actual client against an isolated loopback catalog fixture.
The check uses /dev/null kubeconfig and a disposable cache, queries api-resources,
and verifies exactly pods/deployments.apps. It exposed and fixed rejection of
client discovery timeout parameters; unrelated/duplicate queries remain denied.
Seven related tests and build passed. This is protocol compatibility evidence,
not positive OIDC, authorization-service or live Kubernetes acceptance.

## Native Discovery Routes (2026-09-20)

Native /api, /api/v1, /apis and supported group/version routes now return
Kubernetes discovery documents, intersecting persisted cluster API discovery
inventory with the implemented namespaced read allowlist and sensitive
capabilities. No Node/RBAC management APIs or write verbs are advertised.
The service checks enabled configuration, OIDC identity, effective native grants,
live namespace UID and owned RBAC before producing metadata. Resource requests
still authorize independently. No actual workload data is queried for discovery.

Seven catalog/HTTP/admission tests and builds passed. Full positive discovery
service integration and real kubectl acceptance remain pending; catalog freshness
depends on existing cluster discovery synchronization. No clusters enabled.

## Integrated Regression Checkpoint (2026-09-20)

After the group-membership expiry change, the full control-api Jest run passed:
129 suites, 1342 tests passed, 4 skipped. The real loop-read grant/live namespace
UID/scoped-dashboard check passed without creating sessions. The isolated
PostgreSQL -> Nest -> Go WebSocket revocation test also passed again with GO_BIN
enabled. These checks do not replace browser acceptance: loop-read-access.cjs
still cannot run because loop-read has no current unexpired login session.
Do not fabricate a session or broaden the account's grant to bypass that gate.

Next functional gate remains native discovery and PKCE/real Kubernetes route
acceptance; the general kubectl workflow is not complete. Broader console UI,
log-center ingestion, monitoring integrations and offsite backup acceptance
remain tracked by the master plan, not certified by this backend regression.

## Group Membership Expiry (2026-09-20)

Effective inherited grants now cap expiresAt by group membership expiresAt,
so native stream leases do not outlive membership merely because the grant is
unlimited. Direct grants retain their own lifetime. A regression first failed
with a null expiry, then passed with the membership deadline. Twenty-one related
authorization/native tests and API build passed; the local API was restarted.
This does not replace pending real OIDC/Kubernetes stream-expiry acceptance.

## Native Read Route Integration (2026-09-20)

Local full-app smoke test found the migration-owner/runtime-role distinction:
the locally created NativeAccessConfig table needed SELECT/INSERT/UPDATE/DELETE
for the existing `kubenova` runtime DB role. Granted locally; do not hardcode
this role into portable migrations. Deployments using a separate migrator must
grant new-table privileges to their configured application role. After this
fix, the local 3000 proxy returns Kubernetes Status 404 for an unconfigured
cluster, and missing bearer returns 401. No access has been enabled.

Added `/api/native/clusters/:clusterId/*` to the local control API. It accepts
GET only, uses the configured OIDC verifier and current identity mapping, checks
enabled/nondeleted cluster state and configuration revision, resolves effective
grants/live namespace UID, checks actual owned RBAC, and opens the revocable TLS
transport. No automatic RBAC application occurs. The response streams native
Kubernetes JSON without the console envelope; incoming impersonation headers
and upstream cookies are not forwarded. Generic failures do not expose upstream
URLs or credentials. Client disconnect cancels the transport.

Nine route/admission/lifecycle tests and API builds passed. No cluster is enabled.
This route is incomplete for general kubectl: discovery, exec upgrades, operator
writes/admission, provisioning and public PKCE acceptance remain outstanding.
Positive OIDC-to-real-Kubernetes route acceptance is not yet proven; do not
publish the personal download or mark the feature ready from these tests.

## Cluster Native Settings (2026-09-20)

Added NativeAccessConfig (cluster FK, disabled default, public issuer/audience/
JWKS/gateway URLs, optimistic revision, actor and timestamp) plus admin-only
GET/PUT /api/users/native-access/:clusterId. No client secrets or credentials
are accepted. Server validates endpoint trust, current active administrator and
live cluster; stale revisions return conflict. Save and AuthorizationChange
commit together, so settings changes wake existing authorization listeners.
Configuration does not assert readiness or apply Kubernetes RBAC.

Three focused tests, API build and isolated real PostgreSQL acceptance passed:
default disabled, role spoof/inactive-account denial, persistence, concurrent
stale-save rejection and atomic audit records. Migration applied/recorded only
in the local database; no cluster configurations created or enabled. UI,
gateway routing, public PKCE and end-user kubectl acceptance remain pending.

## Read-Only RBAC Readiness (2026-09-20)

`assertNativeRbacReady` now shares the synchronizer's live namespace/ownership
inspection and requires exact Role rules, RoleBinding subjects and roleRef.
Missing resources, drift or namespace recreation deny readiness without writes.
Twelve related tests, build and the real Kubernetes-client HTTP fixture passed,
including missing-before-apply, ready-after-apply and drift-after-apply checks.
This proves the RBAC prerequisite only. Cluster opt-in/provider settings,
persisted reconciliation state and public-route readiness integration are not
implemented by this function and remain delivery gates.

## Authorized Native Read Composition (2026-09-20)

`native-read.ts` composes bearer authentication, effective-grant/live-namespace
authorization, mandatory readiness checks, LISTEN lease registration, a second
identity/grant check and the HTTPS transport. Identity/revision/namespace/grant
changes or shortened expiry deny opening. The transport signal combines grant
revocation and caller disconnect; stream close or failed opening disposes the
lease. Impersonation identity is shared with the RBAC planner rather than
recomputed with another mapping. Four related suites (14 tests) and build passed.

This remains internal composition, not a public route. Readiness must be backed
by opt-in and actually applied RBAC state, never a no-op callback in production.
Unit tests double authentication/readiness/transport; real end-to-end native
OIDC-to-Kubernetes acceptance and route integration remain outstanding.

## Native Read Transport (2026-09-20)

`native-transport.ts` adds the internal HTTPS GET/list/watch/log transport. It
reuses request classification, denies exec on this transport, requires verified
TLS, keeps upstream addresses and credentials server-owned, replaces all
Impersonate-* headers with the hashed grant identity, denies redirects and
attaches the caller's revocable AbortSignal to the upstream request. Header
establishment has a ten-second timeout; streams require a bounded grant lease
from the caller. No browser headers or tokens are forwarded upstream.

22 classifier/transport tests and `test/native-transport-tls.cjs` passed. The
latter uses the real Kubernetes configuration client and an isolated HTTPS
server to verify CA trust, impersonation, API prefix preservation, aborting an
idle stream, redirect refusal and untrusted-CA denial before sending credentials.
No public native route is enabled. Readiness, lease integration, reconciliation
tracking, discovery, exec upgrades, PKCE and kubectl acceptance remain required.

## Local Runtime Activation (2026-09-20)

The notification migration is now applied and recorded in the **local**
127.0.0.1 k8s_aiops database. Both local launch agents enable
RUNTIME_PUSH_REVOCATION_ENABLED=true; control-api runs the console-next build,
and runtime-gateway runs the newly built binary. Notification delivery remains
disabled. Migration prerequisites and real LISTEN readiness passed; frontend
3000/login and gateway 4100/healthz return 200. Existing loop-read grant/live
namespace UID/scoped dashboard checks still pass without creating sessions.

Rollback artifacts are local: control-api plist .before-push-revocation and
runtime-gateway binary .before-push-revocation. To disable push, set the flag
false on **both** agents and reload them; polling remains the fallback. The
additive notification triggers can remain installed. Production is untouched.
Real authenticated loop-read browser/stream acceptance is still pending.
This activation supersedes older notes below saying flags/migration are absent.

## Native RBAC Desired State (2026-09-20)

`node test/native-rbac-http.cjs` passed using the installed Kubernetes client
against an isolated loopback HTTP API fixture. It verifies actual serialized
create/update/delete requests, UID/resourceVersion delete preconditions,
idempotency after model deserialization, unbind-before-update, and HTTP 409
leaving the binding absent. The fixture has no real credentials and permits
plaintext loopback solely for this test; production TLS behavior is unchanged.
This is client transport acceptance, not Kubernetes authorization/admission
acceptance, and does not mark the native feature ready.

`native-rbac-sync.ts` adds an internal single-pair synchronization primitive using
the installed Kubernetes clients. It checks the live namespace UID, validates
ownership of both existing objects before mutations, deletes the binding before
changing rules, uses UID/resourceVersion delete preconditions and resourceVersion
updates, and rechecks authorization plus namespace identity before binding.
Identical desired state is a no-op; failed updates do not restore the binding.
33 related tests passed using Kubernetes client doubles. No live cluster apply.
Persisted applied-state tracking, scheduling, cross-pair revocation ordering,
multi-worker coordination and disposable-cluster acceptance remain required;
this primitive is not yet an operational reconciler or readiness guarantee.

`auth/native-rbac.ts` now generates deterministic namespace Roles/RoleBindings
for server-resolved effective grants and matching live namespace names/UIDs.
It reuses the request classifier's resource allowlist. A native-enabled grant
must independently carry each sensitive capability: logs, exec and Secrets.
Bindings use a cluster/user-scoped hashed impersonation identity, never email or
client-supplied groups. No wildcard resources, ClusterRoleBindings or built-in
admin bindings are generated. Expired/revoked/foreign grants are omitted.

27 native classification/authorization/planner tests passed. The planner is not
an applier or public endpoint. Workload writes remain gated for every preset
until admission protection exists; this is unfinished functionality, not a
replacement for the accepted operator role. Reconciliation, gateway transport,
readiness, public PKCE and actual kubectl acceptance still remain.

## Current Revocation Evidence (2026-09-20)

This checkpoint supersedes the older test limitations below where noted:

Latest joint run: set `GO_BIN` alongside `DATABASE_URL` and `PSQL_BIN` when
running `test/runtime-watch-postgres.cjs`. It starts the actual Go LogsWS handler
against the real Nest controller with the production response-envelope
interceptor. The PostgreSQL commit closes the actual gateway WebSocket within
two seconds and cancels its idle upstream HTTP request. Signed token validation,
repository, LISTEN and gateway are real; grant/namespace lookup and Kubernetes
API remain controlled fixtures. The isolated schema, HTTP servers and child
process are cleaned up. This does not constitute live-cluster acceptance.

- `runtime-watch-postgres.cjs` now uses real signed runtime tokens,
  RuntimeSessionService and RuntimeRepository against an isolated PostgreSQL
  schema. Committed authorization-version changes close the HTTP stream;
  reuse of the old signed token returns HTTP 403. Grant and namespace identity
  lookups remain fixtures, and this test does not include the Go gateway.
- The same test closes the listener, obtains a new healthy listener through
  RuntimeInvalidationService, and verifies revoked credentials remain denied.
  Concurrent recovery is covered by `runtime-invalidation.service.spec.ts`.
  Recovery creates a new listener; old leases never resume.
- `authorization-invalidation.cjs` terminates only its uniquely named test
  PostgreSQL connection and verifies existing leases abort and new leases fail.
  This proves server-side disconnect handling, not silent network partitions.
- Gateway idle-log tests include push-only cancellation with polling deliberately
  returning active: WebSocket closure occurs within a two-second test deadline
  and the upstream idle HTTP request is canceled. Race checks passed.
- API build and 32 runtime tests passed. These changes remain local source;
  application migration and push flags are not enabled. Full database-to-gateway
  socket acceptance and actual Kubernetes integration remain outstanding.

Personal kubectl gateway implementation, PKCE provisioning and end-user native
access acceptance remain incomplete. No production deployment or publication.

## Database-to-HTTP Revocation Acceptance (2026-09-20)

`test/runtime-watch-postgres.cjs` passed with a disposable PostgreSQL schema,
actual notification migration, RuntimeInvalidationService, RuntimeService,
race-safe lease and Nest HTTP watch. Missing migration denies activation; after
installation, committing an authzVersion update closes the HTTP stream in under
two seconds, without waiting for the five-second polling interval. Runtime token
validation is doubled in this test; no live account, Go WebSocket or Kubernetes
stream is included. Test schema/listener/server and worktree cleaned up. The
application database migration/feature flags remain untouched. Next acceptance
must include real session validation and the gateway's actual client socket.

## Gateway Push Consumer (2026-09-20)

Go terminal/log handlers now establish the internal NDJSON subscription before
opening Kubernetes streams when RUNTIME_PUSH_REVOCATION_ENABLED=true. They pass
the existing shared secret and runtime token, require an active initial frame,
deny redirects, bound frame size, and close the Kubernetes context/client socket
on EOF, invalid frames or absent heartbeats. Initial establishment has a 5-second
deadline and heartbeat silence a 20-second bound. Existing periodic live checks
remain defense in depth. Notification delivery is event-driven; network failure
detection remains bounded, not literally instantaneous during a partition.

New actual HTTP tests and all gateway httpapi tests passed; targeted race-enabled
tests also passed. Independent worktree removed. No running gateway was replaced,
both feature flags remain disabled and application migration remains unapplied.
Still required: full DB-trigger -> Nest -> gateway -> actual WebSocket closure,
startup/readiness and reconnect/outage acceptance before local enablement. Native
kubectl proxy is a separate unfinished consumer, not supplied by console WS work.

## Internal Runtime Watch Endpoint (2026-09-20)

POST /api/runtime/internal/sessions/:sessionId/watch now reuses existing internal
secret/session validation and the race-safe lease. It emits an initial NDJSON
active frame and 10-second heartbeats, closes on invalidation, and disposes the
lease on HTTP disconnect/backpressure. Tokens remain in the POST body, not URL.
RuntimeInvalidationService lazily opens LISTEN only when explicitly enabled by
RUNTIME_PUSH_REVOCATION_ENABLED=true and both notification triggers exist in the
current DB schema. Missing prerequisites fail unavailable, not silently active.

31 runtime unit tests and API build passed. Actual Nest HTTP test verified ready
frame/no-store/EOF on abort and service-denial propagation (authorization service
doubled). This does not prove real session/DB-to-WebSocket cancellation. Existing
running services were not restarted, flag not enabled, migration not applied.
Go gateway consumer and reconnect/outage acceptance remain required.

## Runtime Registration Race Guard (2026-09-20)

createRuntimeAuthorizationLease reuses full RuntimeSessionService validation,
registers the user/expiry with AuthorizationInvalidation and then validates again.
A revoke missed before registration is caught by the second live check; a notify
received during that check aborts the lease. Validation errors dispose the lease.
Four focused unit tests and backend build passed; tests double validation and
notification dependencies. Independent worktree removed.

This helper is not a route and does not authenticate the gateway itself. The
future internal streaming controller must enforce its existing shared-secret
boundary, consume the lease signal, and close/dispose on client disconnect.
Go gateway subscription and actual socket cancellation are still not wired.

## PostgreSQL Notification Consumer (2026-09-20)

AuthorizationInvalidation now uses a dedicated pg LISTEN connection (pg 8.16.3
declared directly; Prisma has no persistent LISTEN API). It registers per-user
AbortSignals with expiry timers, cancels matching users or all users for a null
scope, filters database schema, and disables registration after connection
error/end/close or malformed notification. It does not silently reconnect and
resume old leases. Callers must register before final authorization and dispose
on exit; reconnect orchestration must create a new instance and reauthorize.

Real PostgreSQL notification acceptance passed for targeted/global cancellation,
expiry, explicit channel shutdown and denial of new leases. API build passed.
No mocks for database transport. Test connections closed; independent worktree
removed. Network-partition timing and server-side forced disconnect remain to
test. No runtime route/provider is wired yet and the notification migration is
not applied to the application DB. Consequently current console/kubectl streams
do not yet gain immediate cancellation from this helper. Gateway bridging and
actual socket-close acceptance remain the next required work.

## Transactional Invalidation Signals (2026-09-20)

Added migration 20260920010000_authz_notifications: User authzVersion/isActive
changes and AuthorizationChange inserts emit PostgreSQL NOTIFY after commit.
Payload contains schema and affected user only; null user means recheck all
streams (e.g. group-grant change), not ignore the event. No credentials or audit
reason are broadcast. Notifications are wake-ups, NOT a durable queue. Listener
disconnect must close streams and reconnect must reauthorize; audit state and
live grants remain authoritative.

Real psql LISTEN plus Prisma writes in a disposable schema passed: user-change
and group-wide wakeups arrive, rollback sends none. The test caught and fixed
PL/pgSQL record-field resolution across the two trigger tables. Schema and
listener cleaned up. Migration is not applied to the running application DB;
gateway subscriber and end-to-end cancellation remain outstanding.

Additional real-tool finding: psql treats PGDATABASE containing a postgres URI
as a literal database name in this environment. Existing backup/restore scripts
use that pattern and require correction plus real pg_dump/psql acceptance before
claiming backup readiness; tool-double tests had not exposed it.

## Revocation Transport Audit (2026-09-20)

Current source contradicts any claim that console streams already terminate
immediately: runtime-gateway/internal/httpapi/session_status.go checks status
every 5 seconds with a 2-second HTTP deadline. ws.go wires this to cancel and
close terminal/log sockets, but there is no pushed invalidation subscription.
UsersService commits authzVersion changes and AuthorizationChange audit records;
it does not publish live gateway invalidations. Existing polling tests prove
eventual rejection, not immediate termination. Native transport cannot inherit
an immediate guarantee from this mechanism.

Revocation delivery must cover BOTH console and native streams before final
acceptance. Required implementation boundaries:

- Commit account/grant/identity change plus durable invalidation intent in the
  same database transaction; cover group membership and grant expiry as well.
- Deliver invalidation to connected gateway instances after commit, with replay
  or reconciliation after disconnect. Audit rows alone are not a delivery queue.
- Register stream ownership before the final live authorization check; cancel
  both upstream and client sockets on affected user/grant/identity invalidation.
- Treat a lost invalidation connection as unsafe for continued privileged
  streaming; retain bounded status polling as defense in depth, not the primary
  immediate-revocation mechanism. Reconnect must reauthorize before new streams.
- Set token/grant expiry timers locally so natural expiry requires no write.
- Test commit-to-disconnect latency with actual HTTP/WebSocket sockets, concurrent
  stream open/revoke, delivery outage/reconnect and multiple gateway instances.
  Do not silently redefine immediate as the existing five-second poll interval.

This is an audited outstanding requirement, not a deployed fix. No real users,
sessions or Kubernetes resources were altered during this inspection.

## Scoped Native Authorization (2026-09-20)

`authorizeNativeRequest` connects classification to existing effective-grant and
live namespace UID services. It requires kubeconfig plus the requested optional
logs/exec/secrets capability on the same grant, rejecting cross-grant privilege
composition. Access carries contributing grant IDs, current authzVersion and the
earliest token/grant expiry for the future stream lifecycle. No platform-admin
bypass or legacy credential export is used. Namespace recreation denies access.

35 related unit tests and backend build passed, including missing native
capability, recreated namespace, separated capability grants and expiry. These
tests double grant/namespace dependencies; actual Kubernetes request acceptance
remains open. Independent worktree removed. No public route or deployment change.
Gateway transport must still recheck after registering revocation listeners and
close both ends on invalidation; this helper alone does not terminate streams.

## Request Classification Slice (2026-09-20)

`auth/native-request.ts` classifies explicitly supported namespaced GET/list/
watch paths and Pod log/exec subresources. Secret/log/exec capability requirements
are retained independently. It rejects normalization ambiguities before URL
parsing, duplicate/invalid watch values, unscoped resources, unknown APIs and
subresources, RBAC, service-account token minting and proxy paths. Workload writes
remain disabled until admission controls are delivered; this is an implementation
gate, not a reduction of the eventual operator capability requirement.

20 classification tests passed after initial failing cases; backend build passed.
Independent worktree removed. No route exposed or runtime restart required.
Still missing: discovery responses, grant/live namespace UID enforcement, header
sanitization, transport and immediate stream cancellation. A classified request
is NOT authorized. Gateway must use the exact validated path without rewriting
it, and never forward user impersonation/authentication headers.

## Live Identity Binding (2026-09-20)

`createNativeAuthenticator` now verifies the signed token then reuses
OidcIdentityRepository.resolve on every invocation. Only immutable issuer/subject
mapping to an active account is accepted. Output is identity, token expiry,
userId and current authzVersion; token email/role cannot provision or elevate an
account. Cached signing keys do not cache identity or account status.

`test/native-identity-postgres.cjs` passed against an isolated random PostgreSQL
schema with real RSA-signed JWT and local JWKS HTTP server. Unbound subject with
a matching email denies; explicit identity binding succeeds; disabling the user
denies the same token; current authzVersion is reread; deleting the binding denies
again. Fixture schema and HTTP server removed. Native signature regression and
API build also passed. Independent worktree removed, feature diff integrated.

No route is enabled and no local service restart was needed. This establishes
authentication, not request authorization or active-stream termination. Next:
Kubernetes request classification, effective-grant checks and gateway transport.

## Bearer Verification Slice (2026-09-20)

Added `auth/native-bearer.ts`: one verifier per server-configured provider,
bounded cached remote JWKS, explicit asymmetric algorithms, issuer/audience and
mandatory subject/iat/expiry validation, authorized-party checks for multiple
audiences. HTTPS is required except loopback test endpoints; JWKS must share the
issuer origin. No endpoint is taken from token claims or request headers. Existing
installed jose 6.2.12 is now declared as a direct pinned dependency (one lockfile
line; no dependency tree upgrade).

`node test/native-bearer.cjs` passed with real signed tokens and a local HTTP JWKS
server: matching identity succeeds; other signature/issuer/audience, expiration,
missing subject/expiry, future issue/not-before, invalid expiry range, mismatched
authorized party and malformed token fail. API build passed. Temporary JWKS
server and independent worktree were removed. No public route or running service
was changed; this verifier alone does NOT grant cluster access.

Next gate remains live ExternalIdentity/account binding on every request, then
request classification, grant checks and revocation-aware transport. Existing
OidcIdentityRepository.resolve can provide active account lookup; do not cache
that result or substitute browser sessions. Actual Keycloak/kubectl and proxy
acceptance remain unimplemented. No production release.

## Architecture Decision (2026-09-20)

The accepted immediate-termination requirement rules out direct API-server OIDC
as the primary personal-access path. VPN describes network reachability, not
authorization enforcement. Personal kubeconfigs must point at a VPN-reachable
KubeNova access gateway. The legacy administrator export stays separate and
must not be relabelled personal access.

```text
kubectl + public OIDC PKCE exec plugin
    -> TLS access gateway / cluster-specific API endpoint
    -> verified issuer, audience, signature, expiry and immutable subject
    -> active identity/account + current effective grant + live namespace UID
    -> Kubernetes API using server-side credential and explicit impersonation

disable / unbind / revoke / expire
    -> authorization revision invalidation
    -> deny new requests + cancel associated upstream/downstream streams
```

No browser/client may supply trusted Impersonate-* headers, upstream addresses,
cluster credentials, audiences or subject mappings. Strip such headers and
derive the cluster from a server-owned route. Do not implement an arbitrary URL
proxy. Every Kubernetes request, including discovery, watch, logs, exec and
subresources, needs an explicit classification; unknown paths deny by default.
Allowing workload writes also needs the admission boundary described below.

Reuse the control API's ExternalIdentity mapping, AuthorizationService and live
namespace UID resolver. Current OidcProviderService validates authorization-code
callbacks using openid-client; it does NOT authenticate an arbitrary kubectl
bearer token. Add separate bearer verification against configured issuer/JWKS
and a dedicated public-client audience, using the installed OIDC/JWT library,
without routing native requests through the browser callback or making console
session tokens valid OIDC tokens. Never decode without signature verification.

The runtime gateway already brokers console terminal/log streams but is not a
Kubernetes API proxy. Reuse its lifecycle/revocation transport where compatible;
do not claim WebSocket terminal support proves kubectl SPDY/WebSocket upgrades,
watch cancellation or kubectl discovery. Bind each native stream to user,
identity, cluster, namespace UID, grant IDs and authorization revision. Register
the stream before the final authorization recheck to close the revoke/open race.
An unavailable authorization/revocation channel fails closed; cancellation must
close both stream ends. Polling or short token expiry alone does not satisfy
immediate termination.

### Revised Implementation Order

1. Bearer verifier and account binding, independent of public routes. Prove
   wrong signature/issuer/audience, expiry, missing subject, disabled account and
   removed identity deny, using signed tokens and real JWKS HTTP fixtures.
2. Kubernetes request classification and scoped authorization. Prove encoded
   path/separator ambiguity, unknown subresources, impersonation injection,
   cross-cluster/namespace requests, Secrets and logs/exec deny correctly.
3. Revocation-aware gateway transport and owned impersonation RBAC. Prove
   disconnect on revoke/disable/unbind/expiry, open/revoke races, upstream errors,
   discovery, watch and both supported streaming protocols in a disposable cluster.
4. Per-cluster readiness and public PKCE client provisioning instructions. Only
   enable after gateway TLS, RBAC/admission and revocation checks pass. No client
   secret or stored cluster credential in generated kubeconfig.
5. Personal download/UI and actual kubectl + Keycloak acceptance. Test exact
   namespace/capability allow-deny and active-stream termination. Publish nothing
   before user acceptance.

The earlier direct-API readiness/reconciler ordering below is superseded by this
gateway order. Pure RBAC planning still applies to gateway impersonation, but
must not enable a direct bypass. Current code inspection establishes this gap;
no native gateway, bearer verifier or personal download is implemented yet.

## Verified Starting Point

- `clusters.controller.ts` protects `:id/kubeconfig/export` with
  `assertClusterAdmin`. Preserve that boundary.
- `clusters.service.ts:exportReadonlyKubeconfig` creates a cluster-specific
  ServiceAccount, ClusterRoleBinding and temporary token. It is an existing
  administrator export, not an individual OIDC identity or namespace grant.
- Grant creation accepts the `kubeconfig` capability, but this alone does not
  implement personal download, API-server OIDC configuration or reconciliation.
- Console OIDC uses a confidential client. Never put its secret, the registered
  cluster credential or an administrator ServiceAccount token in personal files.

## Contract

Personal access stays opt-in per cluster AND per effective user grant. Download
requires a live account/session, an exact bound issuer/subject, the capability,
and verified cluster readiness. A capability is necessary, not sufficient.

Use a separate public authorization-code/PKCE client and a standard kubectl OIDC
exec plugin. The configuration contains API address, CA, public client ID, issuer
and context only. It contains no bearer token or client secret. Verify plugin
availability explicitly; do not install binaries from a downloaded kubeconfig.

Each cluster must record the API-server audience and actual username claim/prefix
mapping. Bind Kubernetes User subjects to immutable OIDC subjects, never email,
display names or arbitrary claims supplied by a browser. Console groups are
expanded by the server into effective grants; do not trust provider group names
as an implicit Kubernetes administrator grant.

Namespace grants create namespace RoleBindings, not ClusterRoleBindings. The
namespace UID must match the grant so namespace recreation cannot resurrect
access. Never map a preset to wildcard resources/verbs or the built-in admin
role. Explicit logs/exec/Secret capabilities remain separate. Workload write
roles need an accepted admission boundary because Pod creation can assume a
ServiceAccount or mount a Secret without directly reading that Secret.

## Ordered Slices and Acceptance

1. Readiness model and read-only API: disabled/unconfigured/unsupported/pending/
   ready/error states, exact issuer/audience/CA validation and provider-specific
   unsupported reasons. No cluster mutation. Tests must prove that a grant alone
   cannot mark a cluster ready. UI uses existing access-control components.
2. Pure RBAC planner: consume effective grants and pinned namespace identities;
   generate explicit rules and subject bindings with deterministic owned names.
   Tests cover every preset, capabilities, group union, expiry, namespace UID
   mismatch and denial of wildcard/escalation permissions. No remote apply.
3. Reconciler: opt-in apply only to labelled KubeNova-owned resources; compare
   ownership and resourceVersion, fail on collisions. Persist desired/applied
   revisions and failures. Remove revoked owned bindings before adding rights;
   retries must not report success or readiness prematurely. Test collisions,
   partial failures, concurrent grant changes and idempotency in a disposable
   local cluster before any user-cluster rollout.
4. Personal download and UI: require the checks above and current applied
   revision; no-store response and audit without credentials. Negative tests
   cover ordinary viewer, foreign cluster, unbound identity and stale revision.
5. Real kubectl acceptance: public PKCE login against local Keycloak, exact
   namespace allow/deny, Secret/log/exec capability checks, grant revocation,
   identity unbind and account disable. Never use the administrator export as
   evidence for personal access.

Slices 1 and the pure planner can use separate worktrees once their shared
contract is fixed. Reconciliation precedes download enablement. Each feature
commit is integrated only after its scoped tests; remove its owned worktree
after integration. Existing user worktrees and changes remain untouched.

## Revocation Constraint

Deleting RBAC bindings prevents subsequent authorization after API-server cache
propagation. It does not terminate an already established direct kubectl exec or
log stream, and OIDC logout does not immediately invalidate a signed ID token.
Do not claim instant termination for direct VPN API access. Console sessions and
gateway streams retain their existing revocation behavior. If the accepted
instant-termination requirement includes native streams, direct API access must
remain disabled until a revocation-aware access proxy is delivered and tested;
short token lifetime alone is not a substitute.

## Rollback and External Gates

Default disabled; additive settings only. Revert application enablement without
deleting foreign RBAC or changing API-server flags. Real cluster OIDC/admission
configuration and VPN reachability require separate verified readiness. No
production change or publication is authorized by this plan.
