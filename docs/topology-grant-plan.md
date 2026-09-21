# Topology Grant Boundary

Confirmed controllers pass no actor to graph v1/v2 or namespace summaries.
Services load online cluster inventories without authorization. This stage fixes
that boundary without changing graph layout, relation semantics or UI.

## Delivery

- Isolated worktree kubenova-topology-grants owns topology-graph and
  topology-summary only. Reuse shared authorization/namespace UID services.
- HTTP always forwards an actor, fail closed for missing/unknown identity.
  Preserve the existing trusted AI aggregator internal caller explicitly.
- Exact cluster/namespace scopes must constrain database reads, summary counts,
  revision aggregation, alerts, graph generation and cache reuse. No cross-scope
  graph cache hits. Namespace-only users cannot see cluster-scoped resources.
- Secret metadata is excluded without an effective secrets capability for that
  same namespace UID. Never load Secret payload values for graph generation.
- Validate v1/v2, explicit and unfiltered scope, foreign cluster/namespace,
  revoked/expired/recreated namespaces, admin compatibility and cache isolation.

## Gates

Agent reproduces RED then focused tests. Main reviews callers/diff, builds and
runs real loop-read read-only acceptance through local 3000 after integration.
Only reload local API with notification delivery disabled. Full regression,
then remove committed worktree. No GitHub or production release.

## Investigation Evidence

- Real read-only summary service invocation with loop-read actor returned 9
  namespace buckets, 8 outside ai. Service currently ignores actor entirely.
- Added test/topology-grants-local.cjs for existing-session HTTP acceptance.
  Current session has expired; test correctly refuses to fabricate a login.
  Run service/DB regression while logged out, then HTTP when a real session exists.
- Follow-up surface: multicluster controller query passes no actor and service
  reads supplied clusterIds directly; monitoring overview/events/alerts/inspection
  likewise pass no actor. These are separate slices, not covered by config fixes.
- Added session-independent test/topology-scope-local.cjs with real database,
  effective grants and live namespace UID. RED reproduced unauthorized summary
  buckets; graph checks follow that assertion once summary enforcement is fixed.

## Result

51725d3 integrated plus narrow typed SQL predicate overload fix. Build and full
107-suite regression passed (1009 tests, 3 skips). Real scope script now passes
summary/v1/v2 and denies foreign namespaces. API 49856 reloaded locally with
notifications disabled; expired login prevents actual session HTTP acceptance.
Committed worktree removed after source preservation. No production release.
