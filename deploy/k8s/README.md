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

Kubernetes 更新任务使用独立 `kubenova-update-controller` Deployment 和 ServiceAccount。只有该控制器获得 namespace 范围内对 `control-api`、`runtime-gateway`、`frontend` 三个 Deployment 的 `get`/`patch` 权限；`control-api` 仍不获得 Deployment 写权限。控制器任务从数据库持久队列领取，任务输入带 HMAC 签名，镜像只接受受信任仓库的 SHA256 digest。正式任务执行前会先备份 PostgreSQL，备份引用及字节数写入持久任务记录；本地备份目录限制在 `kubenova-update-backups` PVC 内，S3 备份上传成功后会删除 Pod 临时副本。

Kubernetes 在线更新采用 fail-closed：数据库唯一活动槽保证预检、升级和回滚一次只执行一个任务；若既有数据库存在多个未终结任务，新迁移会拒绝启动，需先人工核对队列状态。预检任务会真实备份数据库，并在所选迁移测试目标中创建随机临时数据库、恢复备份、运行目标镜像的 Prisma 迁移、启动当前 control-api 镜像做 readiness 兼容检查，最后删除 Job、Secret 和临时数据库。任务未成功、检查为空/失败、配置指纹变化或预检过期都会拒绝升级；Worker 接单时还会再次核对设置指纹，重新预检若在排队前失败则会持久失效此前通过的预检。成功升级的任务结果会保留升级前三个 Deployment 的不可变镜像摘要；更新页的一键回滚以该摘要作为目标，回滚前再次备份数据库并完成健康检查。镜像回滚不会自动恢复数据库 schema。若预检页面显示任一检查失败，不要手工调用任务接口或直接 patch Deployment。

首次启用控制器前，在 `kubenova-platform-secret` 中分别配置 `KUBENOVA_K8S_UPDATE_TASK_KEY`（独立随机 32 字节十六进制）和 `KUBENOVA_UPDATE_ENCRYPTION_KEY`（更新设置 AES-256 密钥）；应用清单不会生成或覆盖这些 Secret。API 与控制器须使用相同的任务签名密钥。更新备份默认保存在 `kubenova-update-backups` PVC（20Gi，可按集群存储容量调整）；本地备份目标只能选择挂载目录内的路径，S3 备份不长期保留 Pod 临时副本。API 配置密钥只用于解密设置，Kubernetes API 写权限只挂载给更新控制器。

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
- `KUBENOVA_K8S_UPDATE_TASK_KEY`（独立随机 256-bit 十六进制密钥）

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
