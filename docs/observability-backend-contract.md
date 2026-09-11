# KubeNova 可观测性后端契约

控制面只负责连接配置、健康状态、告警/通知模板和上下文跳转；Prometheus、Alertmanager、Grafana、Elasticsearch、Kibana 仍是可替换的数据平面。未配置数据源时 API 返回明确的 `unknown`/`unavailable` 状态，不用模拟健康数据。

## 数据源

`GET /api/observability/data-sources?clusterId=<id>` 返回当前集群数据源与全局默认数据源。支持的 `kind`：`prometheus`、`grafana`、`alertmanager`、`elasticsearch`、`kibana`。

`POST /api/observability/data-sources`、`PATCH /api/observability/data-sources/:id`、`DELETE /api/observability/data-sources/:id` 用于管理配置。`POST /api/observability/data-sources/:id/test` 和 `POST /api/observability/data-sources/test` 执行 2 秒探针，并只返回延迟、状态和脱敏错误。

凭据由 `secretRef` 引用外部 Secret；API 不接收或返回明文密码和 token。endpoint 只允许 HTTP/HTTPS，不能指向任意协议。

默认环境变量：

```text
OBSERVABILITY_PROMETHEUS_URL
OBSERVABILITY_GRAFANA_URL
OBSERVABILITY_ALERTMANAGER_URL
OBSERVABILITY_ELASTICSEARCH_URL
OBSERVABILITY_KIBANA_URL
```

## 告警与通知模板

- `GET/POST/PATCH/DELETE /api/observability/alert-templates`
- `GET/POST/PATCH/DELETE /api/observability/notification-templates`

写操作沿用平台角色校验和审计；只读角色只能读取和测试。告警表达式原样保存，实际 PrometheusRule 渲染由后续安装器负责。通知 channel 限定为飞书、钉钉、企业微信、邮件、Webhook、Slack、PagerDuty。

## 部署策略

部署文件只注入可选 endpoint。没有 endpoint 时页面应显示“未配置”，不得因为可观测性组件不存在而阻塞控制面、资源同步和集群管理。生产环境建议使用 kube-prometheus-stack 与 ECK/Elastic Agent，并固定镜像版本及持久卷；KubeNova 仅通过 API 读取上下文和健康状态。
