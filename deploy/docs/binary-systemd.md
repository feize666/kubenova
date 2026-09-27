# Binary + systemd

## 适用范围

v1.1 的原生包在 Ubuntu 24.04 x64 构建，宿主机需 Node.js 22+、PostgreSQL、Redis、systemd。不能用 macOS 的 node_modules 打包后直接部署 Linux。

## 首次安装

先从正式 GitHub Release 下载发布包和 SHA256 文件，校验通过后再解压。以下示例只适用于 /opt/kubenova/current 尚不存在的首次安装；已部署实例按升级文档操作。

```bash
sha256sum -c kubenova-ubuntu.tar.gz.sha256
sudo mkdir -p /opt/kubenova/releases/v1.1
sudo tar -xzf kubenova-ubuntu.tar.gz -C /opt/kubenova/releases/v1.1 --strip-components=1
sudo ln -s /opt/kubenova/releases/v1.1 /opt/kubenova/current
cd /opt/kubenova/current
sudo bash scripts/prod.sh install
sudo vi /etc/kubenova/control-api.env
sudo vi /etc/kubenova/runtime-gateway.env
sudo systemctl start kubenova.target
```

部署包已包含 Prisma CLI 和迁移；control-api 启动前执行 migrate deploy。三个单元为 kubenova-frontend、kubenova-control-api、kubenova-runtime-gateway。前端默认 3000，API 4000，网关 4100。

必需配置：DATABASE_URL、REDIS_URL、JWT_SECRET、RUNTIME_TOKEN_SECRET、RUNTIME_GATEWAY_INTERNAL_SECRET、AI_CREDENTIAL_ENCRYPTION_KEY、DEFAULT_ADMIN_PASSWORD。请替换所有示例密码；已有实例必须保留原加密密钥。前端如需改端口可创建 /etc/kubenova/frontend.env 设置 PORT。

## 验证

```bash
systemctl status kubenova-frontend kubenova-control-api kubenova-runtime-gateway --no-pager
curl -fsS http://127.0.0.1:3000/login >/dev/null
curl -fsS http://127.0.0.1:4000/api/health/ready
curl -fsS http://127.0.0.1:4100/healthz
```

进程就绪不等于所有集群可访问；还需登录验证资源列表、权限与日志/终端。失败时查看对应单元的 journalctl，不要通过修改版本状态文件宣称升级完成。

升级、旧安装目录迁移和回滚见 [升级与回滚](upgrade-rollback.md)。
