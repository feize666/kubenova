# KubeNova

KubeNova 是一套面向 Kubernetes 的集群运维控制台。它把集群接入、资源管理、资源拓扑、可观测性、访问控制和 AI 运维助手收敛到一个 Web 界面，可直接在浏览器中完成日常巡检与操作。

当前版本：**v1.7**

## 核心能力

- **集群接入**：支持阿里云 ACK、腾讯云 TKE、华为云 CCE、AWS EKS、Google GKE、火山引擎 VKE 等主流托管 Kubernetes，上传 kubeconfig 后自动识别供应商与集群状态。
- **资源管理**：覆盖工作负载（Pod、Deployment、StatefulSet、DaemonSet、ReplicaSet、Job、CronJob、弹性伸缩）、网络（Service、Ingress、Endpoint、EndpointSlice、NetworkPolicy、Gateway API）、存储（PV、PVC、StorageClass）、配置（ConfigMap、Secret、ServiceAccount、LimitRange、ResourceQuota）与集群基础资源（Node、Namespace）。
- **资源拓扑**：以工作负载为起点，按 `Deployment → ReplicaSet → Pod → Service → Endpoint / EndpointSlice → Ingress` 的访问链路呈现资源关系，支持多域切换、命名空间筛选与链路状态标记。
- **资源详情**：点击任意资源名称以抽屉形式打开详情，包含概览、YAML、容器列表、关联 Pod 列表、事件与日志／终端入口，详情内的关联资源可继续跳转。
- **可观测性中心**：Prometheus 监控、日志中心与观测配置，支持告警接入、通知渠道与自定义模板。
- **访问控制**：用户管理、集群访问授权、细致到命名空间与资源类型的权限范围，支持 MFA 与 OIDC 对接。
- **AI 助手**：支持 OpenAI、Azure OpenAI、Anthropic、Gemini、通义千问、火山引擎、DeepSeek、OpenAI 兼容接口与 Ollama，可在对话中查询集群状态并执行受控操作。
- **更新管理**：内置版本检测，从 GitHub 读取最新版本并在通知中心与系统设置提示可用升级。

## 架构

```mermaid
flowchart LR
  U[浏览器] -->|3000| F[frontend]
  F -->|/api 反向代理| A[control-api :4000]
  F <-->|/ws WebSocket| G[runtime-gateway :4100]
  A --> P[(PostgreSQL)]
  A --> R[(Redis)]
  G --> K[(Kubernetes 集群)]
  A --> K
```

| 模块 | 目录 | 技术栈 | 端口 |
| --- | --- | --- | --- |
| 前端控制台 | `frontend` | Next.js 16、React 19、Ant Design 6、TanStack Query | 3000 |
| 控制面 API | `backend/control-api` | NestJS 11、Prisma 6、PostgreSQL、Redis | 4000 |
| 实时网关 | `backend/runtime-gateway` | Go 1.25、client-go、WebSocket | 4100 |
| 运维脚本 | `scripts`、`deploy` | Bash、systemd、Docker Compose、Kustomize | — |

前端通过 Next.js 的 `rewrites` 把 `/api` 与 `/ws` 反代到后端，浏览器只需访问前端端口，无需感知后端地址。

## 功能布局

登录后首页为平台级导航，进入某个集群后切换到该集群的工作区导航。

**平台首页**

| 菜单 | 路径 | 说明 |
| --- | --- | --- |
| 概览 | `/` | 集群总览与关键指标 |
| 集群 | `/clusters` | 集群列表，点击进入对应集群工作区 |
| 访问控制 | `/authorization` | 用户管理、集群访问授权 |
| 应用中心 | `/applications` | 应用与 Helm 能力 |
| 系统设置 | `/settings` | 更新管理、AI 助手配置、备份与恢复 |

**集群工作区**（`/clusters/{clusterId}/...`）

| 分组 | 内容 |
| --- | --- |
| 集群信息 | 集群基本信息和指标 |
| 资源拓扑 | 资源关系拓扑图 |
| 基础资源 | Node、Namespace |
| 工作负载 | Deployment、StatefulSet、DaemonSet、Pod、Job、CronJob、弹性伸缩 |
| 网络 | Service、Ingress、Endpoint、EndpointSlice、NetworkPolicy、Gateway API |
| 存储 | PersistentVolume、PersistentVolumeClaim、StorageClass |
| 配置 | ConfigMap、Secret、ServiceAccount、LimitRange、ResourceQuota |
| 可观测性中心 | Prometheus 监控、日志中心、观测配置 |
| 运维能力 | 资源巡检、AI 助手 |

## 快速开始（本地）

### 先决条件

- Node.js 20 或更高版本，且 `node`、`npm`、`npx` 来自同一目录
- Go 1.25（仅在需要构建或运行 runtime-gateway 时）
- PostgreSQL 14+ 与 Redis 6+

macOS 本地安装依赖：

```bash
brew install postgresql@16 redis go
brew services start postgresql@16
brew services start redis
```

Ubuntu 本地安装依赖：

```bash
sudo apt-get update
sudo apt-get install -y postgresql redis-server
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 启动

```bash
bash scripts/service.sh install-deps
bash scripts/service.sh db-init
bash scripts/service.sh dev up
```

启动后访问 `http://127.0.0.1:3000`。

首次启动会自动创建管理员账号，默认凭据：

```text
admin@local.dev / admin123456
```

生产环境务必在环境文件中修改 `DEFAULT_ADMIN_PASSWORD`。

### 本地服务管理

```bash
bash scripts/service.sh dev status
bash scripts/service.sh dev logs [frontend|control-api|runtime-gateway]
bash scripts/service.sh dev restart [frontend|control-api|runtime-gateway|all]
bash scripts/service.sh dev down [frontend|control-api|runtime-gateway|all]
```

`dev up` 默认以 stable 模式启动前端（预构建产物），避免 Next dev 首次访问各模块时按需编译造成的内存占用与菜单切换卡顿。需要热更新时：

```bash
bash scripts/service.sh dev up --dev-frontend
```

## 部署

三种交付方式，按环境选择：

| 方式 | 适用场景 | 文档 |
| --- | --- | --- |
| 二进制 + systemd | 单台 Ubuntu 主机直装 | [deploy/docs/binary-systemd.md](deploy/docs/binary-systemd.md) |
| Docker Compose | 容器化编排，含 PostgreSQL 与 Redis | [deploy/docs/docker-compose.md](deploy/docs/docker-compose.md) |
| Kubernetes | 已有集群，用 Kustomize 部署 | [deploy/docs/k8s-kustomize.md](deploy/docs/k8s-kustomize.md) |

### 二进制发布包（推荐）

```bash
bash scripts/service.sh package release

sudo mkdir -p /opt/kubenova/current
sudo tar -xzf tmp/release/kubenova-ubuntu.tar.gz -C /opt/kubenova/current --strip-components=1

sudo mkdir -p /etc/kubenova
sudo bash scripts/service.sh prod install
sudo vi /etc/kubenova/control-api.env
sudo vi /etc/kubenova/runtime-gateway.env
sudo bash scripts/service.sh prod up
```

生产环境至少确认这些配置：

```bash
DATABASE_URL=postgresql://kubenova:change-me@127.0.0.1:5432/k8s_aiops
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=replace-with-long-random-secret
RUNTIME_TOKEN_SECRET=replace-with-runtime-token-secret
DEFAULT_ADMIN_EMAIL=admin@local.dev
DEFAULT_ADMIN_PASSWORD=change-me-now
AI_CREDENTIAL_ENCRYPTION_KEY=replace-with-32-char-random-secret
```

`AI_CREDENTIAL_ENCRYPTION_KEY` 用于加密存储 AI 厂商密钥，生产环境必须设置且保持稳定，否则已保存的密钥将无法解密。

### 生产服务管理

```bash
sudo bash scripts/service.sh prod status
sudo bash scripts/service.sh prod logs
sudo bash scripts/service.sh prod restart
sudo bash scripts/service.sh prod switch <version>
sudo bash scripts/service.sh prod rollback <version>
```

## 更新机制

control-api 每 5 分钟读取一次 GitHub 仓库 `feize666/kubenova` 的最新版本，优先取 GitHub Releases，没有 Release 时回退到最新 tag。检测到新版本后会在通知中心和系统设置的更新管理页面提示。

运行版本来自发布包元数据，可通过环境变量调整检查行为：

```bash
KUBENOVA_UPDATE_REPOSITORY=owner/repo
UPDATE_CHECK_INTERVAL_MS=300000
```

升级与回滚流程见 [deploy/docs/upgrade-rollback.md](deploy/docs/upgrade-rollback.md)。

## 项目结构

```text
kubenova/
├── frontend/                     # Next.js 控制台
│   └── src/
│       ├── app/                  # 路由与页面
│       ├── components/           # 通用组件、详情抽屉、拓扑渲染
│       ├── config/navigation.ts  # 导航结构定义
│       └── lib/                  # API 客户端与工具
├── backend/
│   ├── control-api/              # NestJS 控制面
│   │   ├── prisma/               # 数据模型与迁移
│   │   └── src/                  # 业务模块
│   └── runtime-gateway/          # Go 实时网关
├── scripts/                      # 统一运维脚本
├── deploy/                       # systemd / Docker / K8s 部署资产
├── docs/                         # 设计与实施文档
└── k8s/                          # Kubernetes 清单
```

## 质量检查

```bash
cd frontend && npm run lint
cd frontend && npx tsc --noEmit
cd frontend && npm run build

cd backend/control-api && npm test -- --runInBand --passWithNoTests
cd backend/control-api && npm run build

cd backend/runtime-gateway && go test ./...

bash scripts/service.sh test topology
bash scripts/service.sh test release
```

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/ops-console-usage.md](docs/ops-console-usage.md) | 运维控制台使用手册 |
| [docs/runtime.md](docs/runtime.md) | 运行模式与日志规划 |
| [docs/deployment-build-redesign.md](docs/deployment-build-redesign.md) | 构建与部署设计 |
| [docs/ops-console-docker-compose.md](docs/ops-console-docker-compose.md) | Docker Compose 部署 |
| [docs/ops-console-kubernetes-deployment.md](docs/ops-console-kubernetes-deployment.md) | Kubernetes 部署 |
| [docs/ops-console-binary-deployment.md](docs/ops-console-binary-deployment.md) | 二进制部署 |
| [deploy/docs/linux-quick-start.md](deploy/docs/linux-quick-start.md) | Linux 快速开始 |
| [deploy/docs/upgrade-rollback.md](deploy/docs/upgrade-rollback.md) | 升级与回滚 |
| [deploy/docs/backup-restore.md](deploy/docs/backup-restore.md) | 备份与恢复 |
| [deploy/docs/keycloak-integration.md](deploy/docs/keycloak-integration.md) | Keycloak / OIDC 对接 |
| [docs/kubenova-regression-matrix.md](docs/kubenova-regression-matrix.md) | 回归测试矩阵 |

## 版本历史

| 版本 | 主要内容 |
| --- | --- |
| v1.7 | 统一筛选控件、Headlamp 风格资源详情页、AI 助手与实时工作台 |
| v1.6 | 企业控制台版本，统一 UI、OIDC 与细粒度授权 |
| v1.5 | 可观测性与运行时工作台完善 |
| v1.4 | 资源操作基线 |
| v1.3 | 资源详情与拓扑能力增强 |
| v1.2 | 品牌图标与界面一致性 |
| v1.1 | 拓扑与运维能力刷新 |
