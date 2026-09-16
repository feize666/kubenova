# Console Logs and Identity Batch

Base: 4a64294. Remain local; do not publish or mutate production/managed clusters.

## Parallel Scope

- Log-center UI worker: frontend log-center page/API, canonical workspace route/navigation and focused tests; no backend files.
- Identity contract worker: backend authorization inventory and executable migration plan in docs/console-identity-contract.md; read-only code audit, no runtime/schema edits.
- Root: integration/verification, review log credential trust boundaries and prepare the next authorization implementation gate.

## Log-Center Acceptance

- Independent cluster log-center menu, not Pod logs/terminal.
- Reuse common themed surfaces/controls and shared namespace context. Search has explicit source, time preset, keyword, result limit. Source lookup exact cluster; no global fallback.
- Query current POST /api/log-center/query with cancellation, invalidate stale results on context changes, loading/error/empty states distinct.
- Current endpoint is admin-only; show explicit restriction for ordinary users, not misleading empty success.
- Real rows only; normalized text, bounded results, expandable/copyable message, no raw HTML.
- Existing data-source configuration link is usable. Do not add pretend enabled collection/alert actions. Advanced Kibana is deferred until verified source/access policy.
- Light/dark, mobile/desktop, request failure, absent source, stale response and cross-cluster context covered.

## Identity Audit Deliverable

Read current User/Session/ClusterRoleBinding, auth guard/session validation, users/RBAC management, resource proxies, HTTP and websocket runtime, kubeconfig endpoints, notification ownership. Map every enforcement boundary with paths. Identify where existing broad kubeconfig privileges permit bypass or escalation.

Provide ordered additive migrations, exact policy semantics, endpoint contract and minimum first implementation slice. Preserve audited recovery admin. Only superadmin grants/revokes; cluster admins inspect their scopes. Four roles and independent logs/exec/secrets/kubeconfig capabilities. User/group grants scope to explicit existing clusters and namespaces. Expired/revoked disabled bindings fail closed. Do not confuse UI filters with authorization.

Distinguish platform authorization, Kubernetes RBAC reconciliation and direct kubectl OIDC validity/revocation. Existing streams cannot universally be killed by Kubernetes RBAC. Group changes and global revocation require session/stream handling. Explain MFA policy administration versus user enrollment. Keycloak uses a standard supported OIDC library, not handwritten JWT verification; no account linking by unverified email.

This audit is a dependency-resolution gate, not completion of identity implementation.
