# Docker Compose

## 前置条件

- 主机已安装 `docker` 与 `docker compose`。
- 端口 `3000/4000/4100` 可用（或按需改端口映射）。

## 安装/启动

```bash
cd deploy/docker
cp .env.example .env
# 修改 .env 中镜像、密码、JWT、runtime 密钥
# 远程访问时：
#   CORS_ORIGINS=https://your-domain
#   CONTROL_API_BASE_URL=https://your-domain/api
#   RUNTIME_GATEWAY_BASE_URL=wss://your-domain/ws
#   RUNTIME_GATEWAY_PUBLIC_BASE_URL=wss://your-domain

docker compose -f docker-compose.prod.yml --env-file .env up -d
```

## 验证

```bash
docker compose -f deploy/docker/docker-compose.prod.yml --env-file deploy/docker/.env ps
curl -fsS http://127.0.0.1:3000/ >/dev/null
curl -fsS http://127.0.0.1:4100/healthz
curl -fsS http://127.0.0.1:4000/api/capabilities >/dev/null
```

## 回滚

- 回滚镜像 Tag：把 `.env` 中镜像版本改回旧值
- 重新拉起：

```bash
docker compose -f deploy/docker/docker-compose.prod.yml --env-file deploy/docker/.env up -d
```

## 故障排查

- 容器反复重启：`docker compose -f deploy/docker/docker-compose.prod.yml logs --tail=200 <service>`
- API 不通：检查 `CONTROL_API_INTERNAL_BASE_URL` 与服务依赖健康状态
- 浏览器访问空白/登录失败：检查 `NEXT_PUBLIC_CONTROL_API_BASE` 是否留空或指向容器内可达 `http://control-api:4000`
- 持久化问题：检查 `aiops_postgres_data` / `aiops_redis_data`
