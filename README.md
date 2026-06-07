# KubeNova

Kubernetes 集群 AI 运维管理平台。

面向多集群场景，提供集群接入、工作负载、网络、存储、配置、监控与实时联动能力。

## 平台介绍

这是一套 Kubernetes 运维管理平台，主要用于把集群、工作负载、网络资源和存储资源统一纳管，并通过控制面 API 与实时网关连接集群侧能力。

## 运行模式

项目提供三种常用运行方式：

- 开发：`bash scripts/dev-up.sh`
- 演示：`FRONTEND_BOOT_MODE=stable bash scripts/dev-up.sh`
- 生产：`bash scripts/prod-up.sh`

说明见 [运行模式与日志规划](docs/runtime.md)。

### 核心能力

- 多集群接入与管理
- 工作负载管理：Deployment / StatefulSet / DaemonSet / Job / CronJob
- 网络资源管理：Service / Ingress
- 存储资源管理：PV / PVC
- 配置资源管理：ConfigMap / Secret
- 监控与告警视图
- 实时操作联动：日志、执行、端口转发等能力

### 适用场景

- 运维团队统一管理多个 Kubernetes 集群
- 需要在同一平台查看和操作工作负载、网络、存储、配置资源
- 需要在 Linux 主机上通过 `systemd` 或发布目录方式部署
- 需要在内网或自建环境中长期运行

### 架构概览

```mermaid
flowchart LR
  U[浏览器] --> F[frontend]
  F --> A[control-api]
  F <--> G[runtime-gateway]
  A --> P[(PostgreSQL)]
  A --> R[(Redis)]
  G --> K[(Kubernetes Cluster)]
```

- `frontend`：管理控制台
- `control-api`：认证、业务 API、数据库访问
- `runtime-gateway`：集群实时网关
- `PostgreSQL`：业务数据存储
- `Redis`：缓存与队列

### 技术栈与框架

项目按前端控制台、控制面 API、运行时网关和部署工程分层组织，核心技术栈如下：

| 层级 | 目录 | 技术栈 / 框架 | 主要用途 |
| --- | --- | --- | --- |
| 前端控制台 | `frontend` | Next.js 16、React 19、TypeScript、Ant Design 6、TanStack Query、TanStack Table | 管理控制台、资源列表、表单操作、主题与会话状态 |
| 前端可视化与实时交互 | `frontend` | ECharts、Chart.js、React Flow、xterm.js、Socket.IO Client | 监控图表、拓扑/流程视图、终端和日志实时交互 |
| 控制面 API | `backend/control-api` | Node.js、NestJS 11、TypeScript、Prisma 6、Swagger、class-validator、Zod | 认证、用户、集群、资源、监控、AIOps、AI 助手等业务 API |
| 数据访问与异步能力 | `backend/control-api` | PostgreSQL、Redis、BullMQ、ioredis | 业务数据持久化、缓存、队列和后台任务 |
| Kubernetes 集成 | `backend/control-api`、`backend/runtime-gateway` | `@kubernetes/client-node`、`client-go` | 集群资源同步、健康探测、日志、执行、实时流能力 |
| 运行时网关 | `backend/runtime-gateway` | Go 1.25.0、go-chi、gorilla/websocket、Kubernetes client-go | WebSocket 网关、终端/日志流、健康检查、静态资源回退 |
| AI 能力 | `backend/control-api` | OpenAI `chat/completions` 兼容接口、自定义模型配置 | AI 助手、ChatOps 会话、智能诊断和可执行建议 |
| 测试与质量 | `frontend`、`backend/control-api`、`backend/runtime-gateway` | ESLint、Jest、ts-jest、Go test、Playwright 脚本 | 静态检查、单元测试、接口/页面回归验证 |
| 部署与交付 | `deploy`、`scripts` | Ubuntu、systemd、Shell | 本地开发、Ubuntu 二进制发布、生产启动、回滚和卸载 |

运行时基础依赖：

- Node.js 20：构建和运行 `frontend`、`backend/control-api`
- Go 1.25.0：构建和运行 `backend/runtime-gateway`
- PostgreSQL 16：控制面主数据库
- Redis 7：缓存、队列和运行时协作
- Kubernetes 集群：被纳管的业务集群

## Ubuntu 部署

README 只保留 Ubuntu 二进制部署方式。生产环境建议一台 Ubuntu 22.04/24.04 主机运行前端、控制面 API、实时网关、PostgreSQL 和 Redis。

### 1. 安装依赖

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
node -v
npm -v
go version
psql --version
redis-cli --version
```

### 2. 初始化数据库

按需调整密码，必须和 `/etc/k8s-aiops-manager/control-api.env` 中的 `DATABASE_URL` 保持一致。

```bash
sudo -u postgres psql <<'SQL'
CREATE USER aiops WITH PASSWORD 'change-me';
CREATE DATABASE aiops OWNER aiops;
SQL
```

### 3. 编译打包

在项目根目录执行：

```bash
bash scripts/package-release.sh
```

产物位置：

```text
tmp/release/k8s-aiops-manager-ubuntu.tar.gz
```

### 4. 安装发布包

```bash
sudo mkdir -p /opt/k8s-aiops-manager/current
sudo tar -xzf tmp/release/k8s-aiops-manager-ubuntu.tar.gz \
  -C /opt/k8s-aiops-manager/current \
  --strip-components=1
sudo mkdir -p /etc/k8s-aiops-manager
sudo bash scripts/service.sh prod install
```

### 5. 配置环境

编辑：

```bash
sudo vi /etc/k8s-aiops-manager/control-api.env
sudo vi /etc/k8s-aiops-manager/runtime-gateway.env
```

最少需要确认这些值：

```bash
DATABASE_URL=postgresql://aiops:change-me@127.0.0.1:5432/aiops
REDIS_URL=redis://127.0.0.1:6379/0
JWT_SECRET=replace-with-long-random-jwt-secret
RUNTIME_TOKEN_SECRET=replace-with-runtime-token-secret
RUNTIME_GATEWAY_INTERNAL_SECRET=replace-with-internal-shared-secret
DEFAULT_ADMIN_EMAIL=admin@local.dev
DEFAULT_ADMIN_PASSWORD=change-me-now
```

### 6. 启动

```bash
sudo bash scripts/service.sh prod up
```

### 7. 验证

```bash
sudo bash scripts/service.sh prod status
curl -fsS http://127.0.0.1:3000/ >/dev/null
curl -fsS http://127.0.0.1:4000/api/capabilities >/dev/null
curl -fsS http://127.0.0.1:4100/healthz
```

浏览器访问：

```text
http://<服务器IP>:3000
```

### 8. 停止和卸载

```bash
sudo bash scripts/service.sh prod down
sudo bash scripts/service.sh prod uninstall
```

## Ubuntu 发布目录

```text
/opt/k8s-aiops-manager/current
/etc/k8s-aiops-manager/control-api.env
/etc/k8s-aiops-manager/runtime-gateway.env
```

## 更多说明

- [Ubuntu 部署与打包设计](docs/deployment-build-redesign.md)
