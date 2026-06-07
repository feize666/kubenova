# 功能切换性能基线与稳定性验收矩阵

## 1. 范围

本文基于 `ops-console-unified-experience` spec 的 Requirement 13 和设计文档中 `Performance and Stability Hardening`，用于冻结功能切换性能基线、稳定性验收矩阵和证据留存规则。

覆盖动作：

- route switch
- tab switch
- drawer open
- filter change
- graph focus
- time-range change

覆盖稳定性：

- 前端 console error 检查
- 后端 error-path / timeout / recovery 检查
- 压力或长稳验证建议

## 2. 通用测量规则

| 项 | 基线规则 |
|---|---|
| 环境 | 本地或测试环境，使用同一浏览器、同一账号、同一数据规模、同一后端配置 |
| 预热 | 每条链路先执行 3 次预热，不计入样本 |
| 样本 | 每个动作至少 20 次；正式发布门禁建议 50 次 |
| 指标 | 记录 p50、p95、max、失败次数、API 请求数、重复请求数、console error 数 |
| 采样方式 | Playwright trace + browser performance mark + Network 请求采样 + console 监听 |
| 阈值口径 | p95 为主，p50 作体验参考，max 用于发现偶发卡顿 |
| 失败口径 | 超阈值、未完成、全页 reload、无关模块重载、重复 API 请求、未捕获 console error 任一命中即需记录 |

建议证据目录：

```text
artifacts/performance/<yyyyMMdd-HHmm>/<action>/
artifacts/stability/<yyyyMMdd-HHmm>/<scope>/
```

证据最少包含：

- `summary.md`：环境、样本数、p50/p95/max、结论、异常说明
- `trace.zip` 或浏览器 trace
- `network.har` 或请求统计
- `console.log`
- `screenshot.png` 或关键状态截图
- 后端日志片段或结构化日志查询结果

## 3. 性能基线矩阵

| 动作 | 场景 | 测量方式 | 建议阈值 | 通过标准 | 证据路径 |
|---|---|---|---|---|---|
| route switch | 在 overview、集群管理、工作负载、网络、资源全景图、可观测性、KubeNova 间切换 | 点击导航到主内容首个稳定状态；记录 `navigationStart -> content-ready` 或自定义 mark | p50 <= 600ms；p95 <= 1200ms；max <= 2000ms | 不触发全页 reload；shell、主题、用户态保持；无重复初始化请求 | `artifacts/performance/<run>/route-switch/` |
| tab switch | 同页内资源 Tab、Gateway API Tab、可观测性信号 Tab 切换 | 点击 Tab 到目标面板稳定；统计渲染次数和 API 请求 | p50 <= 250ms；p95 <= 500ms；max <= 900ms | 非当前 Tab 不阻塞；已缓存 Tab 不重复拉取；加载态不残留 | `artifacts/performance/<run>/tab-switch/` |
| drawer open | 集群、节点、NetworkPolicy、Gateway、工作负载等详情抽屉打开 | 点击资源名到抽屉主体可读；分离 shell 打开耗时和数据完成耗时 | 抽屉框架 p95 <= 300ms；主体数据 p95 <= 1000ms；max <= 1800ms | 抽屉先打开后局部加载；错误可重试；关闭后请求可取消 | `artifacts/performance/<run>/drawer-open/` |
| filter change | clusterId、namespace、keyword、资源类型筛选 | 修改筛选到列表稳定；记录 debounce、请求数、URL 状态恢复 | p50 <= 500ms；p95 <= 1000ms；max <= 1800ms | 请求参数正确；旧请求取消或被忽略；不清空无关状态 | `artifacts/performance/<run>/filter-change/` |
| graph focus | 资源全景图节点 hover / select / relation jump / breadcrumb focus | 执行焦点切换到节点高亮、关系边稳定、详情联动完成 | p50 <= 300ms；p95 <= 700ms；max <= 1200ms | 节点/边 identity 稳定；过滤或重分组后焦点不漂移 | `artifacts/performance/<run>/graph-focus/` |
| time-range change | 可观测性中心统一时间范围切换 | 修改时间范围到指标、日志、trace、事件、告警面板稳定 | p50 <= 800ms；p95 <= 1800ms；max <= 3000ms | 多信号并行加载；单数据源失败只降级对应 panel；深链参数同步 | `artifacts/performance/<run>/time-range-change/` |

阈值为首版建议值。若测试数据量超过 5k 资源、图节点超过 1k、或外部观测后端跨网络访问，需在 `summary.md` 写明数据规模，并用同等规模做回归比较。

## 4. 前端稳定性验收矩阵

| 检查项 | 覆盖链路 | 验收点 | 失败判定 | 证据路径 |
|---|---|---|---|---|
| console error | 六类功能切换动作 | 监听 `pageerror`、`console.error`、未处理 Promise rejection | 任一未解释错误即失败；已知第三方噪声需白名单和原因 | `artifacts/stability/<run>/frontend-console/` |
| request cancellation | drawer close、filter change、route switch、time-range change | 旧请求取消、忽略或被新请求覆盖；无 stale state | 旧响应覆盖新页面、新筛选、新时间范围 | `artifacts/stability/<run>/frontend-request-cancel/` |
| error boundary | 资源详情、图谱、可观测性、KubeNova 工作台 | 局部异常进入降级 UI；全局 shell 可继续操作 | 白屏、导航失效、登录态丢失、全局崩溃 | `artifacts/stability/<run>/frontend-error-boundary/` |
| degraded state | API 失败、空数据、权限拒绝、数据源不可用 | 显示明确错误、空态、权限或数据源不可用信息 | 静默空白、无限 loading、误导性正常状态 | `artifacts/stability/<run>/frontend-degraded/` |
| memory leak | route switch、graph focus、time-range change 反复执行 | 订阅、timer、WebSocket、event listener 可清理 | 长循环后 heap 持续上升且不回落；重复事件处理 | `artifacts/stability/<run>/frontend-memory/` |
| layout stability | drawer、table、graph、observability panels | 无明显 layout thrashing；关键文本不遮挡 | 切换时布局大幅跳动、按钮不可点、内容重叠 | `artifacts/stability/<run>/frontend-layout/` |

建议前端检查命令：

```bash
cd /case/kubenova/frontend
npm run lint
npm run typecheck
FILTER_BASE_URL=http://127.0.0.1:3000 FILTER_USER=<账号> FILTER_PASS=<密码> npm run e2e:filters:matrix
```

若新增专项 Playwright 用例，建议命名：

```bash
npm run e2e:performance:switching
npm run e2e:stability:console
```

## 5. 后端稳定性验收矩阵

| 检查项 | 覆盖服务 | 验收点 | 失败判定 | 证据路径 |
|---|---|---|---|---|
| error-path | control-api、runtime-gateway | 输入非法、资源不存在、权限拒绝、外部依赖失败均返回可诊断错误 | 500 泄漏、空响应、错误结构不一致、进程异常退出 | `artifacts/stability/<run>/backend-error-path/` |
| timeout | Kubernetes API、数据库、Redis、观测后端、KubeNova 智能分析 | 每类外部调用有上限；超时返回局部降级或 partial result | 请求无限等待、阻塞线程池、前端无限 loading | `artifacts/stability/<run>/backend-timeout/` |
| recovery | controller、service、后台任务、WebSocket handler | panic/异常被 recovery 捕获；结构化日志包含 component、requestId、reason | 单请求导致服务退出；后台任务异常中断主进程 | `artifacts/stability/<run>/backend-recovery/` |
| bounded concurrency | 图谱、观测查询、KubeNova 智能分析、批量资源同步 | 并发有上限，队列或拒绝策略明确 | 突发请求耗尽连接池、CPU 飙满、内存失控 | `artifacts/stability/<run>/backend-concurrency/` |
| resource cleanup | WebSocket、日志流、终端、外部连接 | 断开后释放连接、goroutine、timer、订阅 | 连接泄漏、goroutine 泄漏、句柄持续增长 | `artifacts/stability/<run>/backend-cleanup/` |
| health / readiness | control-api、runtime-gateway、依赖状态 | 健康检查反映核心依赖；非核心依赖失败可降级 | 健康接口误报正常或误杀可降级场景 | `artifacts/stability/<run>/backend-health/` |
| graceful shutdown | control-api、runtime-gateway | SIGTERM 后停止接新请求，完成或中止进行中请求，释放资源 | 进程挂起、数据写半截、WebSocket 无关闭信号 | `artifacts/stability/<run>/backend-shutdown/` |

建议后端检查命令：

```bash
cd /case/kubenova/backend/control-api
npm run test
npm run test:e2e
```

如 runtime-gateway 有独立 Go 测试：

```bash
cd /case/kubenova/backend/runtime-gateway
go test ./...
```

## 6. 压力与长稳建议

| 类型 | 目标 | 建议配置 | 通过标准 | 证据路径 |
|---|---|---|---|---|
| smoke load | 验证主要链路在轻压下可用 | 10 并发，5 分钟，覆盖登录、集群列表、资源列表、详情抽屉 | 错误率 <= 0.1%；p95 不超过性能矩阵 1.5 倍 | `artifacts/stability/<run>/smoke-load/` |
| feature-switch loop | 验证切换稳定性 | 六类动作循环 200 次，记录 console、network、heap | 无未解释 console error；无明显 heap 单调增长；无卡死 | `artifacts/stability/<run>/switch-loop/` |
| graph stress | 验证资源全景图 | 100、500、1000 节点三档；执行 focus/filter/regroup | 节点 identity 稳定；p95 不超过基线 2 倍；无焦点漂移 | `artifacts/stability/<run>/graph-stress/` |
| observability fanout | 验证多数据源并发 | metrics/logs/traces/events/alerts 同时查询；注入单源失败 | 单源失败只降级单 panel；其他 panel 可用 | `artifacts/stability/<run>/observability-fanout/` |
| backend soak | 验证服务长稳 | 2-8 小时，混合读请求、WebSocket、观测查询、KubeNova 查询 | 进程不退出；错误率 <= 0.1%；内存无不可解释持续上涨 | `artifacts/stability/<run>/backend-soak/` |
| timeout injection | 验证超时和恢复 | 模拟 Kubernetes API、数据库、Redis、观测后端慢响应或拒绝 | 请求按阈值超时；日志可诊断；服务恢复后自动可用 | `artifacts/stability/<run>/timeout-injection/` |

## 7. 发布门禁

进入发布或下一阶段前，至少满足：

- 六类功能切换均有 `summary.md`，记录 p50、p95、max、样本数和结论。
- 前端 console error 检查通过，或所有错误有白名单原因和负责人。
- 后端 error-path、timeout、recovery 至少覆盖 control-api 关键路径。
- 压力或长稳至少完成 `smoke load` 与 `feature-switch loop`。
- 任一失败项有阻断级别、回滚建议和复测计划。

## 8. 风险与校准

- 首版阈值为建议值，不代表当前产品已达标。
- 外部观测后端、真实 Kubernetes API、数据规模会显著影响 time-range、graph、drawer 数据完成耗时。
- 发布门禁应优先比较同环境、同数据规模下的趋势；跨环境结果只作参考。
- 若因数据源不可控导致超阈值，必须证明 UI 可局部降级，且无全局崩溃、无限 loading、未捕获错误。
