# Docker Compose (Production)

该目录提供统一的生产 Docker Compose 部署入口：

- `docker-compose.prod.yml`: frontend + control-api + runtime-gateway + postgres + redis
- `.env.example`: 生产变量模板

## 1) 变量说明

先复制模板：

```bash
cd deploy/docker
cp .env.example .env
```

关键变量：

- `CONTROL_API_IMAGE`: control-api 镜像
- `RUNTIME_GATEWAY_IMAGE`: runtime-gateway 镜像
- `FRONTEND_IMAGE`: frontend 镜像
- `FRONTEND_PORT`: 对外暴露的 frontend 端口（默认 `3000`）
- `CONTROL_API_PORT`: 对外暴露的 control-api 端口（默认 `4000`）
- `RUNTIME_GATEWAY_PORT`: 对外暴露的 runtime-gateway 端口（默认 `4100`）
- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`: PostgreSQL 初始化参数
- `JWT_SECRET`: control-api JWT 密钥（生产必须强随机）
- `RUNTIME_TOKEN_SECRET`: runtime-gateway token 密钥（生产必须强随机）
- `RUNTIME_GATEWAY_INTERNAL_SECRET`: gateway 调 control-api 内部接口共享密钥
- `RUNTIME_GATEWAY_PUBLIC_BASE_URL`: control-api 返回给浏览器的公网 WS 基址

## 2) 卷（Volumes）

- `aiops_postgres_data`: PostgreSQL 持久化数据
- `aiops_redis_data`: Redis AOF 持久化数据

查看：

```bash
docker volume ls | grep aiops_
```

## 3) 启动/停止

```bash
cd deploy/docker
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

查看状态：

```bash
docker compose -f docker-compose.prod.yml ps
```

停止：

```bash
docker compose -f docker-compose.prod.yml down
```

## 4) 健康检查

Compose 内置健康检查：

- `postgres`: `pg_isready`
- `redis`: `redis-cli ping`
- `control-api`: 容器内请求 `http://127.0.0.1:4000/api/capabilities`
- `runtime-gateway`: 容器内请求 `http://127.0.0.1:4100/healthz`
- `frontend`: 容器内请求 `http://127.0.0.1:3000/`

运行后可用以下命令复核：

```bash
docker compose -f docker-compose.prod.yml ps
curl -fsS http://127.0.0.1:${FRONTEND_PORT:-3000}/ >/dev/null && echo frontend-ok
curl -fsS http://127.0.0.1:${CONTROL_API_PORT:-4000}/api/capabilities >/dev/null && echo control-api-ok
curl -fsS http://127.0.0.1:${RUNTIME_GATEWAY_PORT:-4100}/healthz && echo
```

若 `runtime-gateway` 提示引导失败，优先检查：

1. `CONTROL_API_INTERNAL_BASE_URL` 是否可从 `runtime-gateway` 容器访问（默认 `http://control-api:4000`）
2. `RUNTIME_GATEWAY_INTERNAL_SECRET` 与 control-api 配置是否一致
3. control-api 是否已 healthy
4. 对外域名部署时，`RUNTIME_GATEWAY_PUBLIC_BASE_URL` 是否配置成浏览器可访问地址
