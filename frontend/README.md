# KubeNova 前端

本项目是基于 **React + Next.js(App Router) + TypeScript** 的 KubeNova 运维控制台前端。

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

前端在平台里通常有两种启动诉求：

- 开发：`npm run dev`，适合改页面和联调接口。
- 演示/稳定预览：`npm run build:stable && npm run start:stable`，或由 `bash scripts/dev-up.sh` 配合 `FRONTEND_BOOT_MODE=stable` 启动。

不要用 dev 做演示：dev 会走源码直跑，Next 每次改动都要重新编译相关页面，首次启动和热更新都更重，页面切换时也更容易被重新构建或重启影响。

## 质量检查

```bash
npm run lint
npm run build
```

## 筛选联动回归（可执行）

- 用例清单文档：`docs/filter-regression-matrix.md`
- 列出全部用例：`npm run e2e:filters:list`
- 运行逐页回归：

```bash
FILTER_BASE_URL=http://127.0.0.1:3000 FILTER_USER=<账号> FILTER_PASS=<密码> npm run e2e:filters:matrix
```

## 当前阶段说明

当前已完成“页面素材搭建”阶段：
- 统一顶部导航、左侧菜单、主内容区、右下角 AI 浮窗入口
- 明暗主题切换（默认深色）
- 仪表盘、网络拓扑、工作负载部署、终端页面具备真实交互
- 其余页面已提供可运行的模块化交互骨架
