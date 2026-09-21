# Configuration and Secret Authorization

Current defect: ConfigsController passes accessible cluster IDs, but ConfigsService
ignores that restriction when recomputing readable cluster IDs. Lists can expose
foreign data. Details/revisions/diffs also lack namespace and Secret capability
checks. This slice must close the actual service boundary, not hide UI controls.

## Worktree and Scope

`kubenova-config-grants` owns backend/control-api/src/configs only. Reuse existing
AuthorizationService, NamespaceIdentityService, ClusterAccessService and the
network/storage filtering pattern. No real user/grant or Kubernetes mutation.
Main agent reviews callers, service diff and acceptance; shared services stay
unchanged to avoid dirty-tree collisions.

## Requirements

- Every HTTP endpoint passes a non-undefined actor; unknown/missing identities
  fail closed. Trusted internal calls remain compatible only where they exist.
- Lists enforce server-derived exact cluster/namespace/kind scope before count
  and pagination. Never trust client clusterIds or scopes; intersect online IDs
  with effective authorization. ConfigMaps need namespace read authorization.
- Secret payloads require the secrets capability on the same effective namespace
  grant and current live UID. Ordinary legacy bindings do not confer secret
  capability. Platform administrators retain access.
- Secret permission applies equally to detail, revisions, diff, create/update,
  rollback and actions. Do not fetch revision contents before authorization.
  Preserve platform write restrictions and match mutation role+capability within
  one grant; never combine a viewer Secret grant with an operator grant elsewhere.
- Prevent namespace relocation and malformed revision input producing HTTP 500.
  Keep the existing config domain behavior; changes to cluster rollback semantics
  are a separate issue and must not be silently included.

## Acceptance

Reproduce prior list leak first; then test spoofed scopes, no grants, direct/group
grant expiry/revocation, UID recreation, cross namespace/cluster, Secret cap absent
or present, legacy/admin reads, all revision routes, denied writes before effects,
and no cross-grant privilege union. Compile and run focused suites, then full
regression in the integration tree. Add read-only real loop-read PostgreSQL/live
UID acceptance without sessions, secrets printed or actual writes. Reload only
local API after gates; port 3000 remains the frontend, notifications disabled.
Clean the integrated worktree and document remaining real login/end-to-end gaps.

## Verified Result

- Integrated `0f2a5c2` without committing the dirty integration tree. Reviewed all
  callers; configs have no trusted actor-omitted service caller to preserve.
- 46 focused tests passed; full backend 105 suites, 972 passed, 3 optional skips.
  Integration build passed (the isolated HEAD's unrelated missing monitoring
  worker did not affect this tree).
- Read-only DB/live-UID check moved from RED (396 rows instead of 1) to GREEN.
- Extended existing-session HTTP test on port 3000 with ConfigMap count and
  Secret detail/revisions/diff checks. Old API reproduced 396 instead of 1;
  reloaded API PID 25570 passed, along with cluster discovery/workload access
  and denial checks. Notification delivery remains disabled.
- Config agent completed; its committed worktree and dependency symlink removed.
  Source remains recoverable in commit `0f2a5c2` and integrated changes.
- No real credential entry, Secret-positive end-to-end write or browser visual
  acceptance claimed; authorized mutation behavior is covered by unit tests.
