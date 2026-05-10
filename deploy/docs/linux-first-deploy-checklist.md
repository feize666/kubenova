# Linux 首次部署 Checklist

适用场景：

- 新机器首次上线
- 新版本首次切换到正式环境

## 1. 基础准备

- [ ] Linux 主机已安装 `bash`
- [ ] Linux 主机已安装 `node` / `npm`
- [ ] Linux 主机已安装 `go`
- [ ] Linux 主机已安装 `psql`
- [ ] Linux 主机已安装 `redis-cli`
- [ ] Linux 主机已安装 `curl`
- [ ] Linux 主机已安装 `fuser`
- [ ] PostgreSQL 已可连接
- [ ] Redis 已可连接

## 2. 开发机自检

- [ ] 执行 `bash scripts/install-deps.sh`
- [ ] 执行 `bash scripts/db-init.sh`
- [ ] 执行 `bash scripts/dev-up.sh`
- [ ] 执行 `bash scripts/dev-status.sh`
- [ ] `http://localhost:3000` 可打开
- [ ] `http://localhost:4000` 可打开
- [ ] `ws://localhost:4100` 可连接

## 3. 正式包准备

- [ ] 发布包已解压到 `/opt/k8s-aiops-manager/releases/<version>`
- [ ] `/opt/k8s-aiops-manager/current` 已指向目标版本
- [ ] `control-api/dist/src/main.js` 存在
- [ ] `runtime-gateway/runtime-gateway` 可执行
- [ ] `frontend/.next/standalone/server.js` 存在
- [ ] `frontend/.next/standalone/.next/static` 存在
- [ ] `/etc/k8s-aiops-manager/*.env` 已配置

## 4. 正式安装

- [ ] 执行 `bash scripts/prod-install.sh`
- [ ] 执行 `bash scripts/prod-up.sh`
- [ ] 执行 `bash scripts/prod-status.sh`

## 5. 首次验证

- [ ] `curl -fsS http://127.0.0.1:3000/ >/dev/null`
- [ ] `curl -fsS http://127.0.0.1:4000/api/capabilities >/dev/null`
- [ ] `curl -fsS http://127.0.0.1:4100/healthz`
- [ ] 登录页可以打开
- [ ] 一个功能页可以打开

## 6. 常见回滚

- [ ] 记录上一个可用版本号
- [ ] 执行 `bash scripts/prod-rollback.sh <version>`
- [ ] 执行 `bash scripts/prod-status.sh`

