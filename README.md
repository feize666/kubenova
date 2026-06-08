# KubeNova

KubeNova 是一个面向 Kubernetes 多集群场景的 AI 运维管理平台。

它把集群接入、工作负载、网络、存储、配置、监控、KubeNova 智能分析和实时操作集中到一个 Web 控制台中，适合在内网或自建 Ubuntu 主机上长期运行。

## 功能概览

- 多集群接入与集群状态管理
- 工作负载管理：Deployment、StatefulSet、DaemonSet、Job、CronJob、Pod
- 网络资源管理：Service、Ingress、IngressRoute、NetworkPolicy、Gateway API
- 存储与配置管理：PV、PVC、StorageClass、ConfigMap、Secret、ServiceAccount
- 可观测性视图：集群健康、事件、告警、巡检、资源关系
- KubeNova 智能运维中台：异常概览、事故队列、根因候选、推荐动作、审批和审计
- 实时操作：日志、终端、端口转发、WebSocket 网关
- AI 助手：兼容 OpenAI `chat/completions` 风格接口

## 架构

```mermaid
flowchart LR
  U[浏览器] --> F[frontend]
  F --> A[control-api]
  F <--> G[runtime-gateway]
  A --> P[(PostgreSQL)]
  A --> R[(Redis)]
  G --> K[(Kubernetes Cluster)]
```

| 模块 | 目录 | 说明 |
| --- | --- | --- |
| 前端控制台 | `frontend` | Next.js 16、React 19、Ant Design 6 |
| 控制面 API | `backend/control-api` | NestJS、Prisma、PostgreSQL、Redis |
| 实时网关 | `backend/runtime-gateway` | Go、WebSocket、Kubernetes client-go |
| 部署脚本 | `scripts`、`deploy/systemd` | Ubuntu、systemd、二进制发布包 |

## 快速部署

当前 README 只保留 Ubuntu 二进制部署方式。目标主机建议使用 Ubuntu 22.04 或 24.04。

### 1. 安装依赖

```bash
sudo apt-get update
sudo apt-get install -y bash curl tar gzip psmisc postgresql postgresql-client redis-server redis-tools

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
helm version --short

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

密码需要和后续 `DATABASE_URL` 保持一致。

```bash
sudo -u postgres psql <<'SQL'
CREATE USER kubenova WITH PASSWORD 'change-me';
CREATE DATABASE kubenova OWNER kubenova;
SQL
```

### 3. 编译打包

在项目根目录执行：

```bash
bash scripts/package-release.sh
```

输出：

```text
tmp/release/kubenova-ubuntu.tar.gz
tmp/release/metadata.json
```

### 4. 安装发布包

```bash
sudo mkdir -p /opt/kubenova/current
sudo tar -xzf tmp/release/kubenova-ubuntu.tar.gz \
  -C /opt/kubenova/current \
  --strip-components=1

sudo mkdir -p /etc/kubenova
sudo bash scripts/service.sh prod install
```

### 5. 配置环境

编辑环境文件：

```bash
sudo vi /etc/kubenova/control-api.env
sudo vi /etc/kubenova/runtime-gateway.env
```

至少确认这些值：

```bash
DATABASE_URL=postgresql://kubenova:change-me@127.0.0.1:5432/kubenova
REDIS_URL=redis://127.0.0.1:6379/0
JWT_SECRET=replace-with-long-random-jwt-secret
RUNTIME_TOKEN_SECRET=replace-with-runtime-token-secret
RUNTIME_GATEWAY_INTERNAL_SECRET=replace-with-internal-shared-secret
DEFAULT_ADMIN_EMAIL=admin@local.dev
DEFAULT_ADMIN_PASSWORD=change-me-now
AI_MODEL_BASE_URL=https://api.openai.com/v1
AI_MODEL_API_KEY=
AI_MODEL_NAME=gpt-4o-mini
```

Helm 仓库管理依赖 control-api 运行环境里的 `helm` 命令。若需要自动导入宿主 `helm repo list`，可在 `/etc/kubenova/control-api.env` 配置：

```bash
KUBENOVA_HELM_REPOSITORY_CONFIGS=/root/.config/helm/repositories.yaml:/etc/kubenova/helm/repositories.yaml
```

### 6. 启动

```bash
sudo bash scripts/service.sh prod up
```

### 7. 验证访问

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

## 运维命令

```bash
sudo bash scripts/service.sh prod status
sudo bash scripts/service.sh prod logs
sudo bash scripts/service.sh prod restart
sudo bash scripts/service.sh prod down
sudo bash scripts/service.sh prod uninstall
```

## 本地开发

```bash
bash scripts/service.sh install-deps
bash scripts/service.sh db-init
bash scripts/service.sh dev up
```

常用入口：

```bash
bash scripts/service.sh dev status
bash scripts/service.sh dev logs
bash scripts/service.sh dev down
```

## 质量检查

```bash
cd frontend && npm run lint -- --max-warnings=0
cd frontend && npx tsc --noEmit --pretty false --incremental false
cd frontend && npm run build

cd backend/control-api && npm test -- --runInBand --passWithNoTests
cd backend/control-api && npm run build

cd backend/runtime-gateway && go test ./...
git diff --check
```

## 发布目录

```text
/opt/kubenova/current
/etc/kubenova/control-api.env
/etc/kubenova/runtime-gateway.env
```

## 文档

- [Ubuntu 部署与打包设计](docs/deployment-build-redesign.md)
- [运行模式与日志规划](docs/runtime.md)
