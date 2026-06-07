# Ubuntu 部署与打包

## 范围

只保留 Ubuntu 二进制部署方式。

目标主机：

- Ubuntu 22.04 or 24.04
- systemd
- Node.js 20
- Go 1.25.0
- PostgreSQL
- Redis

## 编译打包

在项目根目录执行：

```bash
bash scripts/package-release.sh
```

主要产物：

```text
tmp/release/k8s-aiops-manager-ubuntu.tar.gz
```

脚本内部步骤：

1. `frontend`: `npm ci` + `npm run build:stable`
2. `backend/control-api`: `npm ci` + `npx prisma generate` + `npm run build`
3. `backend/runtime-gateway`: 编译 Linux amd64 Go 二进制
4. 打包为一个 Ubuntu 发布 tarball

## 安装依赖

```bash
sudo apt-get update
sudo apt-get install -y bash curl tar gzip psmisc postgresql postgresql-client redis-server redis-tools
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

GO_VERSION=1.25.0
curl -fsSLO https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz
echo 'export PATH=/usr/local/go/bin:$PATH' | sudo tee /etc/profile.d/go.sh
export PATH=/usr/local/go/bin:$PATH

sudo systemctl enable --now postgresql redis-server
```

## 初始化数据库

```bash
sudo -u postgres psql <<'SQL'
CREATE USER aiops WITH PASSWORD 'change-me';
CREATE DATABASE aiops OWNER aiops;
SQL
```

## 安装发布包

```bash
sudo mkdir -p /opt/k8s-aiops-manager/current
sudo tar -xzf tmp/release/k8s-aiops-manager-ubuntu.tar.gz \
  -C /opt/k8s-aiops-manager/current \
  --strip-components=1
sudo mkdir -p /etc/k8s-aiops-manager
sudo bash scripts/service.sh prod install
```

## 配置

```bash
sudo vi /etc/k8s-aiops-manager/control-api.env
sudo vi /etc/k8s-aiops-manager/runtime-gateway.env
```

最少确认：

```bash
DATABASE_URL=postgresql://aiops:change-me@127.0.0.1:5432/aiops
REDIS_URL=redis://127.0.0.1:6379/0
JWT_SECRET=replace-with-long-random-jwt-secret
RUNTIME_TOKEN_SECRET=replace-with-runtime-token-secret
RUNTIME_GATEWAY_INTERNAL_SECRET=replace-with-internal-shared-secret
DEFAULT_ADMIN_EMAIL=admin@local.dev
DEFAULT_ADMIN_PASSWORD=change-me-now
```

## 启动

```bash
sudo bash scripts/service.sh prod up
```

## 验证

```bash
sudo bash scripts/service.sh prod status
curl -fsS http://127.0.0.1:3000/ >/dev/null
curl -fsS http://127.0.0.1:4000/api/capabilities >/dev/null
curl -fsS http://127.0.0.1:4100/healthz
```

浏览器访问：

```text
http://<server-ip>:3000
```

## 运维命令

```bash
sudo bash scripts/service.sh prod logs
sudo bash scripts/service.sh prod down
sudo bash scripts/service.sh prod uninstall
```

## 路径

```text
/opt/k8s-aiops-manager/current
/etc/k8s-aiops-manager/control-api.env
/etc/k8s-aiops-manager/runtime-gateway.env
```
