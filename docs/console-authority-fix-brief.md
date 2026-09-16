# Immediate Authority Boundary Fix

Worktree: kubenova-console-source-scope. Base 4a64294. No schema, migration, production, cluster mutation or frontend changes.

Audit confirms existing allow-by-exclusion write guard accepts arbitrary role strings, and UsersService uses that guard to manage users/roles. Close these paths before the wider identity migration.

## Scope

1. common/governance.ts and tests: explicit write-role allowlist using current canonical roles plus existing admin/operator aliases if auth actually supplies them. Reject default user, read-only, unknown, missing. Do not infer a new role model.
2. users/users.service.ts and focused tests: create/update/delete/enable/disable users AND RBAC changes must require platform administrator (existing admin alias accepted). Ordinary operator and cluster administrator are not platform administrator. Validate any user role assignment against known supported canonical roles/aliases; reject arbitrary strings, including malformed objects. Preserve personal table preference APIs.
3. monitoring/observability.controller.ts + focused tests: data-source update must authorize the EXISTING source scope before any proposed destination scope, and must check both when moving. Current code checks destination only, allowing a scoped operator to steal an inaccessible source by changing clusterId. Keep existing scope creation policy unless a specific credential problem requires stricter handling.

Tests before implementation, including denied callers cannot mutate persistence, admin paths still work, user defaults, missing identity, malformed roles, source old/new scope checks. Existing tests may expect operator user administration; update those tests because the accepted user requirement explicitly makes administration superadmin-only, not to mask accidental failures. Report those behavioral changes.

Read repository patterns and skills. Commit only assigned files; no subagents, no servers. Run focused tests then backend build and full suite once. Report exact counts, blockers and residual risks. Root reviews/integrates. Other workers own log-center frontend and identity docs; do not touch those.
