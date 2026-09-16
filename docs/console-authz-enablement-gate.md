# Authorization Enablement Gate

Status: NOT READY. Keep `KUBENOVA_AUTHZ_ENFORCE` disabled until the complete
route matrix and local integration tests pass. This switch does not currently
provide full namespace isolation. Do not publish this work as completed RBAC.

## Verified Implemented Paths

- Runtime session bootstrap: logs and exec use a live namespace UID.
- Legacy `/api/logs` query/stream: live UID, including the `ns` query alias.
- Resource Secret YAML read/update and dynamic detail/create/update/delete:
  independent secrets capability and live namespace identity.
- Batch YAML apply: preflight all prepared manifests before the first write;
  current controller preflight checks Secret capability only, not all resource
  mutations or Kubernetes privilege escalation.
- Evaluator rejects omitted namespace scope and separates user/group identity
  matching. Namespace recreation tests reject old grants for new UIDs.

These are source-level changes with unit tests, not proof of deployed policy.
The running backend has not been restarted for each incremental commit.

## Newly Confirmed Alternate Entry Points

`backend/control-api/src/configs/configs.controller.ts`:

- GET list, detail, revisions and diff have AuthGuard only; no cluster access
  assertion in the controller.
- Config detail includes revisions. ConfigRevisionRecord contains `data`.
  Therefore historical Secret content requires the same scope/capability policy
  as current Secret content. Metadata-only list output is a different contract.
- Create/update/rollback/actions use platform write checks, not scoped grants.
- Update can change namespace: check both original and destination scopes.
- Resolve ownership using a metadata-only repository query before retrieving
  any revision data. Reject inaccessible IDs without returning object contents.

`ResourcesService.listDynamicResources` returns a metadata projection rather
than raw Secret bodies. Do not classify this path as a raw Secret leak. It still
requires namespace-filtered inventory for scoped users.

## Required Remaining Implementation

1. Close legacy configs read/history/write paths with integration tests covering
   two users, two clusters and two namespaces, including moves and rollback.
2. Complete opaque resource detail identity resolution; it currently provides
   cluster ownership without a namespace identity for Secret authorization.
3. Scope all resource list/detail/mutation paths, aliases, Secrets, workload and
   RBAC APIs. Use a common policy boundary rather than independent ad hoc checks.
4. Prepare reviewed additive migrations and grant administration/backfill.
   User authzVersion is not yet present in schema although Session has it.
5. Bind runtime tickets to parent sessions and current policy; implement stream
   revocation. Bootstrap authorization alone does not terminate active streams.
6. Implement OIDC/Keycloak, managed optional MFA, user/group administration and
   per-user kubectl identities. Verify actual provider and cluster integration.
7. Verify real DI/module startup and local HTTP deny/allow tests with the switch
   enabled against an isolated migrated test database before enabling locally.

## Evidence Boundaries

- Last full suite before principal-domain correction: 63 suites / 423 tests.
- Principal-domain correction: 9 focused tests and backend build passed.
- No new production deployment, GitHub push, tag or managed-cluster mutation.
- UI, log collection lifecycle, monitoring notifications and encrypted remote
  backup remain separate unfinished workstreams in the original goal.
