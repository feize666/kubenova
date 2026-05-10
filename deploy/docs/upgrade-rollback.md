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

- 控制面接口：`/api/capabilities` 可访问
- 运行网关健康：`/healthz` 返回 2xx
- 关键页面加载正常
- 日志无连续 error
- 监控指标无异常抖动

## 推荐命令

```bash
# binary/systemd
systemctl status aiops-runtime-gateway.service --no-pager
systemctl status aiops-control-api.service --no-pager
curl -fsS http://127.0.0.1:4100/healthz
curl -fsS http://127.0.0.1:4000/api/capabilities >/dev/null

# docker compose
docker compose -f deploy/docker/docker-compose.prod.yml --env-file deploy/docker/.env ps

# kubernetes
kubectl rollout status deploy/control-api -n aiops
kubectl rollout status deploy/runtime-gateway -n aiops
kubectl rollout status deploy/frontend -n aiops
```
