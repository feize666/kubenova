# Monitoring Authorization Delivery

## Confirmed Gap

Overview, observability summary, events, alerts, inspection, exports and inspection
actions currently receive no HTTP actor. Alert resolution has cluster-level
checks only. AI aggregator and AIOps are existing internal service callers.

## Scope and Delivery

Monitoring worktree owns monitoring controller/service/tests and scope helper.
Separate kubenova-aiops-grants owns AIOps actor forwarding/cache isolation.
Monitoring read methods add actor last: second parameter for summary/alerts/
events/overview; fourth for getClusterInspection. Integration is sequential after
both slices; no shared writes between agents.
Frontend nullable metric presentation is isolated in monitoring-unavailable-ui:
update monitoring/observability contracts and show unavailable health as --,
not zero or healthy green, preserving actual zero values and current styling.
Agent thread capacity prevented a third assignment; main owns this small
frontend integration slice. Worktree is created but no frontend edits yet.
Preserve notification worker/channel changes.
Use the dirty console-next source as authoritative baseline, not old HEAD.

- Every HTTP path forwards an actor. Resolve effective direct/group grants and
  current namespace UIDs; fail closed on missing or unknown identity.
- Filter database counts, rows, derived fallback alerts, inspection inputs and
  exports before pagination/aggregation. Secret-related data needs capability.
- Cluster-wide metrics/panels must not become available through a namespace
  grant. Report unavailable honestly, keep authorized namespace data usable.
- Cache keys must include effective scope or skip cache for scoped callers.
- Mutations require existing platform write permission plus matching effective
  namespace mutation grant; no cross-grant capability union. Cluster-wide rule
  configuration remains restricted, never expand access to make tests pass.
- Trace AI/AIOps callers before changing signatures. Preserve legitimate internal
  calls explicitly, but document any exposed alternate HTTP route for follow-up.
  AIOps summary is confirmed HTTP-reachable without actor and caches by time/
  cluster only. Forward actor end-to-end and bypass its shared cache for scoped
  users so an admin result cannot be reused after revocation or by another user.
  Recommendation precheck/approval must resolve a visible server-derived target,
  not trust a syntactically valid client ID. Preserve legitimate operator approval
  through current live-UID mutation authorization; do not replace scoped access
  with a blanket administrator-only restriction. Approval remains non-executing.
- Reproduce RED, focused tests then integration build/full regression and real
  read-only loop-read DB/UID check. API reload only after gates; port 3000 stays.
  Notification delivery disabled; no external messages or real monitoring writes.
- Preserve commit then clean worktree. No production deployment or GitHub push.

## Main-thread Regression

test/monitoring-scope-local.cjs reproduces RED against current compiled service:
real loop-read alerts include records outside its authorized namespace. No
records, sessions or notification deliveries changed. Align constructor arguments
with the final implementation before GREEN validation.

Frontend inspection found observability/page.tsx converts healthScore null to
zero and always uses success tone. Backend scoped metrics now require nullable
contracts; fix and validate rendering before local frontend rollout.

Frontend 9589dc9 integrated and built. Browser mocked API regression reproduced
old zero display then passed null and genuine zero after port 3000 rollout.
UI worktree removed; backend integration still pending. Runtime checkpoint has
new active frontend build directory, do not overwrite it on next build.

## Backend Result

e19a9d5 and 8167fcc integrated. Build and 1029 tests passed; real read-only
scope script passed monitoring plus AIOps controller identity normalization.
API 72983 locally deployed with notifications disabled, unauthenticated proxy
denial confirmed. Both committed worktrees cleaned. Existing-session/browser
acceptance remains pending; no login credentials guessed and no data mutations.

Follow-up real read-only acceptance also verifies JSON alert and inspection
exports contain only authorized ai resources and no Secret records. Passed with
current compiled services; no export artifact or external notification created.
