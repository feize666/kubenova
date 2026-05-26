# Service Scripts Audit

范围：当前仓库 `scripts/` 下 shell 脚本。目标：梳理现状、重复点、建议归并入口、兼容迁移策略、最小验证命令。

## 总览

脚本目前分为三类：

- 开发服务链路：`install-deps.sh`、`db-init.sh`、`dev-up.sh`、`dev-down.sh`、`dev-status.sh`、`dev-supervise.sh`、`_dev-env.sh`、`_service-lib.sh`
- 生产服务链路：`prod-install.sh`、`prod-up.sh`、`prod-down.sh`、`prod-status.sh`、`prod-switch.sh`、`prod-rollback.sh`、`prod-uninstall.sh`、`_prod-lib.sh`、`_service-lib.sh`
- 拓扑专项链路：`topology-verify.sh`、`topology-clean-artifacts.sh`

主要问题：

- 开发与生产的 `up/down/status` 是两套入口，用户需记不同脚本名。
- `dev-status.sh` 复用 `_service-lib.sh`，`prod-status.sh` 自带一份健康检查和 PID 检查逻辑，存在重复。
- `dev-up.sh` 与 `prod-up.sh` 都有依赖检查、发布/产物检查、健康等待、日志输出，但实现分散。
- `prod-switch.sh` 与 `prod-rollback.sh` 都做版本目录校验、`current` 链接切换、systemd reload/restart，重复度高。
- `scripts/README.md` 提到根级 `npm run ...` 命令，但当前仓库根目录没有 `package.json`，这些命令现状不可用。

建议新增一个主入口：`scripts/service.sh`。

建议命令形态：

```bash
bash scripts/service.sh dev up [--no-gateway]
bash scripts/service.sh dev down [frontend|control-api|runtime-gateway|all]
bash scripts/service.sh dev restart [frontend|control-api|runtime-gateway|all]
bash scripts/service.sh dev status
bash scripts/service.sh dev logs [frontend|control-api|runtime-gateway] [-f]
bash scripts/service.sh prod up
bash scripts/service.sh prod down
bash scripts/service.sh prod restart
bash scripts/service.sh prod status
bash scripts/service.sh prod logs [frontend|control-api|runtime-gateway] [-f]
bash scripts/service.sh prod install
bash scripts/service.sh prod uninstall
bash scripts/service.sh prod switch <version>
bash scripts/service.sh prod rollback <version>
bash scripts/service.sh build [frontend|control-api|runtime-gateway|all]
bash scripts/service.sh test topology
bash scripts/service.sh clean topology-artifacts [--dry-run]
```

## 分类审计

| 分类 | 现状脚本 | 现状 | 重复点 / 缺口 | 建议主入口 |
| --- | --- | --- | --- | --- |
| start | `dev-up.sh`、`prod-up.sh` | 开发启动 frontend/control-api/runtime-gateway，生产从发布目录启动三服务。`dev-up.sh` 支持 `--no-gateway`、tmux、frontend dev/stable。 | 两者都有依赖检查、端口处理、健康等待、日志路径输出。生产脚本仍用 `_service-lib.sh` 的部分能力，但发布布局检查和环境加载独立实现。 | `service.sh dev up [--no-gateway]`、`service.sh prod up` |
| stop | `dev-down.sh`、`prod-down.sh` | 开发支持按服务或 all 停止；生产停止三服务。 | 都调用 `_service-lib.sh` 的 `stop_service`，但参数、PID 后缀、环境初始化分散。 | `service.sh dev down [service|all]`、`service.sh prod down` |
| restart | 无直接 restart 脚本 | `dev-up.sh` 会在不健康时重启受管服务；`prod-switch.sh`、`prod-rollback.sh` 会 restart systemd 服务；显式 restart 需手工 down/up。 | 缺统一显式重启入口；用户需记组合命令。 | `service.sh dev restart [service|all]`、`service.sh prod restart` |
| status | `dev-status.sh`、`prod-status.sh` | 开发状态复用 `_service-lib.sh`，输出运行状态和日志目录；生产状态内置 health/PID/port 检查，输出 `.run/logs`。 | `prod-status.sh` 与 `_service-lib.sh` 重复 `service_health_url`、`is_healthy`、PID 检测；生产 PID 文件名可能与 `prod-up.sh` 的 `.prod` 后缀不一致，需后续代码审查确认。 | `service.sh dev status`、`service.sh prod status` |
| logs | 无专门 logs 脚本 | `dev-up.sh`、`prod-up.sh` 输出各服务日志路径；`dev-status.sh` 输出日志目录。 | 没有 `tail`/`follow` 入口；用户需手工找路径。开发日志在各服务目录 `logs/dev.log`，生产日志在各服务目录 `logs/prod.log`，`prod-status.sh` 又提示 `.run/logs`，口径不一。 | `service.sh dev logs [service] [-f]`、`service.sh prod logs [service] [-f]` |
| build | 无统一 build 脚本 | `install-deps.sh` 安装依赖；`dev-up.sh` 在 `FRONTEND_BOOT_MODE=stable` 时构建前端 standalone；`prod-switch.sh`、`prod-up.sh` 只校验构建产物存在。 | 没有生产构建/打包入口；构建副作用藏在启动脚本中。 | `service.sh build frontend|control-api|runtime-gateway|all` |
| test | `topology-verify.sh` | 仅覆盖资源拓扑页面相关静态回归检查。 | 没有统一 test 入口；没有服务脚本自身测试；README 提到 `npm run topology:verify`，但根 `package.json` 不存在。 | `service.sh test topology` |
| clean | `topology-clean-artifacts.sh` | 清理 `.playwright-mcp`、`tmp-topology-default.md`、`tmp-topology-default.png`，支持 `--dry-run`。`dev-up.sh` 也会按条件清理 frontend dev cache。 | 清理入口只覆盖拓扑调试产物；启动脚本里存在隐式清理。 | `service.sh clean topology-artifacts [--dry-run]` |
| deploy | `prod-install.sh`、`prod-up.sh`、`prod-switch.sh`、`prod-rollback.sh`、`prod-uninstall.sh` | 安装 systemd 单元和 env 模板，启动发布目录，切换/回滚 current，卸载 systemd 单元和 env。 | install/up/switch/rollback 分散；switch 与 rollback 逻辑重复；部署缺少统一 release build/package 阶段。 | `service.sh prod install/up/switch/rollback/uninstall` |
| deprecated | 无脚本显式标记 deprecated | 旧入口仍是当前有效入口。 | `scripts/README.md` 的根级 `npm run ...` 命令在当前仓库不可用，应视为文档漂移或待恢复别名。 | 保留旧脚本为兼容 shim，README 改指向 `service.sh` 后再逐步标记 |

## 建议归并策略

建议只新增主入口，不直接删除现有脚本。

第一阶段：

- 新增 `scripts/service.sh`，内部调用现有脚本，不改变现有行为。
- 旧脚本继续可用：`dev-up.sh`、`dev-down.sh`、`dev-status.sh`、`prod-up.sh`、`prod-down.sh` 等都保留。
- README 同时展示旧命令和新命令，标注新入口为首选。

第二阶段：

- 将 dev/prod 的公共服务定义、端口、日志、health URL、PID 后缀收敛到 `_service-lib.sh`。
- 让 `prod-status.sh` 改为复用 `_service-lib.sh`，避免独立 health/PID 逻辑。
- 将 `prod-switch.sh` 与 `prod-rollback.sh` 的公共版本切换逻辑下沉到 `_prod-lib.sh`。

第三阶段：

- 旧脚本变成 thin wrapper，例如 `dev-up.sh` 只执行 `service.sh dev up "$@"`。
- wrapper 内输出一次迁移提示，但不影响退出码和 stdout 关键内容。
- 至少一个小版本后，再考虑在文档中标为 deprecated；脚本文件仍建议长期保留，降低运维脚本断裂风险。

## 兼容迁移表

| 旧命令 | 新入口建议 | 迁移策略 |
| --- | --- | --- |
| `bash scripts/dev-up.sh` | `bash scripts/service.sh dev up` | 旧脚本保留，后续改成 wrapper。 |
| `bash scripts/dev-up.sh --no-gateway` | `bash scripts/service.sh dev up --no-gateway` | 参数透传，保持语义。 |
| `bash scripts/dev-down.sh [service]` | `bash scripts/service.sh dev down [service]` | 默认 `all` 语义保持。 |
| `bash scripts/dev-status.sh` | `bash scripts/service.sh dev status` | 输出字段尽量保持兼容。 |
| `bash scripts/prod-up.sh` | `bash scripts/service.sh prod up` | 保留 `RELEASE_ROOT`、`SYSTEMD_ENV_DIR` 等环境变量。 |
| `bash scripts/prod-down.sh` | `bash scripts/service.sh prod down` | 保留 `.prod` PID 后缀语义。 |
| `bash scripts/prod-status.sh` | `bash scripts/service.sh prod status` | 统一 PID 文件和日志目录口径后再迁移。 |
| `bash scripts/prod-install.sh` | `bash scripts/service.sh prod install` | 保留 `SYSTEMD_DIR`、`ENV_DIR`、`RELEASE_ROOT`。 |
| `bash scripts/prod-uninstall.sh` | `bash scripts/service.sh prod uninstall` | 保留非致命 `systemctl` 容错。 |
| `bash scripts/prod-switch.sh <version>` | `bash scripts/service.sh prod switch <version>` | 共享产物校验和 current 切换逻辑。 |
| `bash scripts/prod-rollback.sh <version>` | `bash scripts/service.sh prod rollback <version>` | 共享 current 切换逻辑。 |
| `bash scripts/topology-verify.sh` | `bash scripts/service.sh test topology` | 旧命令保留给 CI。 |
| `bash scripts/topology-clean-artifacts.sh --dry-run` | `bash scripts/service.sh clean topology-artifacts --dry-run` | 保留 dry-run。 |

## 最小验证命令

文档变更后最小验证：

```bash
git diff --check -- docs/service-scripts-audit.md
bash -n scripts/*.sh
```

若后续实现 `scripts/service.sh`，最小验证建议：

```bash
bash -n scripts/service.sh scripts/*.sh
bash scripts/service.sh dev status
bash scripts/service.sh clean topology-artifacts --dry-run
bash scripts/service.sh test topology
```

生产链路验证应在具备发布目录和 systemd 权限的环境执行：

```bash
bash scripts/service.sh prod status
RELEASE_ROOT=/opt/k8s-aiops-manager/current bash scripts/service.sh prod up
```

## 风险

- 归并入口若直接重写服务管理逻辑，容易改变 PID 接管、健康等待、tmux、frontend supervisor 等既有细节；建议第一阶段只做代理调用。
- 生产状态脚本当前实现与 `_service-lib.sh` 有口径差异，迁移前需用真实发布目录验证 PID 文件、日志目录、健康检查输出。
- `db-init.sh --reset` 会清空本地开发数据库；不应被通用 `clean` 或 `restart` 隐式调用。
- `prod-uninstall.sh` 会删除 systemd 单元和环境文件；归并进主入口时必须保留显式子命令，避免误触。
