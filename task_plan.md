# KubeNova enterprise observability and AI modernization

## Goal

Finish the current enterprise observability and AI modernization with real evidence-backed analysis, production authentication smoke tests, rollback verification, and a requirement audit. Preserve secrets, existing worktrees, and unrelated user changes.

## Scope

- In scope: AI evidence aggregation, observability data-source and alert contracts, cluster-scoped AI access, blue-white frontend configuration/analysis surfaces, local and production verification, rollback readiness.
- Out of scope: replacing the source architecture, deleting production data, rotating the existing production AI encryption key, or publishing secrets.

## Work plan and gates

1. **Recover and inspect** (complete): read current branches, agent status, plan artifacts, and production backup metadata. Gate: no unexplained worktree mutation.
2. **AI evidence aggregation** (complete): combine Prometheus, Elasticsearch, events, and topology evidence in cluster analysis. Gate: focused backend tests and build pass; diff remains within AI context modules.
3. **Production release audit** (complete): validate service health, image/config parity, authenticated API paths, and rollback materials. Gate: no secret leakage; authenticated smoke succeeds or exact blocker recorded.
4. **Integrate and regression test** (complete): review agent diffs, cherry-pick only verified commits, run backend/frontend builds and focused tests. Gate: all required suites pass.
5. **Final requirement audit** (complete): inspect implementation against AI providers, observability stack, UI, security, deployment, and user-requested behavior. Gate: every item marked verified, residual risks documented.

## Parallel matrix

| Task | Worktree | Scope | Verification | Dependency |
|---|---|---|---|---|
| AI evidence aggregation | `.worktrees/kubenova-ai-context-aggregator` | AI analysis context/evidence modules and tests | focused AI tests, backend build | existing platform shell contracts |
| Production release audit | `.worktrees/kubenova-production-release-audit` | audit scripts/reports only; no product code or secret changes | health/API/rollback checks | deployed goal-observability images |
| Integration | `.worktrees/kubenova-platform-shell` | main branch integration and regression | full backend tests/build, frontend lint/build | tasks 2-3 |

## Rollback strategy

Production Compose and environment backup is under `/data/kubenova/backups/goal-20260911161147`. Keep the generated `AI_CREDENTIAL_ENCRYPTION_KEY` unchanged. Roll back by restoring the backed-up Compose/env and prior image tags, then rerun health probes.

## Decisions / risks

- Use a safe temporary JSON file or base64 payload for login smoke tests because the configured password contains shell-significant characters.
- Never print access tokens, passwords, API keys, or encryption keys.
- GitHub push remains unconfirmed due prior network hang; production was staged from an archive and must be reported separately.

## Acceptance checklist

- [x] AI analysis consumes real observability evidence and has focused tests.
- [x] Production authenticated calls pass for observability catalog/data sources and AI agents; cluster analysis route is ready but no production cluster exists to exercise it.
- [x] Production service health and rollback materials are verified.
- [x] Backend/frontend builds and relevant tests pass after integration.
- [x] Requirement-by-requirement audit complete with residual risks.
