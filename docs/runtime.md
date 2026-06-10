# 运行模式与日志规划

## 三种模式

### 1. 开发

启动方式：

```bash
bash scripts/service.sh dev up
```

特征：

- 前端默认 `FRONTEND_BOOT_MODE=dev`
- control-api 走 `nest start --watch`
- 前端走 `next dev`
- 代码变更后会自动重编译或重启

适合：

- 页面开发
- 接口联调
- 本地问题排查

不适合演示的原因：

- 启动链更重，首次拉起慢
- 变更会触发重编译或重启，过程里页面可能闪断
- dev 模式会保留更多开发期行为，稳定性不如发布态

### 2. 演示

启动方式：

```bash
FRONTEND_BOOT_MODE=stable bash scripts/service.sh dev up
```

特征：

- 后端仍用开发脚本拉起，便于本机联调
- 前端改为稳定包方式启动
- 运行时更接近正式发布的静态构建结果

适合：

- 交付前演示
- 不希望前端热更新干扰的场景
- 需要更稳定页面输出的场景

### 3. 生产

启动方式：

```bash
bash scripts/service.sh prod up
```

特征：

- 前端走 `/.next/standalone/server.js`
- control-api 走构建产物 `dist/src/main.js`
- runtime-gateway 走发布目录内二进制
- 依赖发布目录和 systemd 环境文件

适合：

- 正式部署
- 长期运行
- systemd 托管

## 为什么演示不要用 dev

dev 不是稳定展示态，而是编辑态：

- 每次源码变化都会触发局部重编译
- 首次启动和冷缓存场景更慢
- 组件、页面和路由可能在后台重新构建，演示时体验不稳

因此演示场景优先用 `FRONTEND_BOOT_MODE=stable`，让前端以稳定包方式运行。

## 为什么 dev 会慢、会重启

dev 模式下，脚本默认采用源码直跑：

- 前端使用 `next dev`
- control-api 使用 `nest start --watch`
- 代码监听会在文件变化时重新编译
- 某些缓存失效时，脚本会清理前端 `.next/dev`，再重新拉起

这些都是为了开发便利，不是为了启动速度或连续展示。

## 日志规划

开发、演示和生产都把日志放到各服务目录：

```text
frontend/logs/
backend/control-api/logs/
backend/runtime-gateway/logs/
```

开发和演示常见文件：

- `frontend/logs/dev.log`
- `backend/control-api/logs/dev.log`
- `backend/runtime-gateway/logs/dev.log`

生产常见文件：

- `frontend/logs/prod.log`
- `backend/control-api/logs/prod.log`
- `backend/runtime-gateway/logs/prod.log`

说明：

- `service.sh dev up` 和 `service.sh prod up` 会把各服务 stdout/stderr 定向到独立日志文件。
- `.run/` 只保留 pid、cache、state 等运行状态，不再作为服务日志目录。
- 生产 pid 使用 `.run/*.prod.pid`，避免和开发 pid 互相覆盖。
- 开发、演示、生产日志分文件，避免互相覆盖。

## 快速选型

- 改代码、调接口：开发
- 讲方案、做演示：演示
- 持续对外提供服务：生产
