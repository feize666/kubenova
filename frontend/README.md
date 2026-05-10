# KubeNova 前端

本项目是基于 **React + Next.js(App Router) + TypeScript** 的 AIOps 运维控制台前端。

## 已接入技术栈

- Next.js（App Router）
- React
- TypeScript
- Ant Design
- ECharts（echarts-for-react）
- TanStack Query
- TanStack Table

## 已搭建页面路由

- `/dashboard`
- `/clusters`
- `/network/services`
- `/network/ingress`
- `/network/topology`
- `/workloads/deployments`
- `/workloads/statefulsets`
- `/workloads/daemonsets`
- `/workloads/replicasets`
- `/workloads/jobs`
- `/workloads/cronjobs`
- `/storage/pv`
- `/storage/pvc`
- `/users`
- `/users/rbac`
- `/configs`
- `/security`
- `/logs`
- `/monitoring`
- `/ai-assistant`
- `/terminal`

## 本地运行

```bash
npm install
npm run dev
```

默认访问：`http://localhost:3000`（会自动跳转到 `/dashboard`）。

## 质量检查

```bash
npm run lint
npm run build
```

## 当前阶段说明

当前已完成“页面素材搭建”阶段：
- 统一顶部导航、左侧菜单、主内容区、右下角 AI 浮窗入口
- 明暗主题切换（默认深色）
- 仪表盘、网络拓扑、工作负载部署、终端页面具备真实交互
- 其余页面已提供可运行的模块化交互骨架
