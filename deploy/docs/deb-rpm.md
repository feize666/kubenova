# DEB/RPM

## 现状说明

当前 `nfpm` 资产只覆盖 `runtime-gateway` 二进制、systemd unit、env 模板。
未打入 `control-api` 构建产物、前端 standalone 产物、Node.js 运行时依赖。

## 结论

- 可用于分发 `runtime-gateway + systemd` 资产
- 不可单独作为“别人拿走直接可用”的完整安装包

## 临时建议

完整部署优先使用：

- [binary-systemd.md](binary-systemd.md)
- [docker-compose.md](docker-compose.md)

## 若继续使用 DEB/RPM

至少还需补齐：

- `control-api/dist`、`node_modules`、`prisma/`
- 前端 standalone 产物
- 发布目录与 `/opt/k8s-aiops-manager/current` 一致的完整文件映射
- 宿主机 `node` / `npx` 依赖约束
