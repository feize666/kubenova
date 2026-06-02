# Ops Console Kubernetes Deployment

本文件对应任务 11.5，说明当前 `deploy/k8s` Kustomize 部署。入口为 `kubectl apply -k deploy/k8s`。

## 资源范围

当前清单包含：

- Namespace: `aiops`
- ConfigMap: `aiops-platform-config`
- Secret: `aiops-platform-secret`
- PostgreSQL Deployment / Service / PVC
- Redis Deployment / Service
- control-api Deployment / Service
- runtime-gateway Deployment / Service
- frontend Deployment / Service
- Ingress: `aiops`

当前清单未包含显式 RBAC 资源。若目标集群策略要求 ServiceAccount、Role 或 RoleBinding，需要在上线前补充 overlay。

## 前置条件

```bash
kubectl config current-context
kubectl cluster-info
```

目标集群需要：

- 可拉取清单中镜像，或通过 Kustomize 覆盖镜像。
- 有默认 StorageClass，供 `postgres-pvc` 申请 `10Gi`。
- 已安装 Ingress Controller。现有 `ingress.yaml` 使用 `ingressClassName: nginx`。
- DNS 或 hosts 将业务域名指向 Ingress 地址。默认 host 为 `aiops.local`。

## 配置

修改 `deploy/k8s/platform-config.yaml`：

ConfigMap 关键项：

- `CONTROL_API_BASE_URL`
- `CONTROL_API_INTERNAL_BASE_URL`
- `RUNTIME_GATEWAY_BASE_URL`
- `RUNTIME_GATEWAY_PUBLIC_BASE_URL`
- `CORS_ORIGINS`
- `NEXT_PUBLIC_CONTROL_API_BASE`
- `AI_MODEL_BASE_URL`
- `AI_MODEL_NAME`
- `AI_MODEL_MAX_TOKENS`
- `AI_MODEL_TIMEOUT_MS`
- `SWAGGER_ENABLED`

Secret 关键项：

- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `REFRESH_TOKEN_EXPIRES_IN`
- `DEFAULT_ADMIN_EMAIL`
- `DEFAULT_ADMIN_PASSWORD`
- `RUNTIME_TOKEN_SECRET`
- `RUNTIME_GATEWAY_INTERNAL_SECRET`
- `AI_MODEL_API_KEY`

生产环境不要使用清单中的 `change-me` 或 `replace-with-*` 默认值。

## 渲染检查

```bash
kubectl kustomize deploy/k8s >/tmp/aiops-rendered.yaml
```

可选服务端校验：

```bash
kubectl apply -k deploy/k8s --dry-run=server
```

## 部署

```bash
kubectl apply -k deploy/k8s
```

## 镜像覆盖

使用 Kustomize 覆盖镜像：

```bash
cd deploy/k8s
kustomize edit set image \
  ghcr.io/feize1995/aiops-frontend=registry.example.com/aiops/frontend:v1.2.3 \
  ghcr.io/feize1995/aiops-control-api=registry.example.com/aiops/control-api:v1.2.3 \
  ghcr.io/feize1995/aiops-runtime-gateway=registry.example.com/aiops/runtime-gateway:v1.2.3
```

若无 standalone `kustomize` 命令，可直接编辑 `deploy/k8s/kustomization.yaml` 或各 Deployment image 字段。

## 验证

```bash
kubectl get pods -n aiops
kubectl get svc -n aiops
kubectl get ingress -n aiops
kubectl rollout status deploy/postgres -n aiops
kubectl rollout status deploy/redis -n aiops
kubectl rollout status deploy/control-api -n aiops
kubectl rollout status deploy/runtime-gateway -n aiops
kubectl rollout status deploy/frontend -n aiops
```

探针路径：

- control-api readiness / liveness: `/api/capabilities`
- runtime-gateway readiness / liveness: `/healthz`
- frontend readiness / liveness: `/`
- postgres readiness / liveness: `pg_isready`
- redis readiness / liveness: `redis-cli ping`

端口转发检查：

```bash
kubectl port-forward -n aiops svc/frontend 3000:3000
kubectl port-forward -n aiops svc/control-api 4000:4000
kubectl port-forward -n aiops svc/runtime-gateway 4100:4100
```

另一个终端执行：

```bash
curl -fsS http://127.0.0.1:3000/ >/dev/null && echo frontend-ok
curl -fsS http://127.0.0.1:4000/api/capabilities >/dev/null && echo control-api-ok
curl -fsS http://127.0.0.1:4100/healthz && echo
```

## 日志与排障

```bash
kubectl logs -n aiops deploy/control-api --tail=200
kubectl logs -n aiops deploy/runtime-gateway --tail=200
kubectl logs -n aiops deploy/frontend --tail=200
kubectl describe pod -n aiops -l app=control-api
kubectl describe ingress -n aiops aiops
```

常见检查：

- Pod `ImagePullBackOff`：确认镜像地址、凭据、集群出口。
- Pod `CrashLoopBackOff`：看 `kubectl logs --previous` 和 Secret 值。
- control-api 不 ready：确认 `DATABASE_URL`、`REDIS_URL`、迁移状态。
- runtime-gateway 不 ready：确认 `CONTROL_API_INTERNAL_BASE_URL` 与 `RUNTIME_GATEWAY_INTERNAL_SECRET`。
- 浏览器跨域失败：确认 `CORS_ORIGINS` 与访问域名一致。
- WebSocket 失败：确认 Ingress `/ws` 转发到 `runtime-gateway:4100`。

## 资源与调度

当前清单未设置 CPU / memory requests 和 limits。生产上线前建议为以下 Deployment 增加资源约束：

- `control-api`
- `runtime-gateway`
- `frontend`
- `postgres`
- `redis`

当前 `postgres-pvc` 请求 `10Gi`。按业务容量和备份策略调整。

## 升级

更新镜像或配置后：

```bash
kubectl apply -k deploy/k8s
kubectl rollout status deploy/control-api -n aiops
kubectl rollout status deploy/runtime-gateway -n aiops
kubectl rollout status deploy/frontend -n aiops
```

查看历史：

```bash
kubectl rollout history deploy/control-api -n aiops
kubectl rollout history deploy/runtime-gateway -n aiops
kubectl rollout history deploy/frontend -n aiops
```

## 回滚

```bash
kubectl rollout undo deploy/control-api -n aiops
kubectl rollout undo deploy/runtime-gateway -n aiops
kubectl rollout undo deploy/frontend -n aiops
kubectl rollout status deploy/control-api -n aiops
kubectl rollout status deploy/runtime-gateway -n aiops
kubectl rollout status deploy/frontend -n aiops
```

如 ConfigMap 或 Secret 也发生变更，需配合恢复对应清单版本后重新 `kubectl apply -k deploy/k8s`。

## 卸载

删除工作负载与服务：

```bash
kubectl delete -k deploy/k8s
```

如需保留数据库数据，删除前先备份 PVC。`kubectl delete -k` 会删除当前 Kustomize 管理的 `postgres-pvc`。
