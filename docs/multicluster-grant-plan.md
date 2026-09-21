# Multi-cluster Query Authorization

The query controller forwards no actor; service reads arbitrary client clusterIds.
There are no internal callers. Fix this independent read-only query surface.

- Own only backend/control-api/src/multicluster in kubenova-multicluster-grants.
- Reuse current access services and effective namespace UID grant patterns.
- Require known authenticated actor. Preserve platform admin and full-cluster
  legacy bindings; scoped readers see only exact namespace pairs. Namespace-only
  grants do not authorize PV/SC; Secret needs effective same-namespace capability.
- Authorize before kubeconfig lookup and SQL; filter before per-cluster limit.
  Return an explicit permission error for unauthorized requested clusters; never
  silently query them. Preserve response shape and permitted partial failures.
- No dependencies, unrelated refactors, mutations or real data/session changes.
- Reproduce denied-scope failure, focused tests, review/integrate/build, real
  read-only DB acceptance, then local API reload with notifications disabled.
  Remove worktree after preservation and acceptance. No production deployment.

## Result

1dd3460 integrated. 20 focused tests passed; full integration build and 107 suites
passed (1009 tests, 3 skips). test/multicluster-grants-local.cjs verified real
loop-read effective grants, live namespace UID and exact DB counts for all four
domains, with foreign namespace/cluster, Secret and PV denied. Zero scoped PVCs
exist, so positive PVC behavior is unit-covered only. Local API 49856 updated,
notifications disabled; committed worktree removed. Real login HTTP pending.
