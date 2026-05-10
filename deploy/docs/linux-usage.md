# Linux 使用说明

这份说明给两类场景用：

- 开发机本地启动
- Linux 正式环境发布

## 1. 先决条件

Linux 主机至少要有这些依赖：

- `bash`
- `node` / `npm`
- `go`
- `psql`
- `redis-cli`
- `curl`
- `fuser`

还要准备好：

- PostgreSQL
- Redis
- 项目环境文件

### 1.1 依赖安装命令

#### Node.js / npm

适用系统：`RHEL / Rocky / Alma / CentOS / Kylin`

##### yum 安装
```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs
```

##### 验证
```bash
node -v
npm -v
```

适用系统：`Debian / Ubuntu`

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

验证：
```bash
node -v
npm -v
```

##### 二进制安装
```bash
NODE_VERSION=20.17.0
curl -fsSLO https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz
sudo mkdir -p /usr/local/lib/nodejs
sudo tar -xJf node-v${NODE_VERSION}-linux-x64.tar.xz -C /usr/local/lib/nodejs
export PATH=/usr/local/lib/nodejs/node-v${NODE_VERSION}-linux-x64/bin:$PATH
```

##### 验证
```bash
node -v
npm -v
```

#### Go

适用系统：`RHEL / Rocky / Alma / CentOS / Kylin`

##### yum 安装
```bash
sudo yum install -y golang
```

##### 验证
```bash
go version
```

适用系统：`Debian / Ubuntu`

```bash
GO_VERSION=1.22.5
curl -fsSLO https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz
export PATH=/usr/local/go/bin:$PATH
```

验证：
```bash
go version
```

##### 二进制安装
```bash
GO_VERSION=1.22.5
curl -fsSLO https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz
export PATH=/usr/local/go/bin:$PATH
```

##### 验证
```bash
go version
```

#### PostgreSQL

适用系统：`RHEL / Rocky / Alma / CentOS / Kylin`

##### yum 安装
```bash
sudo yum install -y postgresql-server postgresql
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql
```

##### 验证
```bash
psql --version
```

适用系统：`Debian / Ubuntu`

```bash
sudo apt-get install -y postgresql postgresql-client
sudo systemctl enable --now postgresql
```

验证：
```bash
psql --version
```

##### 二进制安装（官方源码编译到固定前缀）
```bash
PG_VERSION=16.4
sudo yum install -y gcc make readline-devel zlib-devel openssl-devel
curl -fsSLO https://ftp.postgresql.org/pub/source/v${PG_VERSION}/postgresql-${PG_VERSION}.tar.gz
tar -xzf postgresql-${PG_VERSION}.tar.gz
cd postgresql-${PG_VERSION}
./configure --prefix=/usr/local/pgsql
make -j"$(nproc)"
sudo make install
```

##### 验证
```bash
/usr/local/pgsql/bin/postgres --version
```

#### Redis

适用系统：`RHEL / Rocky / Alma / CentOS / Kylin`

##### yum 安装
```bash
sudo yum install -y redis
sudo systemctl enable --now redis
```

##### 验证
```bash
redis-cli --version
```

适用系统：`Debian / Ubuntu`

```bash
sudo apt-get install -y redis-server redis-tools
sudo systemctl enable --now redis-server
```

验证：
```bash
redis-cli --version
```

##### 二进制安装
```bash
REDIS_VERSION=7.2.5
curl -fsSLO https://download.redis.io/releases/redis-${REDIS_VERSION}.tar.gz
tar -xzf redis-${REDIS_VERSION}.tar.gz
cd redis-${REDIS_VERSION}
make
sudo make install
```

##### 验证
```bash
redis-server --version
```

## 2. 开发机启动

### 2.1 安装依赖

```bash
bash scripts/install-deps.sh
```

### 2.2 初始化数据库

```bash
bash scripts/db-init.sh
```

### 2.3 启动服务

```bash
bash scripts/dev-up.sh
```

启动后会看到：

- 前端：`http://localhost:3000`
- control-api：`http://localhost:4000`
- runtime-gateway：`ws://localhost:4100`

### 2.4 查看状态

```bash
bash scripts/dev-status.sh
```

### 2.5 停止服务

```bash
bash scripts/dev-down.sh
```

## 3. 正式环境启动

正式环境按发布目录跑，不直接依赖源码树。

### 3.1 安装 systemd 和环境模板

```bash
bash scripts/prod-install.sh
```

### 3.2 启动正式环境

```bash
bash scripts/prod-up.sh
```

### 3.3 查看状态

```bash
bash scripts/prod-status.sh
```

### 3.4 切换版本

```bash
bash scripts/prod-switch.sh 1.1.0
```

### 3.5 回滚版本

```bash
bash scripts/prod-rollback.sh 1.0.0
```

### 3.6 停止正式环境

```bash
bash scripts/prod-down.sh
```

### 3.7 卸载 systemd 和环境模板

```bash
bash scripts/prod-uninstall.sh
```

## 4. 发布目录

正式环境默认看这类目录：

```text
/opt/k8s-aiops-manager/
  current -> /opt/k8s-aiops-manager/releases/<version>
  releases/<version>/
/etc/k8s-aiops-manager/*.env
```

`current` 是唯一建议给 systemd 读的路径。

## 5. 常用检查

```bash
curl -fsS http://127.0.0.1:3000/ >/dev/null
curl -fsS http://127.0.0.1:4000/api/capabilities >/dev/null
curl -fsS http://127.0.0.1:4100/healthz
```

如果页面打不开，先看：

1. `bash scripts/dev-status.sh` 或 `bash scripts/prod-status.sh`
2. `tail -n 200 .run/logs/frontend.log`
3. `tail -n 200 .run/logs/control-api.log`
4. `tail -n 200 .run/logs/runtime-gateway.log`

## 6. 常见问题

- 端口拒绝连接：先确认服务是否还在运行。
- 页面白屏：先看前端日志里有没有构建失败或 chunk 404。
- 登录失败：先看 `control-api` 状态和后端日志。
- 实时页面没数据：先看 `runtime-gateway` 状态和 `/healthz`。
