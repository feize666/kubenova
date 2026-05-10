# Deployment Docs Index

## 适用场景

- Linux 单机或内网服务器直接部署
- 需要先跑起来再细看安装和回滚
- 需要按 Git 文档直接点击跳转

## 阅读顺序

先看 Linux 部署：

1. [linux-first-deploy-checklist.md](linux-first-deploy-checklist.md) - 首次部署前逐项检查
2. [linux-quick-start.md](linux-quick-start.md) - 最短启动路径
3. [linux-usage.md](linux-usage.md) - 完整 Linux 使用说明

再看部署方式：

- [binary-systemd.md](binary-systemd.md) - 单机 / systemd 发布
- [docker-compose.md](docker-compose.md) - Docker Compose 发布
- [k8s-kustomize.md](k8s-kustomize.md) - Kubernetes 发布
- [deb-rpm.md](deb-rpm.md) - DEB / RPM 包发布
- [upgrade-rollback.md](upgrade-rollback.md) - 升级和回滚流程
