# Binary + systemd

## 前置条件

- Linux 主机，`systemd` 可用。
- 已准备版本化发布目录（参考 `deploy/binary/install-layout.md`）。
- 服务单元文件已部署：
  - `/usr/lib/systemd/system/aiops-runtime-gateway.service`
  - `/usr/lib/systemd/system/aiops-control-api.service`
- 发布目录遵循 `deploy/binary/install-layout.md`，即 `/opt/k8s-aiops-manager/current/...`
- 环境文件位于 `/etc/k8s-aiops-manager/`

## 安装（文档化步骤）

```bash
VERSION=1.2.3
SOURCE=/tmp/aiops-release-${VERSION}
TARGET_BASE=/opt/k8s-aiops-manager
TARGET_RELEASE=${TARGET_BASE}/releases/${VERSION}

sudo mkdir -p "${TARGET_RELEASE}"
sudo rsync -a --delete "${SOURCE}/" "${TARGET_RELEASE}/"

# 可选：校验 checksum
# (cd "${SOURCE}" && sha256sum -c SHA256SUMS)

# 要求 runtime-gateway 可执行
sudo test -x "${TARGET_RELEASE}/runtime-gateway/runtime-gateway"
# 要求 control-api 构建产物存在
sudo test -f "${TARGET_RELEASE}/control-api/dist/src/main.js"

# 原子切换 + 重启服务
sudo ln -sfn "${TARGET_RELEASE}" "${TARGET_BASE}/current"
sudo systemctl daemon-reload
sudo systemctl restart aiops-runtime-gateway.service aiops-control-api.service
```

## 验证

```bash
systemctl status aiops-runtime-gateway.service --no-pager
systemctl status aiops-control-api.service --no-pager
curl -fsS http://127.0.0.1:4100/healthz
curl -fsS http://127.0.0.1:4000/api/capabilities >/dev/null
```

## 回滚

```bash
PREVIOUS_VERSION=1.2.2
sudo ln -sfn /opt/k8s-aiops-manager/releases/${PREVIOUS_VERSION} /opt/k8s-aiops-manager/current
sudo systemctl restart aiops-runtime-gateway.service aiops-control-api.service
```

## 故障排查

- 服务起不来：`journalctl -u aiops-runtime-gateway.service -n 200 --no-pager`
- 配置加载异常：核对 `/etc/k8s-aiops-manager/*.env`
- 升级失败：检查新版本目录完整性、二进制权限与软链指向
