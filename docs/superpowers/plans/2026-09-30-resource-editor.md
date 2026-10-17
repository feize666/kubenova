# Kubernetes 资源表单 / YAML 统一编辑实施计划

## Goal
完成全站资源创建、编辑双模式：真实回填、无损草稿、服务端校验和安全提交。只改本地代码，在前端 3000 验收；不推送、不部署生产。

## Spec / Global Constraints
- 本计划依据本轮已确认需求；沿用全站主题、权限和资源名称详情抽屉。
- 创建默认 create-only；编辑锁定 apiVersion/kind/name/namespace，带 resourceVersion 防并发覆盖，不强制 SSA 抢字段。
- 表单和 YAML 共享内存草稿；未覆盖字段必须保留；敏感值不写浏览器存储、日志或预览，不能保存脱敏占位符。
- 先前端校验，再服务端 dry-run=All，再脱敏变更预览，再显式确认提交。修改草稿使预览失效。403、超时、webhook 拒绝不能绕过。
- 工作负载三步（基本信息、容器配置、高级配置）；其余单页分区；CRD 有可信 Schema 才表单，否则诚实 YAML 回退。
- 编辑和 YAML 操作共用独立页面，保留侧栏；取消/成功返回原筛选上下文；去除列表操作菜单“查看详情”。
- 多文档 YAML 保留支持：逐文档 create-only、全部预校验后提交，显示逐项结果；不宣称事务，部分成功不能自动重复已成功项。
- Node/Event 等资源不额外增加不适用创建入口。托管资源提示覆盖风险，不绕权限。
- 保留工作区已有 system-update、部署脚本、README 等未提交改动。不提交其他任务内容。

## Architecture / Tech Stack
复用 Next.js、Ant Design、React Query、js-yaml、NestJS 和现有 Kubernetes 客户端，不新增依赖。公共编辑页管理 draft / original / validation snapshot；表单只接收 manifest 并按路径不可变更新。资源发现提供 GVK/GVR 与作用域；后端统一安全写入边界。

### Shared frontend contract
root 所有：frontend/src/lib/resource-editor.ts 导出 ResourceManifest、ResourceFormProps、getManifestValue、setManifestValue。
ResourceManifest = { apiVersion: string; kind: string; metadata: { name?: string; namespace?: string; resourceVersion?: string; [key: string]: unknown }; [key: string]: unknown }。
ResourceFormProps = { value: ResourceManifest; onChange: (value: ResourceManifest) => void; mode: 'create' | 'edit'; disabled?: boolean; step?: number }。setManifestValue(value, path: readonly (string|number)[], next: unknown): ResourceManifest 保留路径外字段；undefined 删除目标键。
工作负载模块导出 WorkloadResourceForm(props)，step=0/1/2，支持 Deployment/StatefulSet/DaemonSet/ReplicaSet/Job/CronJob/Pod。
其他模块导出 NativeResourceForm(props) 与 supportsNativeResourceForm(kind)，以及 SchemaResourceForm(props + schema)。避免导入 root 尚未生成的其他内部模块。

### Backend contract
新增 /api/resources/editor/schema GET：clusterId, apiVersion, kind, namespace?, resource?；返回 { schema: object|null, source: 'crd'|'openapi'|'unavailable', reason?: string }，授权范围内发现。
新增 /api/resources/editor/submit POST：{clusterId, namespace?, operation:'create'|'update', yaml, dryRun:boolean, identity?:{apiVersion,kind,name,namespace?,resource?}, resourceVersion?:string}；返回 {dryRun,items:[{apiVersion,kind,name,namespace,resourceVersion?,message}],total,message}。
编辑单对象、身份必须一致、resourceVersion 必填并与当前比较；使用平台正常更新语义，保留Kubernetes冲突状态。创建可多文档，先验证全部身份/权限再写，明确部分失败。
所有旧编辑调用也不能继续 force=true；兼容旧入口的必要 resourceVersion 从 YAML 获取，缺失报清晰错误。后端遇到能力不支持明确错误，不提供泛化跳过校验按钮。

## Capability matrix
- 完整工作负载表单：Deployment、StatefulSet、DaemonSet、ReplicaSet、Job、CronJob、Pod。
- 原生分区表单：Service、Ingress、PVC、PV、StorageClass、ConfigMap、Secret、ServiceAccount、Role/RoleBinding/ClusterRole/ClusterRoleBinding、Namespace、NetworkPolicy、Endpoints、EndpointSlice、HPA、ResourceQuota、LimitRange。
- Gateway API、VPA 和其他自定义资源：按可靠 CRD Schema 生成表单；没有 Schema 显示原因并提供 YAML，不制造空壳表单。
- 保留已有创建向导的伴生资源能力，以明确高级入口兼容，不能把旧 payload 当作编辑时的唯一来源。

## Task 1 — Baseline / contracts / safety tests (root)
- [x] 核对实际仓库、HEAD、旧 dirty 文件；goal 已激活。
- [x] 锁定上述公共接口和所有权；独立 worktree 并行，不共享修改文件。
- [ ] 为 YAML 解析、路径修改未知字段保留、敏感差异脱敏、身份锁定写真实行为测试并验证失败。
- [ ] 实现最小公共草稿、能力和路由工具，通过测试。

## Task 2 — Kubernetes server safety / schema (backend worktree)
- [ ] 读 resources controller/service 所有写入调用及 RBAC / Secret 防护。
- [ ] 先测试 create-only 冲突、update RV/身份冲突、dry-run 不 sync、每对象权限、Secret 权限、Schema拒绝/不可用区分。
- [ ] 实现 editor schema/submit 接口，不影响 system-update；去除旧编辑 force apply。
- [ ] 后端针对性 tests/build；提交文件/测试/安全边界报告，不提交或推送。

## Task 3 — Workload forms (workload worktree)
- [ ] frontend/src/components/resource-editor/workload-resource-form.tsx 与其专属辅助/tests。
- [ ] 三步表单，多 containers/initContainers，env/valueFrom、requests/limits、ports、probes、volumeMounts/volumes、调度、安全上下文、策略、Job/CronJob。
- [ ] 真实回填，不覆盖未知字段；名称命名空间不可变；实际不可变项锁定/说明。
- [ ] 测试对多容器、未知字段、删除/重排、numeric/string ports；局部 tsc/lint。

## Task 4 — Native / schema forms (native worktree)
- [ ] frontend/src/components/resource-editor/native-resource-form.tsx、schema-resource-form.tsx 与专属辅助/tests。
- [ ] 原生资源按上述矩阵补足专用表单，数组编辑保留未知字段，Secret写入与展示隔离。
- [ ] Schema object/array/enum/boolean/number/required/readOnly 与 Kubernetes int-or-string；不支持复杂 schema 时明确 YAML 回退，不能丢字段。
- [ ] 测试复杂嵌套、额外字段、必填、空集合删除和Secret占位保护；局部检查。

## Task 5 — Unified editor and all entry points (root integration)
- [ ] 独立 editor 页面（全局和 /clusters/:id/resources/editor），复用侧栏和当前集群上下文。
- [ ] 新建/编辑/YAML入口覆盖实际资源菜单，删除旧“查看详情”菜单但保留名字打开抽屉。
- [ ] 回填、双向切换、上传、多文档清单、错误定位、只读、未保存离开提示。
- [ ] 无变更禁保存；dry-run→脱敏预览→显式提交；409保留草稿；敏感内容内存管理。
- [ ] 来源提示、创建冲突、失败可重试、返回原页面筛选分页滚动；不改资源详情既有交互。

## Task 6 — Review / browser acceptance / recycle
- [ ] 分任务规格与质量检查；修正后再集成，保留历史未提交改动。
- [ ] frontend真实行为 tests、tsc、局部eslint、build:stable；backend针对性tests/build。
- [ ] 本地3000实际浏览器：创建/编辑/YAML互换、未知字段、冲突、只读、返回、明暗主题、窄屏固定footer及无覆盖。
- [ ] 不向现有业务集群写测试资源；若无专用测试集群，使用明确标记的本地受控接口测试dry-run/错误场景，生产集群只读。
- [ ] README仅追加本功能使用说明，不放维护约定，不覆盖旧更新执行器内容。
- [ ] 最终交叉审查；归档已集成worktree、终止空闲子agent，清理本轮tmp；全部达标后goal complete。

## Parallel boundaries / integration
backend 仅 resources 模块和直接必要测试；workload 仅 workload form 文件；native 仅 native/schema form 文件；root 负责公共类型、editor页面、API、导航和入口。共享接口变更必须先通知root。
用户明确要求独立worktree并行，覆盖技能串行默认；不使用新提交整合，root审核后按明确文件应用补丁，避免混入旧dirty文件。

## Preflight checks
| Tasks | Shared surface | Resolution |
|---|---|---|
| 1 / 3 / 4 | ResourceFormProps / immutable path helper | root唯一所有；本文件是固定合同 |
| 2 / 5 | editor API | 本文件固定request/response；变更需通知root |
| 3 / 5 | 工作负载step与mode | root管理步骤，form只修改草稿 |
| 4 / 5 | native/schema优先级 | 专用原生优先，CRD schema其次，YAML兜底 |
| 1–6 | 保留原能力、安全、tests和文件范围 | 与本任务spec一致；禁止盲目重建对象和绕权限 |
