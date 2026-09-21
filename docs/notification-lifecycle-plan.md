# Notification Lifecycle Implementation Plan

Goal: ingest real Alertmanager firing/resolved events and deliver cluster-owned
notifications with durable records, deduplication, bounded retries and recovery.
Spec: console-next-plan.md, stage 5. Local acceptance only; no remote changes.

## Contracts

1. Authenticated cluster ingestion; never trust a payload cluster label. A
   dedicated per-cluster receiver credential must be revocable and stored hashed.
   Existing platform login tokens are not permanent webhook credentials.
2. Alert occurrence identity is cluster + fingerprint + startsAt. A resolved
   occurrence never reopens when an older firing message is replayed. New startsAt
   creates a new occurrence. Duplicate firing/resolved requests enqueue nothing.
3. Validate the entire bounded request before writing. Reject malformed timestamps,
   unknown status, absent fingerprint, oversized labels/annotations and >100 alerts.
   Top-level group status never overrides individual alert status.
4. Persist occurrence change and per-channel delivery intent in one PostgreSQL
   transaction. Unique occurrence/status/channel key prevents duplicate intents.
   Resolve-first events persist as resolved but do not send unsolicited recovery
   notifications where this platform never observed firing.
5. Worker claims pending rows with a lease; crashed leases are reclaimable. Dispatch
   outside transactions. Delivery has pending/sending/sent/failed/expired states,
   attempts, nextAttemptAt, expiresAt and sanitized error, never credentials.
6. HTTP acknowledgement means channel accepted, not that a human read the message.
   Network ambiguity permits at-least-once delivery, never claim exactly-once.
   No redirects. Timeout remains bounded. Disabled/deleted channels cancel work.
7. Recovery notifications use the same occurrence and only channels selected for
   its firing intent. Do not send recovery ahead of an unresolved firing delivery;
   cancel obsolete pending firing and recovery together when no firing was sent.
8. SMTP uses a proven transport, environment/secret-backed credentials and TLS;
   no hand-written SMTP. Webhook JSON templates are parsed before substitution,
   and interpolated values are serialized safely. Unknown placeholders are rejected.

## Tasks And Gates

- [ ] Receiver configuration and auth: schema/migration, admin rotation endpoint,
  bounded payload validation, wrong-cluster/revoked/missing secret tests.
- [ ] Ingest + outbox: occurrence uniqueness, transaction rollback tests,
  repeated/concurrent firing and resolved tests using real PostgreSQL. Keep
  MonitoringAlert as the existing list model, linked to the occurrence.
- [ ] Sender + worker: share existing channel acknowledgement checks; add safe
  template rendering; test lease reclaim, retry cutoff, ordering and disabled
  channels against a local HTTP receiver. Add SMTP transport and local mail sink.
- [ ] Admin UI: receiver setup, secret shown once, channel configuration and
  delivery history under cluster monitoring, with masked credentials and existing
  blue/white/dark components. No standalone Pod logs/terminal navigation.
- [ ] Acceptance: local 3000 browser and authenticated HTTP paths; real firing,
  duplicate suppression, recovery, transient failure, expiry and secret rotation.

## Execution Boundaries

Receiver/transaction work owns monitoring lifecycle service/controller and additive
Prisma models. Sender work owns rendering and transport functions only, until the
outbox contract is integrated. Root owns integration, migrations and runtime.
No worker changes live clusters or publishes. Existing null-owned notification
templates remain platform-owned. Back up local DB before migration, preserve
rollback artifacts, and never build into the active frontend output directory.

## Current Evidence

2026-09-18: source inspection shows MonitoringAlert has no create/upsert producer;
only manual resolution updates it. Notification configuration is cluster-scoped,
but delivery remains a manual channel test. No outbox exists. This plan does not
mark any lifecycle requirement complete.

Sender foundation: manual channel testing now uses a shared JSON renderer instead
of raw string replacement. It preserves types/keys, escapes quote/newline content,
does not recursively interpret substituted text, rejects unknown placeholders and
dynamic keys, and bounds template size, nesting and expansion before allocation.
64 focused renderer/channel/scope tests pass. This source change is not yet loaded
into the local runtime. Receiver/outbox/worker and SMTP remain unimplemented.

Input foundation: added `parseAlertmanagerInput` with bounded batches, maps and
payload bytes, strict timestamp calendar validation, per-event firing/resolved
status and recovery ordering checks. It returns no authoritative cluster identity;
labels remain untrusted metadata. Fourteen parser tests and backend build pass.
Implemented in independent `codex/alertmanager-input` worktree, integrated, then
removed the clean temporary directory; commit 121ae66 remains recoverable. This
parser is not yet wired to a receiver endpoint and does not ingest/store events.

Receiver credential foundation: admin-only rotate/disable routes implemented at
`/api/monitoring/clusters/:clusterId/receiver`, with POST `rotate` and DELETE root.
Random 256-bit tokens are returned once with no-store; only SHA-256 hashes persist.
Authentication rejects wrong-cluster, disabled, rotated and soft-deleted-cluster
credentials. Eight focused tests pass and backend builds. Dedicated worktree
integrated and cleaned (commit 7b6e85f). Additive migration
`20260918010000_alert_receiver_credential` is NOT applied and the runtime has NOT
been restarted; do not claim these routes are locally available yet. Credential
audit records, real database/HTTP verification, receiver ingestion and UI remain
required before receiver completion. Never return a successful webhook response
until events and their delivery intents commit transactionally.

Local verification follow-up: backed up local PostgreSQL to restricted directory
`/tmp/kubenova-receiver-backup.ULSphl`, then applied the single pending receiver
migration. Real database test `test/alert-receiver-postgres.cjs` passes rotation,
hash-only storage, disable, cross-cluster denial, deleted-cluster denial, cascade
and full fixture rollback. Full backend suite: 82 suites / 635 tests passed.
Restarted local backend PID 79613; port-3000 readiness returns ok and unauthenticated
receiver rotation returns 401. No real receiver was created in user clusters.
These results supersede the earlier not-applied/not-restarted note, but do not
prove authenticated HTTP credential creation, durable audit or webhook ingestion.

Credential audit increment: rotate and disable now commit AuditLog records in the
same transaction as credential mutation, with actor ID, cluster and action only.
Nine focused tests and backend build pass. Real PostgreSQL integration verifies
audit rows and injected audit failure rollback for creation, rotation and disable;
the original credential remains usable on failure. Test-owned temporary cluster
and audit rows were cleaned. This increment is built but not yet loaded into the
running backend; webhook ingestion/outbox and authenticated HTTP tests remain open.

Live HTTP gate: `test/alert-receiver-http.cjs` initially reproduced 500 on rotation.
The local migration role (beidou) owned the new receiver table, but the runtime
role (kubenova) lacked table privileges. Granted SELECT/INSERT/UPDATE/DELETE only
on AlertReceiverCredential to that runtime role; do not apply broad grants.
Restarted backend PID 82848 with the audit-enabled build. Real requests via port
3000 now pass admin login, unauthenticated rejection, no-store rotation, prior
token rejection, disable, and persisted actor audit. Test-owned cluster and audit
records were removed. Migration acceptance must check runtime-role privileges,
not only successful migration under the owner role. No production changes.
Webhook ingestion/outbox, delivery worker, SMTP and receiver UI remain incomplete.

Ingestion/outbox increment: added authenticated POST receiver/alerts and atomic
MonitoringAlert + NotificationDelivery persistence. Cluster credential row locking
serializes batches against rotation; the token is rechecked under lock. Occurrence
identity uses cluster/fingerprint/start time. Recovery does not reopen on stale
firing replay, and resolve-first observations enqueue no recovery. Enabled cluster
channels are snapshotted as IDs; recovery reuses firing channel IDs. No worker is
registered yet, so pending rows are not sent. Local additive outbox migration
applied after backup `/tmp/kubenova-outbox-backup.nnI2bE`; runtime role granted only
the new table CRUD privileges. Real PostgreSQL tests cover concurrent duplicates,
firing/recovery, stale replay, resolve-first suppression and outbox failure rollback.
Build passes. HTTP route is compiled but not yet loaded/tested in runtime; this
does not complete the delivery lifecycle or justify a production release.

HTTP ingestion verified: restarted local backend PID 87308 and extended
`test/alert-receiver-http.cjs` through the frontend proxy on port 3000. Real admin
login/receiver rotation and dedicated bearer ingestion pass. Invalid events return
400; rotated/disabled tokens return 401; duplicate firing changes zero rows;
recovery persists resolved state and two pending delivery intents; stale firing
does not reopen it. Tests use a temporary disabled cluster and never send network
notifications; all fixture alerts/outbox/channels/credentials/audits are cleaned.
This supersedes the route-not-loaded note above. The sender worker, recovery
ordering, retry/expiry, SMTP and UI acceptance are still not implemented/proven.

Transport integration foundation: ObservabilityService.sendNotification now accepts
actual title/message data. The existing authenticated test method delegates to it,
preserving five-second timeout, no redirects, safe JSON rendering and vendor
acknowledgement handling. Real-content test failed before the extraction; 26
transport/channel tests and backend build pass. The method is internal service
code, not a new unauthenticated sending route. Worker consumption remains pending;
this source change is not yet loaded in the local runtime.

Worker foundation: NotificationWorker.runOnce(clusterId) atomically claims one row
using SKIP LOCKED, fences completion by attempt number and reclaims expired leases.
It enforces expiry, a five-attempt limit, bounded backoff, channel/cluster checks
and recovery-after-firing ordering. Never-sent obsolete firing is cancelled.
Build and real PostgreSQL worker tests pass for concurrent claim, recovery,
transient failure retry, lease reclaim, expiry and disabled-channel cancellation.
Tests inject the transport; no external message was sent. Scheduler registration,
real local HTTP sink test, exhaustive recovery ordering and SMTP are still pending.
The worker is deliberately not registered/running until those delivery gates pass.

Real transport gate: worker PostgreSQL test now runs ObservabilityService against
a temporary loopback HTTP server (no sender mock). It verifies actual firing and
recovery JSON, HTTP 503 backoff and retry, concurrent claim suppression, expired
lease reclaim, expiry and disabled-channel cancellation. Recovery waits without
consuming attempts; never-sent obsolete firing and its recovery both cancel without
an outbound request. Test passes, cleans database fixtures and closes the temporary
HTTP listener. Scheduler registration, SMTP, full acceptance and UI remain open.

Scheduler slice (2026-09-18): implement in independent worktree
`kubenova-notification-scheduler`. Reuse the existing Nest interval lifecycle and
NotificationWorker; do not introduce another queue. Explicit opt-in
`NOTIFICATION_DELIVERY_ENABLED=true`, bounded batches of 20 clusters, one claim
per cluster per cycle, no overlapping cycles, and shutdown stops new claims.
Root integration owns module registration. Gates: default-off/false behavior,
batch bound, overlap suppression, per-cluster failure isolation, recovery after
query failure, shutdown, backend build and real PostgreSQL/HTTP worker regression.
Do not enable real-channel dispatch during this slice. SMTP, receiver UI and
full lifecycle browser acceptance remain separate unfinished gates.

Scheduler integration verified: independent commit 2ede9fc integrated; Nest
providers registered with dispatch still opt-in/off. Backend build and 11 focused
scheduler/transport tests pass. Real PostgreSQL selection test initially failed:
the Asia/Shanghai database session coerced Prisma UTC timestamp columns when
compared with timestamptz NOW(), making future retries immediately eligible.
Both scheduler and worker now explicitly use NOW() AT TIME ZONE 'UTC', including
lease timestamps. Real database tests pass batch limit, distinct targets, cursor
rotation, future exclusion and expired lease selection. HTTP/worker regression
also passes with a new immediate-retry rejection assertion. No live-channel
dispatch enabled and no running backend restart in this increment; source/build
verification does not imply deployment or completed notification UI/SMTP.

Email slice: first correct the existing HTTP-only notification endpoint contract.
Email stores one bounded bare recipient address; webhook channels keep HTTP(S).
Validate merged channel/endpoint on PATCH, including channel-only changes. Reject
CR/LF and display-name/header syntax. Independent worktree owns the validator and
tests; root integrates create/update and the existing form. Gates: email create,
partial update, channel conversion, malformed/header-injection inputs, and existing
webhook regressions. This is prerequisite work, not successful SMTP delivery.

Dependency preflight: supply-chain collector assessed pinned Nodemailer 10.0.10
in an isolated candidate manifest. No known advisory was reported for that direct
version; no lockfile/transitive sweep was performed. Publisher concentration was
unassessable. Local gh authentication is invalid, so repository queries used
unauthenticated access. No package installed yet. SMTP still requires TLS-backed
server configuration, bounded timeout, sanitized errors and a local mail-sink
delivery test before enablement; do not infer delivery readiness from this audit.

Email endpoint increment: independent validator commit 8343438 integrated with
create/update and HTTP send validation. Email accepts one valid bare address;
rejects CR/LF, display names, multiple addresses and oversized input. HTTP channels
reject embedded URL credentials. PATCH validates the effective channel/endpoint
pair rather than validating endpoint independently. Service regression first failed
on a valid email, then all 53 focused endpoint/scope/transport tests passed; backend
build passed. The notification form still has URL-only validation, SMTP remains
unavailable, and this increment has not restarted local services. These are backend
prerequisites only, not an end-to-end email completion claim.

SMTP transport slice: independent `kubenova-smtp-transport` worktree owns a small
Nodemailer adapter and focused tests. Root owns pinned dependency integration and
ObservabilityService dispatch. Host/port/from/user/password remain server-side env;
require STARTTLS or implicit TLS with certificate verification, no plaintext
fallback. Bound connection and total delivery time below the worker lease, reject
unsafe recipients/subjects and log no credentials. Reuse JSON template renderer
for subject/text only; never attachments or remote content. Acceptance requires
configuration rejection, TLS options, SMTP acceptance/failure, timeout/cleanup,
service tests, build, and eventually a real local TLS mail sink. No real email
credentials configured and no live-channel auto-dispatch enabled.

SMTP code integration: independent commit 1010ffe integrated. Nodemailer pinned
10.0.10 with install scripts disabled, no runtime transitive dependencies declared
by that package. Existing backend npm audit reports 24 findings (2 low, 7 moderate,
15 high); no automatic broad upgrade performed. SMTP adapter requires verified
TLS/STARTTLS, limits total send time to five seconds, closes transport, checks
recipient acceptance, bounds subject/text, and returns sanitized failure only.
ObservabilityService routes email through this adapter with safely rendered JSON
`subject`/`text` fields (fallback to actual alert title/message), not HTTP probing.
43 focused tests and backend build pass. Transport tests mock Nodemailer;
real local TLS SMTP sink validation remains required. No real SMTP credentials,
runtime restart, automatic dispatch or production deployment performed.

Server configuration contract: SMTP_HOST and SMTP_FROM required; SMTP_PORT defaults
to 465; SMTP_SECURE defaults to true (implicit TLS). Setting false requires STARTTLS,
never plaintext fallback. SMTP_USER/SMTP_PASSWORD must be provided together when
authentication is needed. Certificate verification stays enabled; private CA trust
uses the Node runtime trust configuration, never rejectUnauthorized=false.

Post-integration full backend regression: 86 suites / 690 tests passed. Dedicated
SMTP worktree removed after integration; no browser or real SMTP acceptance claim.

Form slice: independent email-form worktree updates existing channel-sensitive
endpoint field only, preserving global design tokens and scoped CRUD. Email label
and validation must accept one mailbox; HTTP channels keep URL validation. Root
extends port-3000 browser regression, builds to inactive `.next-candidate`, then
switches local frontend only after successful build. Browser gate uses mocked API
to verify form behavior without sending mail; it does not prove SMTP delivery.

Form integrated from 08e00d3 manually over existing dirty cluster-scope changes,
preserving those changes. Port-3000 browser test first failed because old email
form retained Endpoint label. New candidate build passes TypeScript/build and
extended mocked-API browser test verifies invalid email blocks save and valid
mailbox posts the selected cluster/channel/address. Local frontend now serves
`.next-candidate/standalone` (PID 19431): do NOT build into `.next-candidate` while
active; use inactive `.next-validation` for the next candidate. Backend restarted
with NOTIFICATION_DELIVERY_ENABLED=false. Real SMTP sink gate remains open.
Runtime gate: backend PID 20229 listening on 4000; readiness through port 3000
returns 200. Real authenticated receiver HTTP regression passes lifecycle,
ingestion/dedup/recovery/outbox/audit after restart; fixtures cleaned. Mail form
browser acceptance still uses mocked APIs, not an end-to-end SMTP assertion.

Real SMTP verification slice: isolated worktree owns a reproducible integration
script using smtp-server 3.19.13 as a test-only sink installed outside the repo.
Generate ephemeral test CA/certificate; trust it only in child sender processes.
Exercise implicit TLS and STARTTLS, recipient rejection and untrusted certificate
failure. All listeners bind loopback ephemeral ports and close after tests; never
set NODE_TLS_REJECT_UNAUTHORIZED=0 or send to external mail servers. Root reviews,
runs against the real compiled adapter, and removes test certificates/worktree.

Real SMTP gate passed: integrated test commit 6042cd7 and executed against compiled
NotificationEmail with smtp-server 3.19.13 on loopback ephemeral ports. Verified
implicit TLS, STARTTLS encryption, envelope/body, 550 recipient rejection and
untrusted certificate rejection. Test generates/removes its private certificate
and closes server connections. Isolated test dependency audit found no known
advisories in the pinned direct package or three locked transitive packages;
publisher concentration remains unassessable. No production dependency added for
the sink, no external mail sent.

Residual transport gate discovered during source review: Nodemailer non-pooled
SMTPTransport.close() emits close but does not itself abort an active SMTP socket.
The current five-second Promise deadline bounds caller latency and socketTimeout
bounds inactivity, not absolute connection lifetime under trickling responses.
Do not claim timeout cancellation or socket cleanup proven by mocked close tests.
Add a real stalled/trickling transport test and reliable cancellation before
enabling automatic dispatch. This does not negate successful TLS delivery tests.

Cancellation slice: independent worktree adds a caller-owned native net.Socket
through Nodemailer's supported socket option, destroyed in finally; leave DNS,
SMTP and TLS to Nodemailer. Confirm pinned version upgrades caller socket to TLS
when secure=true. Root adds real trickling-greeting regression before integration;
must observe remote close near the five-second deadline, then rerun TLS/STARTTLS
success and untrusted-certificate tests. No additional runtime dependency.

Cancellation verified: real incomplete EHLO response test failed before the fix
(caller rejected but peer remained connected). Integrated e4d04a8; caller-owned
socket now destroyed in finally. Backend build, 21 focused tests, real slow-response
deadline test and real TLS/STARTTLS/envelope/rejection/certificate tests all pass.
Initial incomplete-greeting fixture was insufficient because Nodemailer's own
greeting timeout already closed it; the regression deliberately completes greeting
then trickles EHLO to exercise the missing absolute-lifetime cancellation.
Test sink dependencies and dedicated worktree cleaned. Local backend restarted
with automatic dispatch explicitly disabled; production remains unchanged.

Delivery history implemented in isolated worktree, commit a6b12ab integrated and
module registered. This slice was implemented by root, not delegated. Backend build
and real PostgreSQL tests pass scope, tied-timestamp cursor pagination, filters,
non-admin rejection, deleted-cluster rejection and error/message redaction. Extended
real port-3000 receiver HTTP test passes authenticated history paging, 401 without
login and 400 for excessive page size. Local backend PID 34960 runs latest build
with automatic dispatch off. Test fixtures and worktree cleaned. Frontend delivery
history and receiver configuration UI remain unimplemented; no release claim.

Delivery history UI increment: root implemented isolated worktree 96652df, then
integrated a cluster-only admin tab into existing scoped observability configuration.
Uses existing ResourceTable, status tags and icon buttons; adds status filter,
cursor previous/next, refresh, loading/error/empty states. Browser regression found
missing explicit column keys yielded blank table despite data; fixed and verified
actual visible cells. Frontend build and port-3000 mocked API browser test pass
email validation, cluster reset, history paging and filter reset. Desktop screenshot
inspected; no new custom colors. This does not prove mobile/dark acceptance or
real-alert browser end-to-end delivery. Local frontend PID 42020 now serves
`.next-candidate/standalone`; next build must use inactive `.next-validation`.
Receiver setup UI and broader goal stages remain incomplete.

Receiver status prerequisite: isolated worktree a1763d5 added metadata-only service;
root integrated GET receiver route, authenticated admin-only with no-store. Returns
only clusterId/configured/enabled/updatedAt; select excludes hash and response
whitelists fields even if persistence returns extra properties. Thirteen focused
receiver tests and backend build pass. Local backend PID 45436 loads this increment
with dispatch disabled. Port-3000 authenticated regression covers unconfigured,
enabled and disabled metadata plus unauthenticated rejection and secret-free keys.
Dedicated worktree removed. Receiver configuration UI remains the next step.

Receiver UI slice: isolated component becd760 uses existing theme/components,
status GET and confirmed rotate/disable actions. One-time token lives only in local
component state, never query/mutation cache or storage; close clears state and
destroys modal; keyed cluster subtree and hidden-tab destruction clear old context.
Root owns integration/browser test. Verify generate/display/close/disable and no
storage residue with mocked APIs on 3000, then keep real cluster credentials intact.

Receiver UI verification completed locally: build passed, browser test exercises
generate/one-time modal/close/disable/re-rotate and navigation to another cluster
while modal is open. Secret input is destroyed on close or cluster change; no
credential residue in localStorage/sessionStorage. Test uses mocked APIs only,
does not rotate real cluster credentials. Existing email/history/scope checks also
pass. Root implemented this independent worktree slice; no subagent delegation
claimed. Temporary worktree removed. Frontend PID 48712 serves
`.next-validation/standalone`; next candidate build must use `.next-candidate`.
Backend remains PID 45436 with dispatch disabled. Real receiver HTTP tests were
passed separately; full real-browser Alertmanager-to-channel acceptance, external
SMTP configuration and scheduler opt-in acceptance remain open.

Delivery history slice: isolated worktree implements GET
`/api/monitoring/clusters/:clusterId/deliveries`, platform-admin-only like channel
configuration. Require existing nondeleted cluster; filter through alert.clusterId
on every database read. Validated status/event filters and bounded take (default
20, max100), stable cursor pagination ordered createdAt/id descending. Return
delivery ID, alert ID/title, template ID, event/status, attempts, timestamps and
sanitized error only; never endpoint/secret/token/template body/raw alert message.
No retry/mutation endpoint in this slice. Root registers module and verifies real
database pagination/isolation; frontend delivery table follows after API gate.

Current integration revalidation: real PostgreSQL + loopback HTTP worker test
passes concurrent suppression, firing/resolved payloads, backoff, lease reclaim,
expiry and disabled-channel cancellation without external delivery. Browser test
initially stalled loading workspace: active .next-candidate had been rebuilt
without synchronized standalone static assets/restart. Copied matching static
assets/public and restarted only local 3000 (PID 31226). Notification scope browser
regression then passed cluster changes, email validation, paging/filter and receiver
secret cleanup with mocked APIs. Active directory is now .next-candidate; subsequent
builds MUST target inactive .next-validation. No real receiver rotation or external
notification occurred. Real end-to-end Alertmanager and external SMTP remain open.
