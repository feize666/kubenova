# Scripts

脚本分为两条链路：

## 启动速查

### 开发机

```bash
bash scripts/install-deps.sh
bash scripts/db-init.sh
bash scripts/dev-up.sh
```

### 正式环境

```bash
bash scripts/prod-install.sh
bash scripts/prod-up.sh
```

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

## 常用命令

```bash
npm run install:all
npm run db:init
npm run dev:up
npm run dev:status
npm run dev:down
npm run topology:verify
```

## 正式部署示例

```bash
bash scripts/prod-install.sh
bash scripts/prod-up.sh
bash scripts/prod-status.sh
bash scripts/prod-switch.sh 1.1.0
bash scripts/prod-rollback.sh 1.0.0
bash scripts/prod-down.sh
bash scripts/prod-uninstall.sh
```
