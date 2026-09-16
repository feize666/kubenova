# Authority Boundary Review

Date: 2026-09-16. Range: 4a64294..bd8cda7. Strategy: surgical review of high-risk authorization paths in a large repository. Local only.

## Executive Summary

Two existing high-severity defects were reproduced with failing tests and corrected: permissive user administration and source-scope reassignment. Recommend integrating these restrictions; do not treat the wider platform as ready for ordinary OIDC users yet.

## Findings and Fixes

1. `common/governance.ts:42` accepted every nonempty role except literal read-only. `git blame` traces this to baseline 6335629. `users/users.service.ts` used it in eight user/RBAC mutation methods. An authenticated ordinary user could invoke user creation/promotion, password changes or RBAC changes. Tests reproduced successful persistence for unauthorized actors. The shared guard now explicitly allows known writable roles; all eight administration methods use a separate administrator-only predicate. User role payloads reject unknown strings and nonstrings. Existing admin aliases remain compatible until the reviewed canonical-role migration.
2. `monitoring/observability.controller.ts:72` authorized a proposed destination rather than the existing data source. An operator with one cluster could claim an inaccessible or global source by patching its clusterId. Tests reproduced both cases. Update now checks existing scope first and a different destination second. Unauthorized requests cannot reach persistence.

## Blast Radius

The baseline write helper occurred 63 times across 16 production files (one definition, 62 calls). Eight user/RBAC paths were moved to the stricter administration helper. Other writable roles continue to work; default user and malformed/unknown roles now fail closed. This helper is not a replacement for namespace/capability checks.

Reviewed all three changed production files and their new/changed focused tests. Existing auth guard and cluster access were read as one-hop dependencies. No removed security checks were found; permissions were tightened. Full backend suite passed in the feature worktree: 57 suites / 397 tests; production build passed. Focused red/green evidence: 15 failures before role fix; two source takeover failures before source fix; all pass after correction.

## Residual Risks Before General-User Rollout

- Preserve the last recovery administrator using a serialized database invariant; durable audit and universal session invalidation are not delivered by this patch.
- Legacy resource routes, dynamic Secrets/RBAC and shared administrative cluster credentials still need the complete policy boundary described in console-identity-contract.md.
- UI administration affordances and directory reads must be aligned with final scoped inspection rules.
- Runtime parent-session linkage, stream termination and Kubernetes reconciliation remain unimplemented.
- Source ownership changes have no versioned transaction with the authorization check yet; administrative concurrent relocation needs optimistic concurrency in the broader configuration model.

No live exploit, managed-cluster write, production mutation or dependency remediation was performed. Confidence is high for the reproduced two paths, not a platform-wide security approval.
