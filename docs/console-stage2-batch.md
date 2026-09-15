# Console Stage 2 Batch

Base: 28fab14. Integrate only into codex/console-next; local frontend port 3000.

## Ownership

| Task | Owner/worktree suffix | Scope | Gate |
| --- | --- | --- | --- |
| Shell collapse/motion | shell-motion | Both shells, shared sidebar state, scoped CSS/tests | Persistence, keyboard, reduced motion, mobile navigation |
| Pod workbench cleanup | runtime-ui | Pod logs/terminal presentation and runtime-workbench CSS | Existing actions retained, no duplicate strips, full screen, light/dark |
| Log query foundation | log-query | New backend log-center module and app registration | Bounded queries, trusted source, authorization, sanitized errors |

Shared CSS conflicts: shell owns globals/sidebar styles; runtime owns runtime-workbench styles. Log query has no frontend edits. Root owns integration, contracts, evidence and plan.

## Log Query Brief

Implement an additive NestJS log-center module. Do not change existing Pod runtime log routes. Expose POST /api/log-center/query, authenticated, accepting clusterId, namespace (optional), dataSourceId, from/to ISO timestamps, keyword, limit. Resolve only an enabled Elasticsearch MonitoringDataSource with exact clusterId and id on the server. No client endpoint, DSL, index or field selection.

Initial gate: require existing platform-admin AND valid cluster access until granular log/namespace capabilities exist. This is a deliberate temporary fail-closed restriction, not finished namespace authorization. Never silently open the endpoint to current cluster viewers.

Review constraint: environment credential references must use a reserved KUBENOVA_ES_API_KEY_ prefix. Reject references to arbitrary process environment secrets (JWT, database, AI keys). Administrative query authority does not justify generic environment-secret export.

Use administrator-managed source metadata.logQuery with indexPattern, clusterField, namespaceField, timestampField, messageField; conservative validated field/index syntax, required explicit cluster binding filter. Defaults may use kubenova.cluster_id, kubernetes.namespace_name, @timestamp, message but document the exact shape. Source credentials: support an explicitly prefixed env reference to an Elasticsearch API key only; missing or unsupported reference fails closed. Never return credentials or raw Elasticsearch error bodies.

Enforce range <= 24h, result limit 1..200, bounded keyword length, HTTP timeout, response-size bound, no redirects. Server emits bool filters for clusterId and optional namespace, range, and plain text match (no query_string DSL). Reject malformed payloads. Return normalized rows only: id, timestamp, namespace, pod, container, message; capped strings. Return truthful missing source/unavailable/error state, no fake records. No database migration or cluster writes.

Tests first: unauthenticated/unauthorized, cross-cluster source, disabled/wrong kind, malformed/range/limit injection inputs, outgoing mandatory filters, timeout/upstream error redaction, malformed/oversized response, successful mapping. Mock only DB/transport. Reuse existing fetch patterns without new dependencies. Build + focused Jest tests. Commit assigned files only, report commands/results/known limitations. Do not spawn agents or start servers.

## Integration Rules

- Preserve user changes. No push/tag/production deployment.
- Review scope and behavior, rerun focused checks before integration.
- Build integrated frontend/backend before replacing local processes.
- Browser evidence must await content, not loader; test desktop/mobile light/dark.
- New log query foundation is not complete log center, collection lifecycle, or authorization.
