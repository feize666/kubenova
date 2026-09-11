# Findings

- The active platform-shell branch is clean at `5d3c5ae` and contains the observability controller access tests and deployment documentation.
- Production runs `goal-observability` control-api/frontend images while runtime-gateway remains `local`; PostgreSQL and Redis are healthy according to the prior rollout summary.
- The previous authenticated smoke attempt returned HTTP 400 because shell/JSON escaping likely corrupted the password payload. Retest with a temporary file or base64 payload.
- Existing production rollback backup: `/data/kubenova/backups/goal-20260911161147`.
- Production deploy initially revealed literal shell substitutions in four generated secrets; these were replaced with hex-only random values, the PostgreSQL role password was updated in place, and all sessions must re-authenticate. The AI credential encryption key was preserved.
- Current production containers are healthy on `kubenova-control-api:goal-enterprise`, `kubenova-frontend:goal-enterprise`, `kubenova-runtime-gateway:local`, PostgreSQL 16, and Redis 7. Public checks returned HTTP 200.
- Static frontend checks for observability, navigation, theme tokens, filters, drawers, resource tables, and workload routes pass. Three historical checks still reference removed routes (`workloads/helm`, `network/ingressroute`) or an external UI evidence spec and were not treated as product regressions.
