# Log Collection Identity Contract

## Native Filebeat TLS Acceptance (2026-09-20)

`test/filebeat-tls.cjs` now executes official Filebeat 9.5.4 `test output`
against an ephemeral local HTTPS Elasticsearch-shaped fixture. It reads the
actual generated ConfigMap and translates only the CA mount path into the test
directory. A matching trusted certificate succeeds and sends the expected
fixture API-key header. Removing the custom trust or using the wrong hostname
fails at TLS, without an HTTP request. All three cases passed; the server,
certificate/private key and data directory were cleaned up. Independent feature
worktree removed after verification. This validates Filebeat TLS behavior, not
Elasticsearch ingestion, Kubernetes Secret mounts or namespace enrichment.

Run with `FILEBEAT_BIN=<verified-9.5.4-binary> node test/filebeat-tls.cjs` from
backend/control-api after building. No application runtime restart was needed.

## Custom CA Preview (2026-09-20)

Feature 6c01894 adds optional `caSecretName` through the preview UI/API/generator.
DNS-subdomain names are validated; only `ca.crt` from that existing Secret is
mounted read-only at `/etc/filebeat-ca`. TLS verification remains `full`; no
certificate or key is read by the control API. Secret must exist in
`kubenova-system`. No CA means the image's system trust store, unchanged.

Fresh evidence: 107 log-center tests; both production builds; browser fixture
tests on port 3000 including CA input transmission, dark/light responsive views,
denial and retry; real isolated HTTP/session/PostgreSQL preview tests. Dark mobile
capture inspected. API PID 32370 and frontend PID 32151 (`.next-validation`),
notifications disabled. Clean feature worktree removed; prerequisite snapshot
commits not merged. Next frontend build must target inactive `.next-candidate`.

No Docker binary is available locally. Actual Linux collector lifecycle and
custom-CA handshake against Elasticsearch remain unverified; do not infer those
from configuration or mocked browser tests. No real cluster writes or release.

## Deployment Requirements (2026-09-20)

The preview is not an installable workload. The next deployment slice must
provide a Linux DaemonSet, ServiceAccount and explicit get/list/watch access
to Pods and Namespaces, with no Secret read or wildcard permissions. Disable
unused workload-owner metadata extraction or include its precise read rules;
validate against the pinned binary before choosing either approach.

Mount container log paths read-only. Persist `/usr/share/filebeat/data` per
node for registry and disk queue; an ephemeral directory loses offsets and
buffered events on restart. Mount only a designated node directory, never the
host root. Set CPU/memory requests and limits and reserve disk beyond the 1 GB
queue for registry/segments. Host-log permissions and admission policy are
explicit prerequisites, not a reason to enable privileged mode by default.

Inject writer API key via an existing Secret key reference; ConfigMap and
preview must contain only the environment reference. Custom CA support needs
a read-only trust mount and verified TLS. Do not reuse the reader credential.
Install index mappings before collection; applying retention requires a separate
destructive-change confirmation. Preserve data volumes during uninstall and
rollback unless the operator explicitly requests deletion.

Before release: exercise log rotation, restart/checkpoint recovery, namespace
recreation, missing metadata, full disk queue and unavailable Elasticsearch in
a disposable cluster. Native macOS `test config` proves syntax only, not these
Linux Kubernetes behaviors. Real cluster installation remains disabled.

## Real HTTP and Database Preview Acceptance

`test/collector-preview-postgres.cjs` passes against local PostgreSQL with a
random disposable schema: actual Nest controller, AuthGuard, AuthService and
session rows; no mocked authentication or source lookup. Administrator preview
returns the expected configuration, no-store and no source secret. Invalid and
revoked sessions return 401, reader returns 403, foreign/disabled sources return
404 and client-supplied endpoint returns 400. Only isolated test users/sessions
are created; schema cleanup completed. This does not prove real Elasticsearch,
actual user browser login or collector deployment.

Fresh complete API Jest run: 117 suites passed, 1280 tests passed, 4 skipped.
These are regression evidence, not completion of all console-modernization gates.

Preview modal browser follow-up: light/dark, desktop1440/mobile390 checks pass;
reviewed mobile dark and desktop light screenshots, with animations disabled
for final captures. Permission-denied response clears the previous config;
retry succeeds, close removes the dialog, reader role has no preview action.
All APIs intercepted; real administrator HTTP acceptance is still open. Test
screenshots are removed after inspection, persistent regression script retained.

## Latest Preview UI

Feature cf89105 adds an administrator-only preview modal to the log center:
retention input, configuration/mapping/policy/query tabs, copy, loading and error
states. No install/apply action. Scope changes remount the preview and cancel
old queries. Browser regression caught tab reset on retention changes; fixed
with controlled active state. Frontend build and mocked port-3000 browser checks
pass. Frontend PID 59538 serves `.next-validation`; next build `.next-candidate`.
API remains 45934 (the latest index-name source is not yet restarted). Real
administrator-to-API preview and dedicated modal screenshot review remain open.
Temporary feature worktree removed. No production publication.

Status: implementation gate, not a working collector. Audited 2026-09-19.

## Upstream Evidence

Inspected Fluent Bit upstream `plugins/filter_kubernetes/kube_meta.c`, function
`merge_namespace_meta`, and `plugins/filter_kubernetes/kubernetes.c` namespace
serialization. The namespace map emits `name`, optional labels and annotations;
it does not emit metadata.uid. The `have_uid` code belongs to `merge_pod_meta`
and describes a Pod, not a Namespace. `Namespace_Labels On` is therefore not
sufficient to populate the query service's namespace UID field.

Sources inspected:

- https://github.com/fluent/fluent-bit/blob/master/plugins/filter_kubernetes/kube_meta.c
- https://github.com/fluent/fluent-bit/blob/master/plugins/filter_kubernetes/kubernetes.c
- https://github.com/fluent/helm-charts/blob/main/charts/fluent-bit/values.yaml

The chart main branch reported version 0.58.2 / appVersion 5.1.2. These are
discovery evidence only, not an approved or digest-pinned deployment. Fetching
the version-pinned source timed out; release-specific verification remains open.

## Required End-to-End Data

Every record needs trusted cluster ID, namespace name AND UID, Pod/container
names, timestamp and message. Cluster ID must come from collector configuration,
not the application message. Namespace UID must come from Kubernetes metadata,
not application JSON, a user-editable label or an unverified annotation. JSON
message merging must not overwrite identity fields.

Current scoped query enforcement requires an exact namespace UID and fails
closed if its mapping is missing. Preserve this behavior. Never substitute
namespace name or Pod UID. Namespace deletion/recreation must not allow a new
grant to retrieve the old namespace's historical records.

## Delivery Order

1. Verify a version-pinned collector/enrichment path that emits real namespace
   UID. A Fluent Bit-only template without enrichment cannot pass scoped access
   acceptance. Do not advertise such a template as general-user ready.
2. Add structured template generation with fixed field mappings, bounded disk
   buffering, resource requests/limits, verified TLS and Secret references only.
   Preview must identify missing enrichment/credentials before installation.
3. Reuse the administrator-only Helm operations for explicit preview/install,
   status, upgrades and rollback. Do not create a second Helm process runner.
   Installation has cluster-wide host-log access; never grant it to a namespace
   reader or infer installation consent from opening the preview.
4. Verify actual collection into disposable Elasticsearch, matching index
   keyword mappings, bounded query, and historical namespace isolation. Test
   forged JSON identity fields, namespace recreation, disconnected outputs,
   buffer exhaustion and rollback before enabling the template for real users.

No real cluster was mutated and no collector was installed in this audit.

## Filebeat Compatibility Path

Verified the version-pinned source at
https://github.com/elastic/beats/blob/v9.5.4/pkg/autodiscover/kubernetes/metadata/resource.go:
the resource generator obtains `accessor.GetUID()` and enriches Pod metadata
from the namespace store. The namespace generator flattens this to
`kubernetes.namespace_uid`. This provides a compatible Elastic-stack collection
path without a custom Fluent Bit fork. Fluent Bit remains optional pending
equivalent trusted enrichment.

`collector-config.ts` now generates a preview-only Filebeat 9.5.4 configuration:
container-log filestream input; trusted cluster field; Kubernetes metadata;
drop unresolved identity; rename to the query service's fixed fields; verified
TLS; external API-key environment reference; 1 GB disk queue. It does not parse
application JSON into identity fields. The key format is Filebeat's `id:key`,
not the encoded key used by the query API; use distinct least-privilege writer
and reader keys. Persist the Filebeat data directory in the eventual workload.

Ten tests cover field contracts and rejected configuration. This is a generator,
not a deployed collector: config-binary validation, namespace watch/recreation
behavior, RBAC/manifests, writer Secret injection, keyword index mappings, ILM,
preview UI and real collection acceptance remain open. Unresolved metadata is
dropped rather than mislabeled; data loss during API outages must be measured
and made explicit before rollout. Do not enable this preview in user clusters
until those gates pass.

## Local Binary and Index-Policy Verification

Official Darwin ARM64 Filebeat 9.5.4 archive verified against its published
SHA-512: `fb6cb8b0040c816dc9ef13a8c6b8b97a083b223ca95dcc7970856766f666a5ca7076aa08fb871bdd45e5523e647c5ce94864653f4f6e5af0f49b5e700df34e76`.
The retained verification tool is
`/tmp/kubenova-filebeat.D5KQDh/filebeat-9.5.4-darwin-aarch64/filebeat`.
Run `test/filebeat-config.cjs` with FILEBEAT_BIN set to that path after building
the API. It checks the binary version and executes official `test config` on
the generated configuration with dummy credentials, then removes its temporary
config/data directory. Result: Config OK. No output or collector was started.

The generator now includes exact-cluster index templates with keyword identity
fields and dynamic mapping disabled, plus a separate 1-365 day deletion policy
(default 14). It does not install or change policies. Applying deletion policies
is destructive and needs an explicit reviewed preview in the future workflow.
Fifteen unit checks and the API build pass. Elasticsearch template/ILM API
acceptance and historical namespace isolation remain unverified.

## Administrator Preview API

`POST /api/log-center/collection/preview` now accepts only clusterId,
dataSourceId and optional retentionDays. The existing session guard and platform
administrator check apply before source access. The service requires an enabled
Elasticsearch source belonging to that live cluster, selects no credential
fields, and derives the endpoint server-side. HTTP sources and unsafe endpoint
syntax fail closed. Unknown input properties, including endpoint/token, are
rejected. Response is no-store and contains generator output only; no network
call, database write, installation or retention application occurs.

Feature 22333bc integrated after 94 log-center tests and API build passed.
Front-end preview, deployment lifecycle and real ES checks remain pending.

### Generated Index Identity Regression

Cross-module checks reproduced two incompatibilities: a 128-character cluster ID
generated metadata rejected by the query schema, and valid mixed-case/dotted IDs
were rejected by the generator. Index/policy names now use the full SHA-256 of
the exact cluster ID. This bounds names and prevents human-readable prefixes
such as `cluster-a` from matching `cluster-a-child` indices. The record's cluster
ID and query term remain unchanged. No existing indices are renamed or deleted.
Generated preview names change; no collector from this feature has been deployed.

Fresh result: 99 log-center tests, API build and official Filebeat config check
pass. The generated metadata is tested through the actual query service (upstream
transport doubled), not just against a copied regular expression. Independent
worktree removed after integration. Source/build updated; local running API has
not been restarted for this increment. Frontend integration remains next.
# Deployment Preview Increment (2026-09-20)

UI follow-up (337b4af): deployment manifest tab now uses the existing themed
modal/code-copy controls and shows namespace/Secret/admission prerequisites.
Production frontend build passed; port 3000 was reloaded from `.next-candidate`
(PID 27883), API from the current backend build (PID 29126), notification delivery
still disabled. Browser fixture tests passed with no page errors, including dark/
light 390/1440 manifest views, retention changes, denial/retry and viewer hiding.
Both desktop light and mobile dark screenshots were visually inspected. Generated
11 screenshots (the script's legacy summary counter says 7); test artifacts were
removed. Real isolated HTTP/session/PostgreSQL preview test also passed. This is
not live Elasticsearch or Kubernetes collector validation. Remaining work below
on actual collection/CA/admission checks is unchanged.

Admin collection preview now returns a Kubernetes List in `manifests`: Filebeat
DaemonSet, ConfigMap, ServiceAccount and pods/namespaces read-only RBAC. Owner
enrichment is disabled so it does not require ReplicaSet/Job permissions. Linux
host logs are read-only; registry/1GB disk queue persist only under
`/var/lib/kubenova/filebeat`. Container capabilities are dropped and resource
limits are set. Existing `kubenova-system` namespace and `kubenova-log-writer`
Secret (`api-key`) are prerequisites, as are the separately reviewed ES template
and retention policy. No namespace, Secret or live workload is created here.

Validation: 100 log-center tests, backend build and isolated real HTTP/session/
PostgreSQL preview acceptance passed. Feature commit: 46c817f, integrated by file
diff only, prerequisite snapshot commits excluded. Agent spawn was unavailable
(thread limit); work was isolated manually and the clean worktree removed.

Still pending: frontend manifest tab, port-3000 runtime reload, Kubernetes schema
and disposable-cluster acceptance, custom CA support and lifecycle checks. This
preview targets CRI logs under /var/log; Docker symlinks outside that tree are not
supported. Root UID/hostPath require explicit admission-policy review. HostPath
does not enforce disk quota; reserve and monitor node space separately. Do not
claim this is an installed or production-validated collector.
