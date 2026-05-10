# 后端服务说明

当前目录包含两个后端服务：

1. `control-api`（NestJS，端口 `4000`）
- 认证与业务 API：登录、会话、集群列表

2. `runtime-gateway`（Go，端口 `4100`）
- 实时能力：终端 WebSocket、日志 WebSocket

## 快速启动

```bash
# 终端1
cd backend/control-api
npm install
npm run start:dev

# 终端2
cd backend/runtime-gateway
GOPROXY=https://goproxy.cn,direct go run ./cmd/runtime-gateway
```

## 联调建议

- 前端登录后获取 token，调用 `control-api` 的业务接口
- 前端终端页与日志页改为连接 `runtime-gateway`：
  - `ws://localhost:4100/ws/terminal`
  - `ws://localhost:4100/ws/logs`
