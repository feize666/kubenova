# Ops Console Unified Experience Delivery Summary

本文件对应任务 11.1，记录 `ops-console-unified-experience` 当前交付范围、关键变更、验证证据、限制、回滚和后续建议。

## 完成范围

已完成并有本地验证记录的范围：

- 服务脚本瘦身：统一入口 `scripts/service.sh`，保留旧脚本兼容入口。
- 集群域导航：新增 `集群域管理`，包含集群、名称空间、工作节点链路。
- 集群详情与工作节点：后端补充只读节点接口，前端补充工作节点页和详情抽屉。
- NetworkPolicy 与 Gateway API：后端 live resource 支持与前端入口对齐。
- 全局详情抽屉审计：补充覆盖矩阵，记录 Headlamp 对标缺口。
- 可观测性中心：新增 summary API、数据源状态、实体健康、SLO、深链字段和前端中心页。
- AIOps 中台：新增 summary API、事故队列、根因候选、推荐动作、precheck、审批审计和前端工作台。
- 性能与稳定性硬化：前端请求取消、切换性能脚本覆盖新路由、后端 metrics fanout 并发上限与超时兜底、AIOps 时间范围校验。
- 文档收口草案：项目使用、二进制、Docker/Compose、Kubernetes、Delivery Summary。

## 关键变更

脚本与部署：

- 推荐命令入口统一为 `bash scripts/service.sh <command>`。
- `deploy/docker/docker-compose.prod.yml` 提供 frontend、control-api、runtime-gateway、postgres、redis 组合。
- `deploy/k8s` 提供 Kustomize 清单。
- `deploy/systemd` 提供 systemd unit 与环境模板。

后端：

- `GET /api/clusters/:id/nodes` 工作节点只读链路。
- `GET /api/monitoring/observability/summary` 可观测性聚合链路。
- `GET /api/aiops/summary` AIOps 聚合链路。
- `POST /api/aiops/recommendations/precheck` 与 `POST /api/aiops/recommendations/approve` 审计链路。
- monitoring overview live metrics 分批 fanout，默认并发上限 4，单集群 live metrics 2500ms timeout fallback。

前端：

- 新增 `/clusters/nodes`、`/observability`、`/aiops`。
- 导航补充 `集群域管理`、`可观测性中心`、`AIOps中台`。
- 新中心页接入统一时间范围、数据源降级、详情抽屉和请求取消。

文档：

- [使用总览](ops-console-usage.md)
- [二进制部署](ops-console-binary-deployment.md)
- [Docker 与 Compose](ops-console-docker-compose.md)
- [Kubernetes 部署](ops-console-kubernetes-deployment.md)
- [性能稳定性回归](performance-stability-regression.md)
- [全局详情抽屉审计](global-detail-drawer-audit.md)
- [可观测性回归矩阵](observability-regression-matrix.md)
- [AIOps 回归矩阵](aiops-regression-matrix.md)

## 验证证据

本 spec 已记录过的验证：

- `bash -n scripts/service.sh scripts/dev-up.sh scripts/dev-down.sh scripts/dev-status.sh scripts/prod-up.sh scripts/prod-down.sh scripts/prod-status.sh`：passed。
- `bash scripts/service.sh help`：passed。
- `bash scripts/service.sh dev status`：passed。
- `bash scripts/service.sh prod status`：passed。
- `bash scripts/service.sh clean topology-artifacts --dry-run`：passed。
- `cd backend/control-api && npm run test -- clusters.service.spec.ts clusters.controller.spec.ts --runInBand`：passed，7 tests。
- `cd backend/control-api && npm run test -- network.service.spec.ts --runInBand`：passed，6 tests。
- `cd backend/control-api && npm run test -- resources.service.spec.ts --runInBand`：passed，10 tests。
- `cd backend/control-api && npm run test -- monitoring.controller.spec.ts --runInBand`：passed，1 test。
- `cd backend/control-api && npm run test -- aiops.controller.spec.ts monitoring.controller.spec.ts --runInBand`：passed，2 suites / 7 tests。
- `cd backend/control-api && npm run build`：passed。
- `cd frontend && npm run lint -- --max-warnings=0`：passed。
- `cd frontend && npx tsc --noEmit --incremental false`：passed。
- `cd frontend && npm run build`：passed。
- `cd backend/runtime-gateway && go test ./...`：passed。
- `node --check frontend/scripts/performance-switching.mjs`：passed。
- Browser route loop via Playwright MCP：10 routes reachable, `consoleErrorCount=0`, `pageErrorCount=0`。
- Backend pressure smoke：20 authenticated requests, concurrency 5, all `200`, no 5xx, p95 about `2554ms`。
- Table preference smoke：`GET`/`PUT /api/users/preferences/table/business.clusters` returned `200` with volatile fallback when preference storage is unavailable。
- AIOps inverted time-range smoke：returned `400 REQUEST_FAILED`。
- `git diff --check`：passed。

本轮 12.8 服务脚本与部署文档专项回归（2026-05-29）：

- `bash scripts/service.sh help`：passed，输出覆盖 `dev`、`prod`、`build`、`test`、`clean`、`topology`、`help`。
- `bash -n scripts/*.sh`：passed，全部 shell 脚本语法检查通过。
- `bash scripts/service.sh prod status`：passed，只读状态检查；当前检测到 frontend/control-api/runtime-gateway 在 3000/4000/4100 运行且 health 正常，未执行 up/down/switch/rollback。
- Markdown 本地文件引用检查：passed，`docs/ops-console-delivery-summary.md`、`docs/ops-console-unified-execution-plan.md`、`docs/ops-console-usage.md`、`docs/ops-console-binary-deployment.md`、`docs/ops-console-docker-compose.md`、`docs/ops-console-kubernetes-deployment.md`、`.codex/specs/ops-console-unified-experience/tasks.md` 内相对文件链接均存在。
- package scripts 存在性检查：passed，`frontend/package.json` 含 `build`、`build:stable`、`dev`、`lint`、`start`、`start:stable` 等脚本；`backend/control-api/package.json` 含 `build`、`start:prod`、`test`、`test:unit`、`lint` 等脚本；`backend/runtime-gateway` 无 `package.json`，按 Go 模块与 `Makefile` 的 `run`、`tidy`、`release-build`、`release-run` 管理。
- 部署文件存在性检查：passed，确认 `frontend/Dockerfile`、`backend/control-api/Dockerfile`、`backend/runtime-gateway/Dockerfile`、`deploy/docker/docker-compose.prod.yml`、`deploy/docker/.env.example`、`deploy/k8s/*.yaml`、`deploy/packages/nfpm.yaml`、`deploy/binary/install-layout.md`、`deploy/systemd/*`、`deploy/systemd/env/*.example` 存在。
- `command -v docker`、`command -v kubectl`、`command -v kustomize`：blocked by host tooling，三者均 missing；未执行 Compose config、K8s render/server dry-run 或真实部署。
- `git diff --check`：passed。

历史 11.6 文档命令可用性检查：

- `bash scripts/service.sh prod status`：passed，只读状态检查；当前检测到 frontend/control-api/runtime-gateway 在 3000/4000/4100 运行且 health 正常。
- `command -v docker kubectl kustomize`：blocked by host tooling，三者均 missing。
- `git diff --check`：passed。

本轮 12.10 go/no-go 与回滚可用性验证（2026-05-30）：

- `bash scripts/service.sh help`：passed，help 输出包含 `prod rollback <version>`、`prod switch <version>`、`prod status`、`build`、`test`、`clean` 等发布门禁相关入口。
- `bash -n scripts/*.sh`：passed，当前脚本语法检查通过。
- `bash scripts/service.sh prod status`：passed，只读状态检查；当前 frontend/control-api/runtime-gateway 均未运行，命令仍返回日志目录与组件状态，未执行启动、停止、切换或回滚。
- Markdown 本地文件引用检查：passed，`docs/ops-console-delivery-summary.md`、`docs/ops-console-unified-execution-plan.md`、`docs/ops-console-usage.md`、`docs/ops-console-binary-deployment.md`、`docs/ops-console-docker-compose.md`、`docs/ops-console-kubernetes-deployment.md`、`.codex/specs/ops-console-unified-experience/tasks.md` 内相对文件链接均存在。
- 部署/回滚文件存在性检查：passed，确认 `docs/ops-console-usage.md`、`docs/ops-console-binary-deployment.md`、`docs/ops-console-docker-compose.md`、`docs/ops-console-kubernetes-deployment.md`、`scripts/service.sh`、`scripts/prod-switch.sh`、`scripts/prod-rollback.sh` 存在。
- `bash scripts/service.sh prod rollback`：expected failure，未传 `<version>` 时输出 `用法: bash scripts/prod-rollback.sh <version>`，未修改服务状态。
- 隔离回滚演练：passed，在临时 `RELEASE_BASE` 与临时 `systemctl` shim 下执行 `bash scripts/prod-rollback.sh previous`，验证 `current` symlink 可切到 `releases/previous`；临时目录已清理，未触碰真实 `/opt/k8s-aiops-manager` 或真实 systemd 服务。
- `git diff --check`：passed（编辑前）；`git diff --no-index --check /dev/null docs/ops-console-delivery-summary.md`：passed，用于覆盖当前未跟踪 summary 文件的 whitespace 检查。

12.10 判定：可判定通过。理由是本轮已完成 go/no-go 评估输入核对、文档回滚路径核对、service 回滚入口核对和隔离回滚可用性验证。

发布 go/no-go 结论：No-Go。当前不建议发布，除非 release owner 明确批准例外。当前 12.2 与 12.5 已完成补充回归，但发布仍未获批准。阻断原因：

- 当前主机缺少 Docker/Kubernetes 工具链，Compose/K8s 渲染、dry-run、真实部署健康检查和真实 rollback/rollout undo 未验证。
- 本轮生产状态检查显示本机 frontend/control-api/runtime-gateway 未运行，不能作为运行中生产服务健康证据。
- 二进制回滚只完成脚本级隔离演练，未用正式 release archive 在真实 systemd 环境验证服务重启后的健康状态。

12.11 发布标记结论（2026-06-02）：未发布，不创建 annotated tag，不推送 tag。原因是 release owner 未明确批准发布，且上述真实发布环境验证仍未完成。可追踪记录保留在本文件、`docs/ops-console-unified-execution-plan.md` 与 `.codex/specs/ops-console-unified-experience/tasks.md`。

本轮 12.9 性能与稳定性专项回归补充（2026-05-30）：

- `bash scripts/service.sh dev up`：passed，启动 frontend/control-api/runtime-gateway。
- `bash scripts/service.sh dev status`：passed，frontend/control-api/runtime-gateway 在 3000/4000/4100 均 `health=正常`。
- Playwright MCP route-switch fresh smoke：covered `/dashboard`、`/clusters`、`/clusters/nodes`、`/network/networkpolicy`、`/network/gateway-api`、`/network/topology`、`/observability`、`/observability/cluster-health`、`/aiops`、`/ai-assistant`；`p50Ms=2279`、`p95Ms=4046`、`maxMs=4046`、`consoleErrorCount=0`、`pageErrorCount=0`、`requestCount=240`。
- Playwright MCP interaction fresh smoke：cluster drawer open `152ms`，Gateway API tab switch `343ms`，Gateway API filter panel `374ms`，topology cluster selector `1823ms`，observability time range `837ms`；all with `consoleErrorCount=0` and `pageErrorCount=0`。
- Authenticated backend pressure smoke：20 requests, concurrency 5, endpoints `capabilities`、table preferences、observability summary、AIOps summary；`20/20` returned 200, no 5xx, `p50Ms=9`、`p95Ms=2531`、`maxMs=2532`。
- AIOps error-path smoke：inverted `from`/`to` returned `400 REQUEST_FAILED` with message `` `from` 不能晚于 `to` ``。
- 12.9 follow-up：fixed topology selectable-cluster fallback and optional Gateway API dynamic reads. `/network/topology` retest rendered `7` React Flow nodes, focused the first node in `708ms`, and produced `consoleErrorCount=0`、`pageErrorCount=0`、API 4xx/5xx count `0`。
- 12.9 decision：representative release-gate scope passed. Long soak, heap/memory leak, shutdown/recovery, and production-mode stress remain deeper follow-up items.

## 已知限制

- `cd frontend && PERF_USER=admin@local.dev PERF_PASS=admin123456 PERF_SAMPLE_COUNT=1 npm run e2e:performance:switching` 曾因当前依赖未安装 Playwright 被阻塞；本轮浏览器验证改用可用的 Playwright MCP。
- 长稳 soak 测试未执行；本轮只执行轻量并发 pressure smoke。
- Kubernetes 清单未包含显式 RBAC、requests/limits、HPA、NetworkPolicy、TLS Secret 示例。
- Compose 和 K8s 文档未执行真实部署；本轮仅完成本机可执行的静态/非破坏检查。
- 当前主机缺少 `docker`、`kubectl`、`kustomize`，所以未执行 Docker Compose config、K8s render/server dry-run 或真实部署验证。
- 二进制发布包装配流程当前仍是文档化流程，未产出正式 release archive。
- 全局详情抽屉仍有已记录缺口：泛型 CRD 关系推断、拓扑详情 Headlamp 对齐、Helm 动作语义、权限/数据源不可用态回归证据。

## 回滚说明

脚本 / 二进制部署：

```bash
bash scripts/service.sh prod rollback <previous-version>
bash scripts/service.sh prod status
```

Docker Compose：

```bash
cd deploy/docker
docker compose -f docker-compose.prod.yml --env-file .env up -d
docker compose -f docker-compose.prod.yml ps
```

回滚时把 `.env` 中镜像 tag 改回上一版本。

Kubernetes：

```bash
kubectl rollout undo deploy/control-api -n aiops
kubectl rollout undo deploy/runtime-gateway -n aiops
kubectl rollout undo deploy/frontend -n aiops
```

如配置或 Secret 变更也参与发布，需同步恢复对应清单版本。

## 后续建议

- 执行 10.6：浏览器 console loop、后端 error-path、压力或长稳验证。
- 在具备 Docker/Kubernetes 工具的环境补跑 Docker Compose config、K8s render/server dry-run 和真实部署健康检查。
- 为 `deploy/k8s` 增加生产 overlay：RBAC、resources、TLS、HPA、NetworkPolicy、Secret 管理策略。
- 产出 release archive 构建脚本，减少二进制发布手工装配步骤。
- 用真实部署环境补齐 Docker/Compose/K8s 健康检查截图或日志证据。
