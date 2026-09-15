# Console Modernization Execution Plan

Baseline: v1.5 (2c5a2a6). Local validation only on frontend port 3000.
Production publication and deployment require user acceptance of local results.

## Accepted Scope

- Preserve blue/white and dark themes; normalize controls, motion, responsive tables and filters.
- Pod container logs and terminal are full-page contextual operations, not navigation entries.
- Cluster log center includes query, collection configuration and log alert rules.
- Existing Elasticsearch/Kibana preferred; optional Fluent Bit Helm and single-host stack.
- Authorization owns Keycloak/OIDC, groups, MFA and cluster/namespace grants. Only superadmins grant rights.
- MFA optional, administered only by superadmins; users enroll their own authenticators.
- Personal kubeconfig download opt-in; short-lived OIDC credentials and direct API access over VPN.
- Four preset roles; sensitive capabilities explicit. No automatic grants to future clusters.
- Monitoring owns cluster notification channels, delivery records and recovery notifications.
- Settings contains updates, AI configuration, backup/restore.
- Encrypted offsite OSS/S3 backups, 7 daily and 4 weekly copies; logs excluded by default.

## Stages and Gates

1. Baseline audit: route/component inventory, screenshot evidence, permission and deployment gaps.
2. UI/navigation: shared controls, responsive behavior, full-page Pod actions and return context. Gate: route tests, lint/build, light/dark screenshots.
3. Identity: additive schema, OIDC login, grants and Kubernetes reconciliation, MFA administration. Gate: cross-namespace denial, revoked sessions, native kubectl checks on supported clusters.
4. Logs: bounded scoped search, collection Helm lifecycle, retention settings. Gate: real collection/query, isolation, preview and rollback.
5. Monitoring: Grafana, log evaluation and cluster notification channels. Gate: trigger/recovery, duplicate suppression, retry and expired delivery behavior.
6. Operations: optional Compose profiles, resources, backup/restore. Gate: restore rehearsal, limits and upgrade rollback.
7. Local acceptance: build/test suites, browser responsive matrix, screenshots and explicit external integration gaps.

## Parallel Ownership

Root owns integration, migration ordering, shared interfaces, browser evidence and this plan.
Each active feature worker uses its own worktree and commits only its assigned files.
Initial independent tracks: UI audit; navigation/Pod-action audit. Identity/logs interface review follows.
No worker publishes, deploys remotely or changes user clusters during an audit.
Integrate only after scoped review and checks, then remove clean owned worktrees.

## Risks and Rollback

- API Server OIDC/issuer reachability varies by provider; expose unsupported state rather than claim support.
- Existing kubectl streams cannot be forcibly closed through RBAC changes alone.
- Workload creation can escalate via ServiceAccounts/privileged Pods; presets require explicit security boundaries.
- Kibana access requires verified data isolation; ordinary users have native scoped search until then.
- Single host is not HA. ES/Grafana/Keycloak require measured memory/disk budgets.
- Use additive migrations and feature gates; keep audited local-admin recovery during identity migration.
- Back up DB/config before migration. Do not force-reset existing branches or overwrite prior data.

## Progress

- [x] Stage 1 initial code audit and representative browser baseline (see console-stage1-results.md)
- [ ] Stage 2 UI/navigation
- [ ] Stage 3 identity
- [ ] Stage 4 logs
- [ ] Stage 5 monitoring
- [ ] Stage 6 operations
- [ ] Stage 7 local acceptance

Initial stage 2 fixes are implemented and tested; stage 2 is not complete. Remaining gates are recorded in console-stage1-results.md.

Second increment: persistent shell collapse, simplified full-screen workbenches and admin-only log query foundation are integrated. See console-stage2-batch.md for ownership/contracts and console-stage2-results.md for actual verification and unresolved gates. Stage 2 and stage 4 remain incomplete.
