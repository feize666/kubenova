# Upgrade and Rollback Playbook

## 通用升级流程

1. 预检：配置、依赖、备份、容量。
2. 灰度：先在低风险环境验证。
3. 执行升级：按部署文档步骤执行。
4. 健康检查：API、网关、关键业务路径。
5. 观察窗口：确认无异常再清理旧版本。

## 回滚矩阵

| 方式 | 回滚动作 | RTO 级别 | 关键风险 |
|---|---|---|---|
| Binary + systemd | `current` 软链回切 + 重启服务 | 秒级 | 新旧 env 不兼容 |
| Docker Compose | 回退镜像 Tag 并 `compose up -d` | 分钟级 | DB schema 已变更 |
| Kustomize | 回退 manifest 版本并 `kubectl apply -k` | 分钟级 | 资源不可逆变更 |
| DEB/RPM | 安装旧版本包 | 分钟级 | 生命周期脚本副作用 |

## 升级后核对清单

- 控制面就绪接口：`/api/health/ready` 可访问（该进程已在启动阶段执行 `prisma migrate deploy`）
- 运行网关健康：`/healthz` 返回 2xx
- 关键页面加载正常
- 日志无连续 error
- 监控指标无异常抖动

## 推荐命令

### Docker Compose 原子 tag 发布/回滚

```bash
# 不启动服务，只校验必需密钥、Compose 插值和发布契约
bash scripts/service.sh compose-release preflight --env-file deploy/docker/.env

# 发布（或升级）统一版本 tag，等待全部服务 healthy
bash scripts/service.sh compose-release up --tag v1.3 --env-file deploy/docker/.env

# 出现回归时切回旧 tag；脚本不会改写 env 文件
bash scripts/service.sh compose-release rollback v1.2 --env-file deploy/docker/.env
```

control-api 镜像入口点会先执行 `./node_modules/.bin/prisma migrate deploy`，迁移成功后才启动应用；二进制/systemd `prod up` 也执行同一 migration 门禁。

```bash
# binary/systemd
systemctl status kubenova-runtime-gateway.service --no-pager
systemctl status kubenova-control-api.service --no-pager
curl -fsS http://127.0.0.1:4100/healthz
curl -fsS http://127.0.0.1:4000/api/health/ready >/dev/null

# docker compose
docker compose -f deploy/docker/docker-compose.prod.yml --env-file deploy/docker/.env ps

# kubernetes
kubectl rollout status deploy/control-api -n kubenova
kubectl rollout status deploy/runtime-gateway -n kubenova
kubectl rollout status deploy/frontend -n kubenova
```
