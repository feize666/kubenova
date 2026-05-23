# 筛选联动逐页可执行取数回归清单

## 1) 目标与范围

本清单覆盖“已接入筛选联动”的页面，统一验证两类检查点：

- `URL状态可恢复`：`clusterId/namespace/keyword` 从 URL 恢复到页面筛选状态。
- `筛选参数可触发取数`：点击“查询”后，页面产生的 `XHR/FETCH` 请求包含筛选参数。

执行入口脚本：`scripts/filter-regression-matrix.mjs`

## 2) 前置条件

```bash
cd /case/k8s-aiops-manager/frontend
npm i -D playwright
npx playwright install chromium
```

环境变量：

- `FILTER_BASE_URL`：前端地址（默认 `http://127.0.0.1:3000`）
- `FILTER_USER` / `FILTER_PASS`：登录账号密码（若已有登录态可不填）
- `FILTER_CASES`：可选，逗号分隔，仅跑指定用例 ID
- `FILTER_HEADLESS`：可选，`false` 为有头模式
- `FILTER_TIMEOUT_MS`：可选，默认 `20000`

## 3) 执行命令

全量执行：

```bash
FILTER_BASE_URL=http://127.0.0.1:3000 FILTER_USER=<账号> FILTER_PASS=<密码> npm run e2e:filters:matrix
```

列出全部用例（不启动浏览器）：

```bash
npm run e2e:filters:list
```

单页执行示例：

```bash
FILTER_BASE_URL=http://127.0.0.1:3000 FILTER_USER=<账号> FILTER_PASS=<密码> FILTER_CASES=workloads-pods npm run e2e:filters:matrix
```

## 4) 逐页回归矩阵

| 页面 | 路由 | 用例ID | 范围 | 检查点 | 执行命令 | 预期结果 |
|---|---|---|---|---|---|---|
| Workloads / Deployments | `/workloads/deployments` | `workloads-deployments` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=workloads-deployments npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Workloads / Pods | `/workloads/pods` | `workloads-pods` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=workloads-pods npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Workloads / StatefulSets | `/workloads/statefulsets` | `workloads-statefulsets` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=workloads-statefulsets npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Workloads / DaemonSets | `/workloads/daemonsets` | `workloads-daemonsets` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=workloads-daemonsets npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Workloads / ReplicaSets | `/workloads/replicasets` | `workloads-replicasets` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=workloads-replicasets npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Workloads / Jobs | `/workloads/jobs` | `workloads-jobs` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=workloads-jobs npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Workloads / CronJobs | `/workloads/cronjobs` | `workloads-cronjobs` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=workloads-cronjobs npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Workloads / Helm | `/workloads/helm` | `workloads-helm` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=workloads-helm npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Workloads / Autoscaling HPA | `/workloads/autoscaling/hpa` | `workloads-autoscaling-hpa` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=workloads-autoscaling-hpa npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Workloads / Autoscaling VPA | `/workloads/autoscaling/vpa` | `workloads-autoscaling-vpa` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=workloads-autoscaling-vpa npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Network / Services | `/network/services` | `network-services` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=network-services npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Network / Endpoints | `/network/endpoints` | `network-endpoints` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=network-endpoints npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Network / EndpointSlices | `/network/endpointslices` | `network-endpointslices` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=network-endpointslices npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Network / NetworkPolicy | `/network/networkpolicy` | `network-networkpolicy` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=network-networkpolicy npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Network / Ingress | `/network/ingress` | `network-ingress` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=network-ingress npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Network / IngressRoute | `/network/ingressroute` | `network-ingressroute` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=network-ingressroute npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Network / Gateway API | `/network/gateway-api` | `network-gateway-api` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=network-gateway-api npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Storage / PV | `/storage/pv` | `storage-pv` | 集群 | URL恢复 + 取数参数 | `FILTER_CASES=storage-pv npm run e2e:filters:matrix` | 通过；请求含 `clusterId/keyword` |
| Storage / PVC | `/storage/pvc` | `storage-pvc` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=storage-pvc npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Storage / SC | `/storage/sc` | `storage-sc` | 集群 | URL恢复 + 取数参数 | `FILTER_CASES=storage-sc npm run e2e:filters:matrix` | 通过；请求含 `clusterId/keyword` |
| Configs / ConfigMaps | `/configs/configmaps` | `configs-configmaps` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=configs-configmaps npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Configs / Secrets | `/configs/secrets` | `configs-secrets` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=configs-secrets npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Configs / ServiceAccounts | `/configs/serviceaccounts` | `configs-serviceaccounts` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=configs-serviceaccounts npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Security / Events | `/security` | `security-events` | 集群+命名空间 | URL恢复 + 取数参数 | `FILTER_CASES=security-events npm run e2e:filters:matrix` | 通过；请求含 `clusterId/namespace/keyword` |
| Namespaces | `/namespaces` | `namespaces` | 集群 | URL恢复 + 取数参数 | `FILTER_CASES=namespaces npm run e2e:filters:matrix` | 通过；请求含 `clusterId/keyword` |

## 5) 失败判定

脚本出现以下任一情况即判定失败并返回非零退出码：

- URL 参数无法恢复到页面筛选状态。
- 点击“查询”后未产生 XHR/FETCH 请求。
- 产生请求但未包含预期筛选参数（`clusterId/namespace/keyword`）。
