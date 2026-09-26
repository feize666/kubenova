# Headlamp 风格资源拓扑重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use autonomous-worktree-subagent and subagent-driven-development to implement this plan task-by-task.

**Goal:** 将资源拓扑改造成 Headlamp 风格的资源全景图，保留全部真实资源和关系，提供资源域过滤，并稳定呈现 Pod → Service → Endpoints/EndpointSlice → Ingress 的横向链路。

**Architecture:** 继续复用 React Flow + ELK。后端资源和关系先标准化为资源域与真实关系，再由可见性过滤生成子图，ELK 使用 LR 分层布局，最后由独立节点和连线路径渲染器绘制。

**Tech Stack:** Next.js、React、TypeScript、@xyflow/react、ELK、Node test runner。

**Spec:** 本轮对话已确认的 Headlamp 资源全景图方案。

## Global Constraints

- 本地前端服务固定使用 `http://localhost:3000`。
- 不删除后端返回的任何资源或关系；过滤仅影响前端可见子图。
- 真实访问路径按 `Deployment/Controller → ReplicaSet/Controller → Pod → Service → Endpoints/EndpointSlice → Ingress` 横向阅读。
- 所有真实关系使用同等视觉级别，不弱化控制器关系。
- 默认无箭头、1.5px 左右平滑贝塞尔曲线；连线不得穿过节点。
- 资源域过滤支持工作负载、存储、集群、网络、安全、配置、自定义资源。
- 默认分组为命名空间，保留实例和节点分组。
- 过滤、命名空间、搜索、分组状态同步到 URL 查询参数。
- 详情抽屉打开和关闭不得清空背景拓扑或重置筛选状态。
- 每个切片必须添加或更新最小行为测试；完成前必须运行 TypeScript 检查、定向测试和 Chrome 实际页面验证。
- 不覆盖工作区中已有的无关未提交改动。

## 并行矩阵与依赖

| 切片 | 独立 worktree | 允许并行 | 输出 |
|---|---|---|---|
| A. 资源域过滤与 URL 状态 | `topology-filter` | B、C | 可见子图、资源域弹层、URL 状态接口 |
| B. LR 分层与连接通道 | `topology-layout` | A、C | 固定 rank、连接点、避障路径、布局测试 |
| C. 节点/工具栏/交互视觉 | `topology-ui` | A、B | Headlamp 风格筛选按钮、节点和连线样式 |
| 主线集成 | 当前工作区 | 依赖 A/B/C | 合并、回归、浏览器截图验收 |

## Task 1: 资源域过滤与 URL 状态

**Files:**
- Modify: `frontend/src/app/network/topology/page.tsx`
- Modify: `frontend/src/modules/topology-kubejojo/engine/grouping.ts`
- Modify: `frontend/src/modules/topology-kubejojo/engine/topology-entry.ts`
- Create/modify: `frontend/src/components/topology-source-chips.tsx`
- Test: `frontend/src/modules/topology-kubejojo/engine/topology-engine.test.ts`

**Interfaces:**
- Produces `ResourceDomain = "workloads" | "storage" | "cluster" | "network" | "security" | "configuration" | "custom"`。
- Produces URL 状态解析和序列化函数，至少覆盖 `namespace`、`domains`、`search`、`groupBy`。

- [ ] 为过滤后的可见子图写失败测试：隐藏任一端时隐藏关系，不产生悬空边；恢复域后节点和关系恢复。
- [ ] 为 URL 状态往返写失败测试：解析后序列化保持命名空间、域、搜索和分组。
- [ ] 实现资源域分类、空类型隐藏、全选/清空和 URL 同步。
- [ ] 运行定向 topology engine 测试并提交。

## Task 2: LR 分层与连接通道

**Files:**
- Modify: `frontend/src/modules/topology-kubejojo/engine/elk-layout.ts`
- Modify: `frontend/src/modules/topology-kubejojo/engine/graph-model.ts`
- Modify: `frontend/src/modules/topology-kubejojo/renderers/path-geometry.ts`
- Test: `frontend/src/modules/topology-kubejojo/engine/topology-engine.test.ts`

**Interfaces:**
- Consumes Task 1 生成的可见资源/关系子图。
- Produces `layoutKubejojoGraph` 的稳定 LR 节点坐标和不穿节点的 sections。

- [ ] 先写失败测试：Deployment/ReplicaSet/Pod/Service/EndpointSlice/Ingress 坐标严格递增；同一 rank 节点 x 相同；所有边端点落在节点边界内。
- [ ] 写失败测试：Service → Ingress 仅在实际碰撞时局部避让，Pod → EndpointSlice 不再统一大弧线绕行。
- [ ] 实现固定 rank、同列对齐、边缘连接点和多边通道分离；移除对所有跨列边的统一 detour。
- [ ] 将路径转换保持为平滑贝塞尔，不生成箭头 marker。
- [ ] 运行定向布局测试并提交。

## Task 3: 节点、工具栏与 Headlamp 交互视觉

**Files:**
- Modify: `frontend/src/app/network/topology/page.tsx`
- Modify: `frontend/src/app/topology-kubejojo.css`
- Modify: `frontend/src/app/topology-panorama.css`
- Modify: `frontend/src/modules/topology-kubejojo/TopologyCanvas.tsx`
- Modify: `frontend/src/modules/topology-kubejojo/renderers/path-geometry.ts`

**Interfaces:**
- Consumes Task 1 的资源域状态和 Task 2 的 sections。
- Produces Headlamp 风格资源域组合按钮、分层节点卡片、无箭头交互连线。

- [ ] 为资源域组合按钮、弹层外点击关闭、节点悬停链路高亮写失败测试或可复现交互检查。
- [ ] 将顶部多个独立域按钮收敛为单一组合按钮，低频操作收入弹层。
- [ ] 统一节点类型、名称、状态排版；保证名称最多两行且不覆盖资源类型。
- [ ] 默认静态曲线，悬停/选中局部流动，支持减少动态效果。
- [ ] 保留左下角缩放、100%、适配全图控件，适配明暗主题。
- [ ] 运行前端类型检查并提交。

## Task 4: 主线集成与验收

**Files:**
- 主线已有改动按文件审核后集成 A/B/C；不得覆盖无关改动。
- Test artifacts: 仅使用临时目录，不把截图或 trace 写入仓库。

- [ ] 逐个审核三个 worktree diff，确认未越界。
- [ ] 按 A → B → C 顺序合入或移植，解决接口冲突。
- [ ] 运行 `npx tsc --noEmit --pretty false`。
- [ ] 运行完整 `topology-engine.test.ts`，记录既有失败与本轮失败的区别。
- [ ] 确认 3000 端口服务存活并用 Chrome 打开真实拓扑。
- [ ] 验证多 Pod、Service、Endpoints、EndpointSlice、Ingress、多个 Namespace、资源域过滤、搜索定位、详情抽屉、明暗主题。
- [ ] 验收通过后回收已完成 agent 和 worktree；未通过则保留对应 worktree 进入修复轮次。

## 回滚策略

- 不使用 `git reset --hard`。
- 每个切片保留独立提交；集成冲突时只回退本轮切片提交。
- 若布局回归导致资源或关系丢失，优先恢复旧布局输入，保留过滤器和测试。
- 生产环境不部署、不推送，仅本地 3000 端口验收。
