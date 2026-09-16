# Authorization Schema Slice

The Prisma schema now contains additive, inactive-by-default storage for identity groups, explicit user/group access grants, namespace UID scopes, sensitive capabilities, authorization changes, and user/session authorization versions.

This is storage only. Existing cluster role bindings remain the compatibility path until policy shadow evaluation and explicit cutover. No migration was applied to the local or production database in this slice. Before migration, generate a reviewed SQL migration and back up the database.

Invariants enforced by the future service layer: a grant targets exactly one user or group, an explicit existing cluster, explicit namespace UID rows, canonical role/capability values, and a valid lifetime. Unknown legacy values are disabled candidates, never elevated. `AuthorizationChange` is the durable audit/outbox precursor; it does not claim that Kubernetes RBAC or existing streams have been revoked.
