# Network and Storage Grant Integration

Critical current finding: both legacy controllers have AuthGuard but their list,
detail and mutation paths do not enforce resource authorization. Fix the actual
service paths including live-query fallback, not just browser visibility.

## Isolated Deliverables

- `kubenova-network-grants`: only backend/control-api/src/network files. Reuse
  AuthorizationService, NamespaceIdentityService and ClusterAccessService. Apply
  real actor identity to every public controller operation. Internal scope is
  separate from untrusted query fields. List filters must enforce exact pairs
  before counting/pagination, including live resources and offline/empty handling.
- `kubenova-storage-grants`: only backend/control-api/src/storage files, same
  contract. PVC may use namespace grants; PV and StorageClass require full
  cluster authorization. Mutation target fields must not relocate a resource
  outside the permitted scope.

## Gates

Tests must first reproduce unscoped lists/detail or mutation authorization, then
verify direct/group effective grants, live UID mismatch, unauthorized explicit
namespace/cluster, unfiltered list, forged query scopes, direct ID and live ID
paths, viewer mutation denial and legacy/admin compatibility. Do not perform real
Kubernetes writes or mutate real grants for acceptance. Preserve existing domain
logic and use server-side filters rather than filtering a paged result.

Each service may reuse the proven workload scope resolution pattern; keep shared
authorization services unchanged during parallel work. Any shared refactor must
wait for integration evidence rather than introducing a speculative abstraction.
Main agent audits all read/mutation callers, integrates bounded diffs, builds and
runs focused then broad tests. Local 3000/API reload only after gates, with
notification delivery disabled. Remove integrated clean worktrees. Production and
release remain prohibited pending user acceptance. Config and Secret/revision
authorization are the next separate slice and are not claimed complete here.

## Integrated Evidence

Integrated network 770d635 + 6ca7bcd and storage 7dfca94 + 60392c0.
Controller identities reach service checks; cached queries enforce exact scopes
before count/page, network live lists call only allowed namespaces, storage
namespace branches constrain kind=PVC. Review found unknown-role fail-open in
the first drafts; both agents added rejection and failing-then-passing tests.
Cross-namespace relocation is rejected. Platform write restrictions remain in
addition to grant role checks; no new blanket write authority was introduced.

Focused tests: 52 passed. Integration backend build passed. Full regression:
104 suites, 929 passed, 3 optional integration skips. Read-only local acceptance
`test/network-storage-grants-local.cjs` uses actual loop-read grants, PostgreSQL
inventory and live namespace UID resolution; scoped lists/details match expected
records, foreign namespace and PV/SC requests fail. The health/sync boundary is
stubbed to prevent acceptance from synchronizing or changing inventory; this is
not login, cluster-health or mutation end-to-end validation. The authorized ai
namespace currently has no PVCs, so positive PVC access is covered by unit tests,
not real existing PVC data. No sessions/grants/Kubernetes resources changed.

Runtime updated locally: API PID 7899 on 4000; frontend PID 91624 remains on 3000,
serving `.next-validation/standalone`. Notification delivery remains disabled.
Unauthenticated network/storage requests through 3000 return 401. Both isolated
worktrees removed after integration; dependency snapshots remain in git/main.
Actual loop-read login and configuration/Secret/revision authorization remain open.
