# Kubernetes Kustomize

## 前置条件

- 可访问目标集群的 `kubectl`。
- Ingress Controller 可用。
- 必要镜像已推送到可拉取仓库。
- 如需先安装 K8s/KubeSphere，请参考官方安装文档：
  - https://docs.kubesphere.com.cn/v4.2.0/03-installation-and-upgrade/02-install-kubesphere/

## 安装/应用

```bash
kubectl kustomize deploy/k8s >/tmp/aiops-rendered.yaml
kubectl apply -k deploy/k8s
```

如需覆盖镜像：

```bash
cd deploy/k8s
kustomize edit set image kubenova/backend=registry.example.com/aiops/backend:v1.2.3
kustomize edit set image kubenova/frontend=registry.example.com/aiops/frontend:v1.2.3
```

## 验证

```bash
kubectl get pods -n kubenova
kubectl rollout status deploy/backend -n kubenova
kubectl rollout status deploy/frontend -n kubenova
kubectl get svc -n kubenova
kubectl get ingress -n kubenova
```

## 回滚

- 推荐使用 GitOps/版本化 manifest 回滚：

```bash
git checkout <last-good-tag> -- deploy/k8s
kubectl apply -k deploy/k8s
```

## 故障排查

- 拉镜像失败：检查 `imagePullSecrets` 与仓库权限
- Pod Pending：检查 PVC/节点资源
- Ingress 不通：检查 `ingressClassName`、Host DNS 解析与 Controller 日志
