# DEB/RPM Packaging

该目录提供统一的 `nfpm` 打包定义，用于产出 Linux `.deb` / `.rpm` 安装包。

## 文件说明

- `nfpm.yaml`: 包元数据、文件映射、生命周期脚本入口
- `scripts/postinstall.sh`: 安装后执行 `systemctl daemon-reload` / 启用 target
- `scripts/preremove.sh`: 卸载前停止服务并 reload systemd

## 前置条件

1. 已安装 `nfpm`
2. 已生成 runtime-gateway 二进制（`.release/runtime-gateway`）

## 构建命令

```bash
PKG_VERSION=1.0.0
PKG_ARCH=amd64
mkdir -p .release/packages

nfpm package --config deploy/packages/nfpm.yaml --packager deb \
  --target .release/packages/aiops-manager_${PKG_VERSION}_${PKG_ARCH}.deb
nfpm package --config deploy/packages/nfpm.yaml --packager rpm \
  --target .release/packages/aiops-manager-${PKG_VERSION}-1.${PKG_ARCH}.rpm
```

输出默认位于：`.release/packages/`

## 打包内容

- `/opt/k8s-aiops-manager/current/runtime-gateway/runtime-gateway`
- `/usr/lib/systemd/system/aiops-runtime-gateway.service`
- `/usr/lib/systemd/system/aiops-control-api.service`
- `/usr/lib/systemd/system/aiops.target`
- `/opt/k8s-aiops-manager/current/env/*.env.example`

## 生命周期 Hook

- `postinstall`:
  - `systemctl daemon-reload`
  - 尝试 `systemctl enable aiops.target`
- `preremove`:
  - 停止 `aiops-runtime-gateway.service`
  - 停止 `aiops-control-api.service`
  - `systemctl daemon-reload`

脚本均对非 systemd 环境做兼容处理（命令不存在则跳过）。
