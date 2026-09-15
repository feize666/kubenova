# Console Navigation and Pod Runtime Audit

Date: 2026-09-16. Scope: read-only source audit; no production access or runtime changes.

## Findings and Evidence

1. The active cluster navigation exposes a standalone Pod log workbench as `logs` (`frontend/src/lib/cluster-workspace.ts:275`) and terminal under operations (`:339`). Replace the log navigation target with a separate `log-center` page and remove terminal from navigation. Do not delete the runtime routes: the Pod action bar and existing bookmarks depend on them.
2. The cluster resource page registry dynamically loads the existing runtime pages (`frontend/src/components/cluster-workspace-resource-page.tsx:47`). The allowlist includes both runtime routes (`frontend/src/lib/cluster-workspace.ts:61`). Retain these routes and add log-center independently, updating navigation tests at `frontend/src/lib/cluster-workspace.test.ts:85`.
3. Pod row operations already navigate to scoped full pages (`frontend/src/app/workloads/pods/page.tsx:982`), with shared route builders at `frontend/src/lib/api/logs.ts:130` and `frontend/src/lib/workloads/terminal.ts:40`. However `frontend/src/components/app-shell.tsx:32` wraps all scoped routes in the cluster sidebar/header shell; they are not dedicated full-viewport runtime surfaces. Introduce a runtime shell variant that retains authentication and cluster context while hiding cluster navigation. Do not classify runtime routes as public merely to remove the sidebar.
4. P1 return-context loss: Pod actions set `returnTo` to a bare list path (`frontend/src/app/workloads/pods/page.tsx:779`, `:806`), then send separate filter/page fields. Both logs (`frontend/src/app/logs/page.tsx:310`) and terminal (`frontend/src/app/terminal/page.tsx:400`) return the safe returnTo immediately and never merge those fields. This drops explicit filter context. Furthermore `keyword || row.name` and `namespace || row.namespace` replace an intentionally empty filter with the selected resource, changing the user's list on return.
5. Pod filter state initializes namespace/keyword from the query, but table filters initialize as empty (`frontend/src/app/workloads/pods/page.tsx:496`, `:519`). Merely returning `phase` does not restore the phase filter. No explicit list scroll snapshot/restore exists in this page. Capture table pagination, page size, sort, filters, horizontal/vertical scroll, and focused row before navigation, keyed by cluster and source route; restore only after data and table layout are ready. Keep shareable scope/search fields in the return URL and transient positioning in session storage.
6. Runtime pages already close sockets on unmount (`frontend/src/app/terminal/page.tsx:1001`) and explicit log return (`frontend/src/app/logs/page.tsx:1492`). Preserve cleanup and reconnect-generation guards while implementing return/fullscreen behavior. Add an active-terminal leave confirmation with Cancel preserving the session and Leave disconnecting it. Browser reload/tab close requires beforeunload handling rather than only guarding the return button.

## Authorization Risks

- P1: `backend/control-api/src/runtime/runtime.controller.ts:18` applies AuthGuard but takes user identity from `body.userId ?? fallbackUserId` (`:60`). The authenticated principal must be authoritative; client-supplied userId must never choose session ownership.
- P1: `backend/control-api/src/common/auth.guard.ts:15` checks authentication only. Runtime service creation (`backend/control-api/src/runtime/runtime.service.ts:118`) validates the target Pod then obtains cluster kubeconfig, but this path does not demonstrate per-principal cluster/namespace/exec authorization. `backend/control-api/src/logs/logs.controller.ts:26` forwards queries without principal scope. Namespace, log-read, exec, and container ownership checks must run server-side before session creation or historical reads, independent of menu visibility.
- Runtime bootstrap verifies session existence, closure, and expiry (`backend/control-api/src/runtime/runtime-session.service.ts:118`), but this is not evidence that already established sockets close on authorization revocation. Require a user/cluster/namespace-indexed session revocation mechanism in the gateway and test termination of active streams.
- Scoped route cluster and query cluster can disagree: runtime pages read clusterId from search params (`frontend/src/app/logs/page.tsx:581`). Canonicalize target identity and reject conflicts before creating sessions. Return targets must remain sanitized local paths and must not create loops through legacy or scoped runtime URLs (`frontend/src/lib/api/runtime.ts:79`).

## Implementation Order

1. Add log-center registry/allowlist/menu entry, retain runtime compatibility, update navigation assertions.
2. Add authenticated full-viewport runtime shell with shared context header, container selector, one return action, theme control, and connection state. Avoid duplicated frame/context/status toolbars.
3. Unify runtime return-context serialization/restoration and validate target/query consistency. Include Pod detail container actions and existing workload entry points in the route-builder audit before altering compatibility.
4. Enforce operation-level authorization and principal-derived session identity; connect revocation to active sockets. Coordinate these contracts with the identity implementation before claiming a secure multi-user runtime.
5. Run the acceptance scenarios below on local port 3000. This audit did not execute UI or backend tests.

## Executable Acceptance Scenarios

- Navigation: cluster sidebar contains one Log Center entry and no Pod Logs/Terminal entries. Old `/logs`, `/terminal`, and scoped runtime URLs remain supported with valid targets. Missing targets show a useful return action and create no sessions.
- Context: on Pod page choose a namespace, keyword, phase, sort, page size, page 2, and scroll; open logs/terminal then return. All values and position match, including empty keyword/all-namespace cases. Verify browser back, explicit return, direct link and expired stored snapshot.
- Containers: multi-container Pod opens the selected container; switching container terminates the previous socket. Deleted/recreated Pods and completed containers return accurate availability without silently operating on another container.
- Fullscreen: 1440/1280/1024/390px light/dark screenshots show runtime content occupying the viewport, no cluster sidebar, no overlapping controls, and readable terminal/log content. Keyboard return and focus restoration work.
- Connection lifecycle: leaving an active terminal presents confirmation; cancel leaves it usable; confirm closes it. Reload/unmount/revocation do not spawn reconnect loops. Logs stop when leaving.
- Authorization: a read-only principal cannot exec; a namespace-scoped principal cannot read another namespace's logs by changing URL/body; forged userId has no effect; route/query cluster mismatch is rejected; existing sessions terminate after privilege revocation.
- Regression: existing resource details/log links, navigation checks, frontend build and relevant runtime backend tests pass. Historical centralized log queries remain distinct from Pod live-log routes and APIs.
