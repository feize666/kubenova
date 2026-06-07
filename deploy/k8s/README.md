# Kubernetes Kustomize Deployment

当前 K8s 入口已统一为：

- `frontend`
- `control-api`
- `runtime-gateway`
- `postgres`
- `redis`

## 1) 前置条件

- 已安装 `kubectl`，当前 context 指向目标集群
- 集群已安装 Ingress Controller（默认 `nginx`）
- 可拉取以下镜像：
  - `ghcr.io/feize1995/kubenova-frontend:latest`
  - `ghcr.io/feize1995/kubenova-control-api:latest`
  - `ghcr.io/feize1995/kubenova-runtime-gateway:latest`

## 2) 部署前必须改的值

编辑 [platform-config.yaml](platform-config.yaml)：

- `CONTROL_API_BASE_URL`
- `RUNTIME_GATEWAY_BASE_URL`
- `RUNTIME_GATEWAY_PUBLIC_BASE_URL`
- `CORS_ORIGINS`

编辑 Secret：

- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `JWT_SECRET`
- `RUNTIME_TOKEN_SECRET`
- `RUNTIME_GATEWAY_INTERNAL_SECRET`
- `AI_MODEL_API_KEY`

## 3) 应用

```bash
kubectl kustomize deploy/k8s >/tmp/kubenova-rendered.yaml
kubectl apply -k deploy/k8s
```

## 4) 可选镜像覆盖

```bash
cd deploy/k8s
kustomize edit set image \
  ghcr.io/feize1995/kubenova-frontend=registry.example.com/kubenova/frontend:v1.2.3 \
  ghcr.io/feize1995/kubenova-control-api=registry.example.com/kubenova/control-api:v1.2.3 \
  ghcr.io/feize1995/kubenova-runtime-gateway=registry.example.com/kubenova/runtime-gateway:v1.2.3
```

## 5) 验证

```bash
kubectl get pods -n kubenova
kubectl get svc -n kubenova
kubectl get ingress -n kubenova
kubectl rollout status deploy/control-api -n kubenova
kubectl rollout status deploy/runtime-gateway -n kubenova
kubectl rollout status deploy/frontend -n kubenova
```
