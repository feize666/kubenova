# runtime-gateway

KubeNova 运行时网关（Go）。

## 能力

- `GET /healthz`
- `GET /readyz`
- `GET /version`
- `GET /ws/terminal`：终端 WebSocket（模拟 exec）
- `GET /ws/logs`：日志 WebSocket（模拟 follow）
- 前端静态资源服务（SPA fallback）

## 运行

```bash
go run ./cmd/runtime-gateway
```

默认端口 `4100`。

## 开发模式

```bash
npm run dev:up
```

## 发布模式

发布部署步骤统一参考：

- `deploy/docs/binary-systemd.md`
- `deploy/docs/docker-compose.md`
- `deploy/docs/k8s-kustomize.md`
- `deploy/docs/deb-rpm.md`

## 启动参数（环境变量）

- `PORT`：监听端口，默认 `4100`
- `NODE_ENV`：`production` 时会强制校验 `RUNTIME_TOKEN_SECRET`
- `RUNTIME_TOKEN_SECRET`：生产环境必须设置强随机值
- `FRONTEND_STATIC_DIR`：前端静态资源目录（优先）

## 健康检查与版本接口

- `GET /healthz`：存活探针，返回 `200 ok`
- `GET /readyz`：就绪探针；当服务初始化完成且静态资源可用时返回 `200 ready`，否则 `503 not ready`
- `GET /version`：返回 JSON：
  - `version`
  - `gitCommit`
  - `buildTime`
  - `frontendAssetHash`
  - `apiSchemaVersion`
  - `uptimeSeconds`

## 静态资源

- 可通过环境变量 `FRONTEND_STATIC_DIR` 指向前端构建产物目录（优先使用该目录）。
- 若 `FRONTEND_STATIC_DIR` 未设置或不可用，自动回退到二进制内嵌静态文件（`go:embed`）。
- 对于非 `/api`、非 `/ws` 请求：
  - 命中文件则返回文件；
  - 未命中文件则返回 `index.html`（SPA 路由回退）。
