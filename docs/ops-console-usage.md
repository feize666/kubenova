# Ops Console Usage Guide

本文件对应 `ops-console-unified-experience` 任务 11.2，汇总项目使用、配置、健康检查、日志、升级、回滚和排障入口。命令均映射到当前仓库已有脚本或文件。

## 先决条件

本地开发需要：

- `bash`
- `node`
- `npm`
- `curl`
- `fuser`（RHEL 系可由 `psmisc` 提供）
- PostgreSQL 与 Redis
- 如启动 runtime-gateway：`go`

生产二进制运行还需要：

- `systemd`
- `psql`
- `redis-cli`

Docker / Compose 运行需要：

- Docker
- Docker Compose v2（`docker compose`）

Kubernetes 运行需要：

- `kubectl`
- 可用 Kubernetes context
- Ingress Controller（现有清单默认 `nginx`）

## 统一命令入口

推荐入口：

```bash
bash scripts/service.sh help
```

常用开发命令：

```bash
bash scripts/service.sh install-deps
bash scripts/service.sh db-init
bash scripts/service.sh dev up
bash scripts/service.sh dev status
bash scripts/service.sh dev logs
bash scripts/service.sh dev down
```

生产发布目录命令：

```bash
bash scripts/service.sh prod install
bash scripts/service.sh prod up
bash scripts/service.sh prod status
bash scripts/service.sh prod logs
bash scripts/service.sh prod switch <version>
bash scripts/service.sh prod rollback <version>
bash scripts/service.sh prod down
```

构建命令：

```bash
bash scripts/service.sh build control-api
bash scripts/service.sh build frontend
bash scripts/service.sh build runtime-gateway
bash scripts/service.sh build all
```

兼容旧入口说明见 [scripts/README.md](../scripts/README.md)。

## 配置与环境变量

control-api 核心变量：

- `NODE_ENV`
- `PORT`
- `CONTROL_API_BASE_URL`
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `REFRESH_TOKEN_EXPIRES_IN`
- `RUNTIME_GATEWAY_BASE_URL`
- `RUNTIME_GATEWAY_PUBLIC_BASE_URL`
- `RUNTIME_GATEWAY_INTERNAL_SECRET`
- `CORS_ORIGINS`
- `SWAGGER_ENABLED`
- `DEFAULT_ADMIN_EMAIL`
- `DEFAULT_ADMIN_PASSWORD`
- `AI_MODEL_BASE_URL`
- `AI_MODEL_API_KEY`
- `AI_MODEL_NAME`
- `AI_MODEL_MAX_TOKENS`
- `AI_MODEL_TIMEOUT_MS`

runtime-gateway 核心变量：

- `PORT`
- `NODE_ENV`
- `CONTROL_API_BASE_URL`
- `RUNTIME_TOKEN_SECRET`
- `RUNTIME_GATEWAY_INTERNAL_SECRET`
- `ALLOWED_ORIGINS`
- `FRONTEND_STATIC_DIR`（可选）

现有模板：

- `deploy/systemd/env/control-api.env.example`
- `deploy/systemd/env/runtime-gateway.env.example`
- `deploy/docker/.env.example`
- `deploy/k8s/platform-config.yaml`

生产环境必须替换默认密钥和默认密码，至少包含：

- `JWT_SECRET`
- `RUNTIME_TOKEN_SECRET`
- `RUNTIME_GATEWAY_INTERNAL_SECRET`
- `DEFAULT_ADMIN_PASSWORD`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`

## 首次运行

开发模式：

```bash
bash scripts/service.sh install-deps
bash scripts/service.sh db-init
bash scripts/service.sh dev up
bash scripts/service.sh dev status
```

默认端口：

- frontend: `3000`
- control-api: `4000`
- runtime-gateway: `4100`

默认开发账号见 [backend/control-api/README.md](../backend/control-api/README.md)。

## 健康检查

本地或二进制部署：

```bash
curl -fsS http://127.0.0.1:3000/ >/dev/null && echo frontend-ok
curl -fsS http://127.0.0.1:4000/api/capabilities >/dev/null && echo control-api-ok
curl -fsS http://127.0.0.1:4100/healthz && echo
```

脚本状态：

```bash
bash scripts/service.sh dev status
bash scripts/service.sh prod status
```

Kubernetes 状态：

```bash
kubectl get pods -n aiops
kubectl get svc -n aiops
kubectl get ingress -n aiops
kubectl rollout status deploy/control-api -n aiops
kubectl rollout status deploy/runtime-gateway -n aiops
kubectl rollout status deploy/frontend -n aiops
```

## 日志

开发日志：

```bash
bash scripts/service.sh dev logs
bash scripts/service.sh dev logs frontend
bash scripts/service.sh dev logs control-api
bash scripts/service.sh dev logs runtime-gateway
```

生产脚本日志：

```bash
bash scripts/service.sh prod logs
bash scripts/service.sh prod logs control-api
```

systemd 日志：

```bash
journalctl -u aiops-control-api.service -n 200 --no-pager
journalctl -u aiops-runtime-gateway.service -n 200 --no-pager
```

Kubernetes 日志：

```bash
kubectl logs -n aiops deploy/control-api --tail=200
kubectl logs -n aiops deploy/runtime-gateway --tail=200
kubectl logs -n aiops deploy/frontend --tail=200
```

## 升级与回滚

二进制发布目录升级：

```bash
bash scripts/service.sh prod switch <version>
bash scripts/service.sh prod status
```

二进制回滚：

```bash
bash scripts/service.sh prod rollback <previous-version>
bash scripts/service.sh prod status
```

Docker Compose 升级：

```bash
cd deploy/docker
docker compose -f docker-compose.prod.yml --env-file .env pull
docker compose -f docker-compose.prod.yml --env-file .env up -d
docker compose -f docker-compose.prod.yml ps
```

Kubernetes 升级：

```bash
kubectl apply -k deploy/k8s
kubectl rollout status deploy/control-api -n aiops
kubectl rollout status deploy/runtime-gateway -n aiops
kubectl rollout status deploy/frontend -n aiops
```

Kubernetes 回滚：

```bash
kubectl rollout undo deploy/control-api -n aiops
kubectl rollout undo deploy/runtime-gateway -n aiops
kubectl rollout undo deploy/frontend -n aiops
```

## 排障速查

- `bash scripts/service.sh help`：查看真实命令面。
- `bash scripts/service.sh dev status` / `prod status`：确认进程与端口。
- `curl -fsS http://127.0.0.1:4000/api/capabilities`：确认 control-api。
- `curl -fsS http://127.0.0.1:4100/healthz`：确认 runtime-gateway。
- `psql "$DATABASE_URL" -c "SELECT 1"`：确认 PostgreSQL。
- `redis-cli ping`：确认 Redis。
- `kubectl describe pod -n aiops <pod>`：确认 K8s 事件、探针、镜像拉取。

## 关联文档

- [二进制部署](ops-console-binary-deployment.md)
- [Docker 与 Compose 部署](ops-console-docker-compose.md)
- [Kubernetes 部署](ops-console-kubernetes-deployment.md)
- [Delivery Summary](ops-console-delivery-summary.md)
