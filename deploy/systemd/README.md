# deploy/systemd

systemd 单元与环境模板目录。

- `aiops-control-api.service`: control-api 服务单元
- `aiops-runtime-gateway.service`: runtime-gateway 服务单元
- `aiops.target`: 聚合 target
- `env/*.env.example`: 推荐环境模板

路径约定与 [install-layout.md](../binary/install-layout.md) 保持一致：

- 发布根目录：`/opt/k8s-aiops-manager/current`
- 系统级环境文件：`/etc/k8s-aiops-manager/*.env`

## 安装顺序

1. 准备正式发布目录，并将版本包解压到 `/opt/k8s-aiops-manager/releases/<version>`
2. 切换 `current` 到目标版本
3. 执行 `bash scripts/prod-install.sh`
4. 使用 `bash scripts/prod-up.sh` 启动正式环境
5. 使用 `bash scripts/prod-status.sh` 检查状态
6. 使用 `bash scripts/prod-switch.sh <version>` 或 `bash scripts/prod-rollback.sh <version>` 切换版本
7. 使用 `bash scripts/prod-down.sh` 停止正式环境
8. 使用 `bash scripts/prod-uninstall.sh` 卸载 systemd 和环境模板
