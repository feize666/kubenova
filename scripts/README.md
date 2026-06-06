# Scripts

脚本保留旧入口兼容，同时推荐使用统一入口 `scripts/service.sh`。

## 启动速查

### 开发机

```bash
bash scripts/service.sh install-deps
bash scripts/service.sh db-init
bash scripts/service.sh dev up
bash scripts/service.sh dev up --stable-frontend
bash scripts/service.sh dev status
```

### 正式环境

```bash
bash scripts/prod-install.sh
bash scripts/service.sh prod up
bash scripts/service.sh prod status
```

## 统一入口

- `service.sh dev up [--no-gateway] [--stable-frontend|--dev-frontend]`：启动开发环境服务；发布/浏览器回归优先用 `--stable-frontend` 避免 Next dev 大路由扫测时重启
- `service.sh dev down [service...]`：停止开发环境服务
- `service.sh dev restart [service...]`：重启开发环境服务
- `service.sh dev status`：查看开发环境状态
- `service.sh dev logs [service]`：查看开发环境日志
- `service.sh prod up`：启动正式环境服务
- `service.sh prod down`：停止正式环境服务
- `service.sh prod restart`：重启正式环境服务
- `service.sh prod status`：查看正式环境状态
- `service.sh prod logs [service]`：查看正式环境日志
- `service.sh topology verify`：资源全景图关键静态校验
- `service.sh topology clean`：清理拓扑调试产物
- `service.sh help`：查看帮助

## 开发链路

- `install-deps.sh`：安装 frontend / control-api / runtime-gateway 依赖
- `db-init.sh`：初始化或重置本地 PostgreSQL + Prisma
- `dev-up.sh`：启动开发环境服务
- `dev-down.sh`：停止开发环境服务
- `dev-status.sh`：查看开发环境状态，输出 pid、端口、健康状态、启动模式、进程数、CPU/RSS；默认 `SERVICE_STATUS_ADOPT=false`，只检测不接管监听 pid，无监听残留只报告不停止
- `topology-verify.sh`：资源全景图关键静态校验
- `topology-clean-artifacts.sh`：清理拓扑调试产物

## 前端守卫

在 `frontend/` 下运行：

```bash
npm run check:navigation
npm run e2e:performance:switching:smoke
npm run e2e:performance:switching:budget
```

- `check:navigation` 默认不写产物；需要 JSON 摘要时设置 `CHECK_NAVIGATION_OUTPUT=1`，文件写入系统临时目录，也可显式传路径
- `e2e:performance:switching` 默认摘要写入系统临时目录；可用 `PERF_OUTPUT` 指定文件或 `PERF_OUTPUT_DIR` 指定目录
- `e2e:performance:switching:budget` 默认启用 p95、单路由耗时、请求数、API 请求数、慢请求和 console error 预算；阈值可用同名 `PERF_MAX_*` 环境变量覆盖

## 正式链路

- `prod-install.sh`：安装 systemd 单元和环境模板
- `prod-up.sh`：按发布目录启动正式环境
- `prod-status.sh`：查看正式环境状态
- `prod-down.sh`：停止正式环境
- `prod-switch.sh`：切换 `current` 到指定版本
- `prod-rollback.sh`：回滚 `current` 到指定版本
- `prod-uninstall.sh`：卸载 systemd 单元和环境模板

## 兼容迁移

旧脚本当前仍受支持，便于 CI、运维脚本和个人工作流平滑迁移。新增自动化优先使用 `scripts/service.sh`。

| 旧命令 | 推荐命令 |
| --- | --- |
| `bash scripts/dev-up.sh` | `bash scripts/service.sh dev up` |
| `bash scripts/dev-up.sh --no-gateway` | `bash scripts/service.sh dev up --no-gateway` |
| `FRONTEND_BOOT_MODE=stable bash scripts/dev-up.sh` | `bash scripts/service.sh dev up --stable-frontend` |
| `bash scripts/dev-down.sh [service]` | `bash scripts/service.sh dev down [service]` |
| `bash scripts/dev-status.sh` | `bash scripts/service.sh dev status` |
| `bash scripts/prod-up.sh` | `bash scripts/service.sh prod up` |
| `bash scripts/prod-down.sh` | `bash scripts/service.sh prod down` |
| `bash scripts/prod-status.sh` | `bash scripts/service.sh prod status` |
| `bash scripts/prod-install.sh` | `bash scripts/service.sh prod install` |
| `bash scripts/prod-switch.sh <version>` | `bash scripts/service.sh prod switch <version>` |
| `bash scripts/prod-rollback.sh <version>` | `bash scripts/service.sh prod rollback <version>` |
| `bash scripts/prod-uninstall.sh` | `bash scripts/service.sh prod uninstall` |
| `bash scripts/topology-verify.sh` | `bash scripts/service.sh test topology` |
| `bash scripts/topology-clean-artifacts.sh --dry-run` | `bash scripts/service.sh clean topology-artifacts --dry-run` |

## 常用命令

```bash
bash scripts/service.sh install-deps
bash scripts/service.sh db-init
bash scripts/service.sh dev up
bash scripts/service.sh dev status
bash scripts/service.sh dev down
bash scripts/service.sh topology verify
```

## 正式部署示例

```bash
bash scripts/prod-install.sh
bash scripts/service.sh prod up
bash scripts/service.sh prod status
bash scripts/prod-switch.sh 1.1.0
bash scripts/prod-rollback.sh 1.0.0
bash scripts/service.sh prod down
bash scripts/prod-uninstall.sh
```
