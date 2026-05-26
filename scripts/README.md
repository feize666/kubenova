# Scripts

脚本保留旧入口兼容，同时推荐使用统一入口 `scripts/service.sh`。

## 启动速查

### 开发机

```bash
bash scripts/service.sh install-deps
bash scripts/service.sh db-init
bash scripts/service.sh dev up
bash scripts/service.sh dev status
```

### 正式环境

```bash
bash scripts/prod-install.sh
bash scripts/service.sh prod up
bash scripts/service.sh prod status
```

## 统一入口

- `service.sh dev up [--no-gateway]`：启动开发环境服务
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
- `dev-status.sh`：查看开发环境状态
- `topology-verify.sh`：资源全景图关键静态校验
- `topology-clean-artifacts.sh`：清理拓扑调试产物

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
