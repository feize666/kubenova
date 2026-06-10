# Service Scripts Audit

范围：当前仓库 `scripts/` 下 shell 脚本。结论：脚本已从多入口收敛为统一入口，旧的 `dev-up.sh`、`prod-up.sh`、`prod-switch.sh` 等重复脚本已移除。

## 当前脚本

| 脚本 | 用途 |
| --- | --- |
| `scripts/service.sh` | 唯一对外入口，负责命令分派、依赖安装、数据库初始化、构建、日志、拓扑清理 |
| `scripts/dev.sh` | 开发环境服务生命周期：`up/down/restart/status` |
| `scripts/prod.sh` | 生产发布目录服务生命周期：`up/down/restart/status/install/uninstall/switch/rollback` |
| `scripts/_service-lib.sh` | 端口、PID、健康检查、日志、停止/接管进程等共享逻辑 |
| `scripts/_dev-env.sh` | 开发环境默认变量 |
| `scripts/dev-supervise.sh` | 前端 dev 模式 supervisor |
| `scripts/package-release.sh` | Ubuntu 二进制发布包构建 |
| `scripts/topology-verify.sh` | 拓扑相关静态回归校验 |

## 当前命令

```bash
bash scripts/service.sh help

bash scripts/service.sh install-deps
bash scripts/service.sh db-init

bash scripts/service.sh dev up [--no-gateway] [--stable-frontend|--dev-frontend] [--stable-api|--dev-api]
bash scripts/service.sh dev down [frontend|control-api|runtime-gateway|all]
bash scripts/service.sh dev restart [frontend|control-api|runtime-gateway|all]
bash scripts/service.sh dev status
bash scripts/service.sh dev logs [frontend|control-api|runtime-gateway|all]

bash scripts/service.sh prod install
bash scripts/service.sh prod up
bash scripts/service.sh prod down
bash scripts/service.sh prod restart
bash scripts/service.sh prod status
bash scripts/service.sh prod logs [frontend|control-api|runtime-gateway|all]
bash scripts/service.sh prod switch <version>
bash scripts/service.sh prod rollback <version>
bash scripts/service.sh prod uninstall

bash scripts/service.sh build frontend|control-api|runtime-gateway|all
bash scripts/service.sh package release
bash scripts/service.sh test topology
bash scripts/service.sh clean topology-artifacts [--dry-run]
bash scripts/service.sh clean dev-cache
```

## 精简结果

- 开发入口：`dev-up.sh`、`dev-down.sh`、`dev-status.sh` 合并到 `dev.sh`，外部统一走 `service.sh dev ...`。
- 生产入口：`prod-up.sh`、`prod-down.sh`、`prod-status.sh`、`prod-install.sh`、`prod-uninstall.sh`、`prod-switch.sh`、`prod-rollback.sh` 合并到 `prod.sh`，外部统一走 `service.sh prod ...`。
- 小工具：`install-deps.sh`、`db-init.sh`、`topology-clean-artifacts.sh` 合并到 `service.sh`。
- 前端 dev 缓存清理由 `service.sh clean dev-cache` 提供，清理 `frontend/.next/dev` 和 `frontend/.next/cache`。
- 生产公共库 `_prod-lib.sh` 已移除，切换/回滚逻辑在 `prod.sh` 内统一。
- `scripts/README.md` 已移除，根 `README.md` 和 `docs/` 部署文档作为脚本说明来源。

## Helm 依赖策略

开发和生产启动不再把 `helm` 作为硬依赖。未安装 Helm 时：

- `service.sh dev up` 和 `service.sh prod up` 继续启动基础服务。
- 输出警告说明 Helm 应用/仓库能力不可用。
- 需要 Helm 能力时再安装 Helm CLI。

## 开发数据库

开发默认 `DATABASE_URL` 指向旧数据所在库：

```text
postgresql://kubenova:kubenova_dev@localhost:5432/k8s_aiops?connection_limit=20&pool_timeout=30
```

`bash scripts/service.sh db-init` 默认初始化 `k8s_aiops`，避免误连空库导致集群数据看似丢失。生产文档仍使用生产库名 `kubenova`。

## 最小验证

```bash
bash -n scripts/*.sh
bash scripts/service.sh help
bash scripts/service.sh dev status
bash scripts/service.sh clean topology-artifacts --dry-run
bash scripts/service.sh clean dev-cache
bash scripts/service.sh test topology
```

生产链路需在具备发布目录和 systemd 权限的环境验证：

```bash
sudo bash scripts/service.sh prod install
sudo bash scripts/service.sh prod up
sudo bash scripts/service.sh prod status
```

## 风险

- `bash scripts/service.sh db-init --reset` 会清空开发数据库，只能显式执行。
- `bash scripts/service.sh prod uninstall` 会删除 systemd 单元和环境文件，只能显式执行。
- 历史文档如交付总结可能保留旧脚本名作为当时记录，不代表当前可用入口。
