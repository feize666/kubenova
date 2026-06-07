# deploy/systemd

systemd 单元与环境模板目录。

- `kubenova-control-api.service`: control-api 服务单元
- `kubenova-runtime-gateway.service`: runtime-gateway 服务单元
- `kubenova.target`: 聚合 target
- `env/*.env.example`: 推荐环境模板

- 发布根目录：`/opt/kubenova/current`
- 系统级环境文件：`/etc/kubenova/*.env`

## 安装顺序

1. 将发布包解压到 `/opt/kubenova/current`
2. 执行 `bash scripts/prod-install.sh`
3. 使用 `bash scripts/prod-up.sh` 启动正式环境
4. 使用 `bash scripts/prod-status.sh` 检查状态
5. 使用 `bash scripts/prod-down.sh` 停止正式环境
6. 使用 `bash scripts/prod-uninstall.sh` 卸载 systemd 和环境模板
