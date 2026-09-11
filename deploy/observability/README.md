# KubeNova 可观测性数据平面

KubeNova 控制面只保存数据源地址、Secret 引用、模板和健康状态，不替代指标、日志或告警数据平面。生产环境建议在目标集群安装以下组件，并将其内网地址通过观测配置页面或环境变量接入。

## 指标与告警

使用 `kube-prometheus-stack`（Prometheus Operator、Prometheus、Alertmanager、Grafana、kube-state-metrics、node-exporter）：

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm upgrade --install kube-prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace \
  --set prometheus.prometheusSpec.retention=15d \
  --set prometheus.prometheusSpec.resources.requests.cpu=250m \
  --set prometheus.prometheusSpec.resources.requests.memory=512Mi
```

将 Prometheus、Grafana、Alertmanager 的 Service 地址分别配置为：

- `prometheus-operated.monitoring.svc:9090`
- `kube-prometheus-grafana.monitoring.svc:80`
- `kube-prometheus-kube-alertmanager.monitoring.svc:9093`

告警规则以 PrometheusRule 为准，KubeNova 的告警模板用于版本化和审计，发布时应由后续渲染器生成 PrometheusRule，避免 Grafana 与 Prometheus 双重维护同一规则。

## 日志

使用 ECK Operator 管理 Elasticsearch/Kibana，使用 Elastic Agent 或 Fluent Bit 采集 Kubernetes 容器日志。KubeNova 通过 Kibana 外层入口提供集群上下文、权限和筛选，不修改 Kibana 内部样式，避免升级破坏定制。

建议日志字段至少包含：`cluster.id`、`cluster.name`、`kubernetes.namespace`、`kubernetes.workload.name`、`kubernetes.pod.name`、`kubernetes.container.name`、`log.level`、`message`、`trace.id`、`@timestamp`。

## 接入 KubeNova

在 `/observability/configuration` 或单集群的 `/clusters/<clusterId>/observability/configuration` 中添加数据源。凭据只填写 Kubernetes Secret 引用（例如 `monitoring/prometheus-token`），不要把 token、密码或 API Key 写入 ConfigMap、Git 或 URL 查询参数。

也可以在部署前设置环境变量：

```text
OBSERVABILITY_PROMETHEUS_URL
OBSERVABILITY_GRAFANA_URL
OBSERVABILITY_ALERTMANAGER_URL
OBSERVABILITY_ELASTICSEARCH_URL
OBSERVABILITY_KIBANA_URL
```

健康探针使用 2 秒超时，并将未配置源显示为 `unknown`，不会阻塞集群资源管理。生产部署必须同时设置独立的、至少 32 字符的 `AI_CREDENTIAL_ENCRYPTION_KEY`，否则控制面会拒绝启动。

## 性能基线

- Prometheus 保留周期从 15 天起步，根据磁盘和基数增长调整，不在 KubeNova PostgreSQL 中复制完整时序数据。
- Elasticsearch 使用按日/大小滚动索引和 ILM，Kibana 仅查询必要时间范围。
- KubeNova 页面默认 30 秒刷新汇总，数据源探针 2 秒超时，详情查询按用户触发。
- 大规模集群应通过 Prometheus recording rules、日志索引字段和分页查询控制后端响应大小。
