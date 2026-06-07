# Ops Console Docker and Compose Deployment

本文件对应任务 11.4，说明镜像构建、Compose 运行配置、卷、网络、升级和销毁。Compose 入口为 `deploy/docker/docker-compose.prod.yml`。

## 镜像构建

当前仓库 Dockerfile：

- `frontend/Dockerfile`
- `backend/control-api/Dockerfile`
- `backend/runtime-gateway/Dockerfile`

示例构建：

```bash
docker build -t kubenova-frontend:local frontend
docker build -t kubenova-control-api:local backend/control-api
docker build -t kubenova-runtime-gateway:local backend/runtime-gateway
```

## 配置

复制变量模板：

```bash
cd deploy/docker
cp .env.example .env
```

编辑 `deploy/docker/.env`，至少替换：

- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `RUNTIME_TOKEN_SECRET`
- `RUNTIME_GATEWAY_INTERNAL_SECRET`
- `DEFAULT_ADMIN_PASSWORD`
- `CONTROL_API_BASE_URL`
- `CORS_ORIGINS`
- `RUNTIME_GATEWAY_BASE_URL`
- `RUNTIME_GATEWAY_PUBLIC_BASE_URL`
- `NEXT_PUBLIC_CONTROL_API_BASE`

如使用本地镜像，设置：

```dotenv
FRONTEND_IMAGE=kubenova-frontend:local
CONTROL_API_IMAGE=kubenova-control-api:local
RUNTIME_GATEWAY_IMAGE=kubenova-runtime-gateway:local
```

## 启动

```bash
cd deploy/docker
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

状态：

```bash
docker compose -f docker-compose.prod.yml ps
```

日志：

```bash
docker compose -f docker-compose.prod.yml logs -f --tail=200
docker compose -f docker-compose.prod.yml logs -f --tail=200 control-api
```

停止：

```bash
docker compose -f docker-compose.prod.yml down
```

## 卷

Compose 定义两个持久卷：

- `kubenova_postgres_data`
- `kubenova_redis_data`

查看：

```bash
docker volume ls | grep kubenova_
```

备份示例：

```bash
docker run --rm -v kubenova_postgres_data:/data -v "$PWD":/backup alpine tar czf /backup/kubenova_postgres_data.tgz -C /data .
docker run --rm -v kubenova_redis_data:/data -v "$PWD":/backup alpine tar czf /backup/kubenova_redis_data.tgz -C /data .
```

## 网络

Compose 使用默认项目网络。服务名：

- `postgres`
- `redis`
- `control-api`
- `runtime-gateway`
- `frontend`

内部连接：

- control-api 使用 `postgres:5432`
- control-api 使用 `redis:6379`
- runtime-gateway 默认使用 `http://control-api:4000`
- frontend 容器内默认可使用 `http://control-api:4000`

外部端口由 `.env` 控制：

- `FRONTEND_PORT`
- `CONTROL_API_PORT`
- `RUNTIME_GATEWAY_PORT`

## 健康检查

Compose 清单内置健康检查：

- postgres: `pg_isready`
- redis: `redis-cli ping`
- control-api: `GET /api/capabilities`
- runtime-gateway: `GET /healthz`
- frontend: `GET /`

运行后复核：

```bash
docker compose -f docker-compose.prod.yml ps
curl -fsS http://127.0.0.1:${FRONTEND_PORT:-3000}/ >/dev/null && echo frontend-ok
curl -fsS http://127.0.0.1:${CONTROL_API_PORT:-4000}/api/capabilities >/dev/null && echo control-api-ok
curl -fsS http://127.0.0.1:${RUNTIME_GATEWAY_PORT:-4100}/healthz && echo
```

## 升级

使用远端镜像：

```bash
cd deploy/docker
docker compose -f docker-compose.prod.yml --env-file .env pull
docker compose -f docker-compose.prod.yml --env-file .env up -d
docker compose -f docker-compose.prod.yml ps
```

使用本地新镜像：

```bash
docker build -t kubenova-frontend:local frontend
docker build -t kubenova-control-api:local backend/control-api
docker build -t kubenova-runtime-gateway:local backend/runtime-gateway
cd deploy/docker
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

control-api 镜像启动命令会执行 `npx prisma migrate deploy`，升级前需确认数据库备份策略。

## 回滚

将 `.env` 中镜像 tag 改回上一版本，然后执行：

```bash
cd deploy/docker
docker compose -f docker-compose.prod.yml --env-file .env up -d
docker compose -f docker-compose.prod.yml ps
```

## 销毁

停止并保留数据卷：

```bash
cd deploy/docker
docker compose -f docker-compose.prod.yml down
```

停止并删除数据卷：

```bash
cd deploy/docker
docker compose -f docker-compose.prod.yml down -v
```

删除数据卷会删除 PostgreSQL 和 Redis 持久数据。执行前先确认备份。
