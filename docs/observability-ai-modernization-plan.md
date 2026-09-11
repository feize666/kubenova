# KubeNova 可观测性与 AI 改造基线

## 目标

- 保持单集群工作区语义：进入集群后，日志、指标、告警和 AI 请求都自动绑定当前 `clusterId`。
- 统一蓝白运维工作台的控件、状态、密度和反馈方式。
- 日志使用 Elasticsearch/Kibana，指标使用 Prometheus/Grafana，KubeNova 负责上下文、权限、模板和跳转。
- 恢复集群内 AI 对话与故障分析，并支持多厂商 Provider 和受控 Agent 工具。

## 边界

Kibana/Grafana 作为观测画布，不修改其内部源码主题；KubeNova 外层负责导航、筛选、鉴权、集群上下文和统一视觉。Prometheus/Alertmanager 是 Kubernetes 指标告警的事实来源，Grafana 不重复维护同一套规则。Elasticsearch 存原始日志，PostgreSQL 只保存数据源、规则、模板、AI 配置元数据和审计记录。

## 数据流

1. 目标集群通过 kube-prometheus-stack 产生指标和 Alertmanager 事件。
2. Fluent Bit/Elastic Agent 采集 Pod、节点和事件日志写入 Elasticsearch。
3. KubeNova 通过受控 API 读取 Prometheus、Alertmanager、Grafana、Elasticsearch/Kibana。
4. AI Context Aggregator 以集群、命名空间、资源和时间窗聚合指标、日志、事件、拓扑和告警，再交给 Provider Adapter。
5. Agent 只允许白名单只读工具；任何变更都必须预览、确认、RBAC 校验和审计。

## UI 门禁

- 统一使用 `components/ops` 基础控件和主题令牌，禁止页面自定义同类 Button/Select/Tag 样式。
- 终端和日志工作台必须保留连接状态、重连、暂停、搜索、复制、下载和降级状态。
- 资源名称默认正文色，悬浮/聚焦变蓝；绿色/黄色/红色只表达状态语义。
- 日志列表支持虚拟化；实时流暂停时保留已接收内容并限制内存上限。

## AI Provider 安全门禁

- 支持 OpenAI-compatible、Azure OpenAI、Anthropic、Gemini、Qwen、Volcengine、DeepSeek 和 Ollama。
- API Key 使用独立的 AES-256-GCM 加密密钥保存，接口只返回掩码，不写入日志。
- Provider 地址采用 allowlist；连接测试、密钥轮换、禁用和删除均记录审计。
- AI 生成的命令和资源变更只能生成预览，不能绕过审批直接执行。

## 发布与验证

每个阶段独立 worktree、独立 commit 和最小相关测试；主线程审核越界后再合入。发布使用固定版本和镜像摘要，不使用生产 `latest`。顺序为：设计系统 -> 观测数据源 -> 监控/告警 -> Kibana 日志 -> 终端 -> AI Provider -> 集群 AI -> 全量回归与灰度。
