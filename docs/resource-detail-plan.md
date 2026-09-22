# Headlamp 风格资源详情页改造计划

## 目标范围
全站 28 种资源统一使用 Master-Detail 详情面板：
- 点击资源名右侧滑出面板（非固定分栏）
- 子路由驱动 `/clusters/{id}/resource/{kind}/{name}`
- Tab 切换（概览/Pod列表/容器/Events/Conditions/日志/终端/YAML）
- 关联资源内联跳转 + 面包屑返回
- 日志/终端：Tab 内预览 + "打开全屏"按钮
- 删除侧边栏独立日志/终端菜单

## 非目标
- 不改变后端 API
- 不改变资源列表的筛选/搜索功能
- 不新增 CRUD 操作

---

## 任务分层

### L0: 基础设施（串行，必须先完成）
| ID | 任务 | 说明 | 验收 |
|----|------|------|------|
| L0-1 | MasterDetailShell 布局组件 | 右侧滑入面板、动画、关闭按钮、响应式 | 点击行→面板滑入，关闭→面板收起 |
| L0-2 | 统一详情路由 | `/clusters/{id}/resource/{kind}/{name}` 动态路由 | 任意 kind+name 可访问详情页 |
| L0-3 | DetailTabBar + Tab 配置表 | kind→Tab[] 映射，Tab 切换 | 不同 kind 显示不同 Tab |
| L0-4 | 删除侧边栏日志/终端菜单 | cluster-workspace.ts 移除 logs/terminal | 侧边栏无日志/终端入口 |
| L0-5 | 资源列表页集成详情面板 | 列表页注入详情面板触发逻辑 | 点击行→URL 变→面板弹出 |

### L1: P0 工作负载详情（并行 4 路）
| ID | 任务 | 说明 | 验收 |
|----|------|------|------|
| L1-1 | Overview Tab（通用） | 所有资源通用概览 Tab | 字段正确、链接可跳 |
| L1-2 | PodList Tab | Deployment/STS/DS 的 Pod 列表 Tab | 表格渲染、点击跳 Pod 详情 |
| L1-3 | Pod Containers + Logs + Terminal Tab | Pod 专有 Tab | 容器信息、日志预览、终端入口 |
| L1-4 | Events Tab + Conditions Tab + YAML Tab | 通用 Events/Conditions/YAML | Tab 内容正确渲染 |
| L1-5 | ReplicaSet + Job + CronJob 详情 | 剩余 P0 资源 Tab 配置 | 每种资源 Tab 正确 |

### L2: P1 网络存储配置（并行 3 路）
| ID | 任务 | 说明 |
|----|------|------|
| L2-1 | Service/Ingress/Endpoints/EndpointSlice/NetworkPolicy 详情 | 网络资源 Tab |
| L2-2 | PV/PVC/SC 详情 | 存储资源 Tab |
| L2-3 | ConfigMap/Secret/SA/LimitRange/ResourceQuota 详情 | 配置资源 Tab |

### L3: P2 其余资源 + 收尾
| ID | 任务 | 说明 |
|----|------|------|
| L3-1 | HPA/VPA + Gateway/HTTPRoute/GatewayClass 详情 | 弹性伸缩+Gateway |
| L3-2 | Node/Namespace/Cluster/CRD 详情 | 基础其他 |
| L3-3 | 面包屑导航 + 全站回归 | 面包屑、跳转、旧 Drawer 下线 |

---

## 并行矩阵

```
L0: L0-1 → L0-2 → L0-3 → L0-4+5 (串行，基础设施依赖)
                                ↓
L1:  ┌─ L1-1 ─┬─ L1-2 ─┬─ L1-3 ─┬─ L1-4 ─┬─ L1-5 ─┐  (全并行)
     └────────┴────────┴────────┴────────┴────────┘
                                ↓
L2:  ┌─ L2-1 ─┬─ L2-2 ─┬─ L2-3 ─┐  (全并行)
     └────────┴────────┴────────┘
                                ↓
L3:  ┌─ L3-1 ─┬─ L3-2 ─┬─ L3-3 ─┐  (全并行)
     └────────┴────────┴────────┘
```

## 风险
- 路由冲突：旧 `/workloads/deployments` 与新 `/resource/deployment/{name}` 需共存
- 现有 Drawer 组件依赖：需渐进替换，不一次性删除

## 回滚
- 每个 L0 提交独立、可 revert
- L1+ 改动不涉及路由变更，仅增组件
