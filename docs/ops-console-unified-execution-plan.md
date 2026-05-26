# Ops Console Unified Experience Execution Plan

## Scope

Primary spec: `.codex/specs/ops-console-unified-experience`.

Current delivery order:

1. Freeze gates and compatibility boundaries.
2. Reduce service script command surface and add diagnostics.
3. Establish performance and stability baselines.
4. Harden shared shell, tables, drawers, filters, and theme behavior.
5. Deliver cluster domain, worker nodes, network resources, global detail drawers, panorama, observability, and AIOps.
6. Produce delivery summary and deployment documentation.
7. Run release gate validation.

## Non-Goals

- No destructive git cleanup.
- No unrelated formatting churn.
- No silent deletion of legacy scripts before wrappers or migration notes exist.
- No feature work without the smallest relevant validation for the touched scope.

## Baseline Decisions

- `scripts/service.sh` is the recommended command entrypoint.
- Existing scripts remain compatibility entrypoints.
- Script changes must not start or stop services during static validation unless the command explicitly requests runtime behavior.
- Documentation examples must map to real repository commands and files.

## Parallel Slices

| Slice | Scope | Output | Minimal Verification |
| --- | --- | --- | --- |
| Service scripts | `scripts/service.sh`, `scripts/README.md`, service docs | Unified entrypoint, compatibility map, failure diagnostics | `bash -n scripts/*.sh`, `bash scripts/service.sh help`, `bash scripts/service.sh dev status` |
| Performance baseline | `docs/performance-stability-baseline.md`, later tooling | Performance thresholds and evidence plan | doc review plus targeted smoke command |
| Shared UI | `frontend/src/components/*`, `frontend/src/app/globals.css` | Stable shell/table/drawer/filter behaviors | frontend lint/typecheck or changed-file focused check |
| Backend reliability | `backend/control-api/src/**`, runtime gateway | timeout/recovery/validation/health checks | targeted unit tests and build |
| Deployment docs | `docs/deployment.md`, `docs/operations.md`, `README.md` | binary/Docker/Compose/K8S procedures | command existence and manifest review |

## Gate Rules

- Each merged slice must list changed files and verification commands.
- Failed verification blocks phase progression until fixed or explicitly accepted.
- Generated logs, traces, screenshots, and temp files must be cleaned in the same work session unless preserved intentionally.
- Agents are close-after-use: when a worker result is read and integrated, close that agent immediately.

## Current Baseline Evidence

- `bash -n scripts/service.sh scripts/dev-up.sh scripts/dev-down.sh scripts/dev-status.sh scripts/prod-up.sh scripts/prod-down.sh scripts/prod-status.sh`: passed.
- `bash scripts/service.sh help`: passed.
- `bash scripts/service.sh dev status`: passed; frontend, control-api, and runtime-gateway were healthy on local ports 3000/4000/4100.
- `bash scripts/service.sh prod status`: passed in read-only detection mode; no `.prod` PID files were written while local dev services occupied the ports.
- `bash scripts/service.sh clean topology-artifacts --dry-run`: passed.
- `bash scripts/service.sh nope`: returned exit code 2 with explicit diagnostic output, as expected.
- `cd frontend && npm run lint -- --max-warnings=0`: passed.
- `cd backend/control-api && npm run test -- --runInBand --passWithNoTests`: passed, 25 suites / 87 tests.
- `cd backend/runtime-gateway && go test ./...`: passed.
- `node --check frontend/scripts/performance-switching.mjs`: passed.
- `cd frontend && PERF_USER=admin@local.dev PERF_PASS=admin123456 PERF_SAMPLE_COUNT=1 npm run e2e:performance:switching`: blocked because Playwright is not installed in current dependencies; script failed with an actionable install message.
