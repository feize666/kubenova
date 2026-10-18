# KubeNova

KubeNova 是一套面向 Kubernetes 的集群运维控制台。它把集群接入、资源管理、资源拓扑、可观测性、访问控制和 AI 运维助手收敛到一个 Web 界面，可直接在浏览器中完成日常巡检与操作。

当前版本：**v1.2**

更新管理支持在 `/settings/update` 原位检查版本和提交升级；页面或操作记录加载失败时提供重试入口。选择版本后，说明与下载资产始终对应同一版本；新版本系列 `v1.2` 不会被误判为旧版本编号迁移。升级前会重新确认目标版本的正式发布资产。

## 核心能力

- **集群接入**：支持阿里云 ACK、腾讯云 TKE、华为云 CCE、AWS EKS、Google GKE、火山引擎 VKE 等主流托管 Kubernetes，上传 kubeconfig 后自动识别供应商与集群状态。
- **资源管理**：覆盖工作负载（Pod、Deployment、StatefulSet、DaemonSet、ReplicaSet、Job、CronJob、弹性伸缩）、网络（Service、Ingress、Endpoint、EndpointSlice、NetworkPolicy、Gateway API）、存储（PV、PVC、StorageClass）、配置（ConfigMap、Secret、ServiceAccount、LimitRange、ResourceQuota）与集群基础资源（Node、Namespace）。清单默认每页 25 条，可切换 10、50、100 条；表体按页面剩余空间滚动，工具栏、表头和分页保持稳定。
- **资源拓扑**：参考 Headlamp 资源全景图重构。以工作负载为起点，按 `Deployment → ReplicaSet → Pod → Service → Endpoint / EndpointSlice → Ingress` 的横向分层访问链路呈现资源关系，列序由节点权重表决定；连线采用单对单居中直线、多分支平滑曲线并沿访问路径从左到右布设，默认实线、异常链路染橙／红、选中链路高亮流动；折叠分组保留成员与关系计数并以叠层卡片区分。点击卡片直接打开资源详情抽屉，点击卡片内名称或详情标题跳转到对应资源列表；点击画布空白、外部区域或关闭抽屉会解除关联高亮，不改变筛选与画布视角；适配视图为顶部浮层预留高度，资源路径与分组标签互不遮挡；折叠卡片的「进入」与面包屑逐级返回均可用；分组切换、展开／收起、搜索与仅异常筛选都在当前工作负载内收敛，不会退出到工作负载选择页。支持资源域多选、命名空间筛选，并将筛选、搜索和分组状态同步到 URL，便于刷新与分享。
- **资源详情**：点击任意资源名称以抽屉形式打开详情，包含概览、YAML、容器列表、关联 Pod 列表、事件与日志／终端入口，详情内的关联资源可继续跳转。YAML 在原抽屉内编辑、校验和预览；CodeMirror 编辑区使用黑底等宽字体与语法高亮，支持行号、折叠、搜索和撤销。Pod 的日志与终端以全屏工作台形式打开，关闭后回到原详情；`/clusters/{id}/logs` 与 `/clusters/{id}/terminal` 均在集群工作区内可直接访问，集群上下文从工作区自动继承。
  关联 Pod 按控制器归属解析，支持 Deployment 经 ReplicaSet、CronJob 经 Job 关联；完整读取分页，不按名称前缀或相同应用标签猜测归属。返回 Pod 列表时重新读取，普通刷新失败保留最近授权快照，权限被拒绝后隐藏旧数据，成功读取才恢复。
- **可观测性中心**：Prometheus 监控、日志中心与观测配置，支持告警接入、通知渠道与自定义模板。
- **访问控制**：用户管理、集群访问授权、细致到命名空间与资源类型的权限范围，支持 MFA 与 OIDC 对接；管理页面按认证上下文中的当前角色控制入口和数据访问。
- **AI 助手**：支持 OpenAI、Azure OpenAI、Anthropic、Gemini、通义千问、火山引擎、DeepSeek、OpenAI 兼容接口与 Ollama，可在对话中查询集群状态并执行受控操作。
- **更新管理**：仅超级管理员可见，读取真实 GitHub Release；支持稳定版本选择、强制检测、对应版本发布说明、执行器与备份状态、任务进度和操作记录。检测暂时失败时保留上次可信发布信息并提示错误，重新确认发布成功后才能升级；配置宿主机执行器后可在线备份、校验、升级、健康检查和失败回滚。

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
| 应用中心 | `/applications` | 暂仅超级管理员可见，其他用户不显示入口且不能直接访问 |
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

登录后的控制台共用右侧工具栏：顶部 AI 头像沿用现有管理员权限，点击原位打开会话面板；底部支持主题切换和侧栏收起，折叠状态在刷新与页面切换后保持。手机端展开时使用遮罩，不挤压资源页面。
AI 会话面板默认桌面尺寸为 620 × 900px（不超过当前屏幕可用区域），四角支持拖拽调整大小，正文与输入区字号为 15px，窄屏自动全屏。

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

### 发布新版本

根目录 `VERSION` 为版本基准（例如 `1.1.0`）；前后端 package.json、package-lock.json 必须同步，发布 tag 支持 `v1.1` 或 `v1.1.0`。推送新的稳定版本标签触发 GitHub Actions：版本与已发布版本不可覆盖检查 → 前后端构建、单元测试、网关测试及发布脚本校验 → Linux x64 打包与三服务 Docker Compose 启动检查 → 发布同版本 GHCR 镜像 → 上传完整资产 → 将草稿 Release 转为正式版本。Release job 会用生成的部署配置实际合并 Compose 文件并启动三服务；通用 CI 分步骤校验初始化、执行器、版本信息、发布打包契约及原子切换，静态检查只依赖 Bash、grep 和 find。分支和 PR 复用同一套 CI，代码变更检查 README 同步。已发布版本不能覆盖，失败的草稿可重试；不自动部署任何生产主机。

正式 Release 包含 `kubenova-ubuntu.tar.gz`、兼容旧更新检测的 `kubenova-ubuntu.tar.gz.sha256`、`metadata.json` 和 `checksums.txt`。元数据记录三个组件版本、完整 Git commit、构建时间及数据库迁移提示；checksums.txt 覆盖发布包和元数据。当前原生包面向 **Ubuntu 24.04 x64，Node.js 22+**；镜像面向 Linux amd64。下载发布包与校验文件到同一目录后执行：

```bash
sha256sum -c kubenova-ubuntu.tar.gz.sha256
```

### 检查与执行升级

control-api 每 5 分钟读取 `feize666/kubenova` 的最新正式 Release，排除草稿/预发布，并要求发布包与校验文件完整。仅当 GitHub latest 接口返回 404 时，从发布列表选择版本号最高的稳定版本；最高版本产物不完整会明确报错，不静默退回旧版本。点击“检查更新”会立即检查并刷新发布历史缓存；鉴权、限流、网络超时均有明确提示。旧版服务需先手动更新至本版本，才能获得这套检测修复。

运行版本从构建环境 `KUBENOVA_VERSION`、发布包元数据或 control-api 的 package 版本读取，不再从可变更新状态文件读取虚拟版本。可通过 `KUBENOVA_UPDATE_REPOSITORY=owner/repo` 指定仓库；默认匿名读取公开 GitHub Release。需要提高限额或访问私有仓库时，可在 control-api 服务端配置只读 `KUBENOVA_UPDATE_GITHUB_TOKEN`：仅发送至 api.github.com，禁止重定向，不下发浏览器。私有发布资产下载仍需操作者具备 GitHub 权限。

网页提供版本检测、发布说明和在线升级入口。在线升级必须配置独立宿主机执行器（不向 control-api 暴露 Docker socket）：Release 必须同时提供压缩包、SHA256 校验文件和 `release-manifest.json`，清单绑定 frontend、control-api、runtime-gateway 三个 GHCR 镜像摘要；执行器先备份 PostgreSQL，再校验清单与发布资产，按摘要切换 Compose 服务，并检查 API、网关和登录页面健康状态。失败时自动回滚应用镜像，数据库不自动回滚。升级任务仅超级管理员可发起，同一时间只能运行一个任务，状态和结果写入审计记录；保留最近三个有备份且镜像摘要完整的回滚候选。未配置执行器时页面保持只读，不会伪造升级成功。

Linux Docker Compose 部署使用初始化和安装脚本接入执行器，无需手工拼接 token 或填写执行器 IP。首次执行初始化时自动生成数据库密码、JWT、Runtime token、网关内部鉴权、AI 凭据加密密钥及初始管理员密码；各密钥独立随机生成并以 `0600` 保存。已有环境文件不会重新生成、覆盖或轮换密钥；旧模板中的占位值需人工补齐。公网域名、AI 厂商 key、外部数据库及 SMTP 凭据仍需按实际环境填写。

```bash
# 在项目/发布包根目录执行；主机需要 Node.js 22+、Docker Compose 和 systemd
node scripts/init-compose-env.mjs
# 检查 deploy/docker/.env 的公网地址与镜像版本，再安装（仅 Linux root）
sudo node scripts/install-update-executor.mjs
# 已有部署必须传实际运行版本，勿把它意外降级到示例版本
sudo bash scripts/compose-release.sh up --tag <当前部署版本>
```

安装脚本自动生成或复用同一个执行器密钥，分别存入 `/etc/kubenova/update-executor.env` 与 `/etc/kubenova/update-client.env`；共享环境文件不存放该特权密钥，Compose 只把客户端密钥文件注入 control-api。发布流水线会解析合并后的 Compose 配置，验证客户端密钥文件只进入 control-api，且执行器 socket 以只读方式挂载。执行器默认监听 `/run/kubenova-update/executor.sock`，不暴露公网端口，也不挂载 Docker socket。部署文件路径自动解析，并保留现有 Compose 项目名，避免误建数据库卷。不要把服务密钥粘贴到前端或提交 Git。

页面只有在执行器实际通过 Docker/Compose 就绪检查后才启用在线升级。API 重启后从执行器恢复任务状态，暂时断连不会伪报任务失败，完成任务也不会修改旧进程的运行版本。任务及数据库备份保存于 `/var/lib/kubenova/update-executor`；大备份流式写入，备份失败不切换服务。发布清单、压缩包和 SHA256 均允许 GitHub 官方下载重定向并逐项校验，失败切换才触发应用镜像回滚，不自动回滚数据库。已完成的任务以排队、执行中、成功或失败分别记录，回滚候选必须重新核验备份和摘要。

此自动接入流程只覆盖 **Linux + Docker Compose + systemd**；macOS 本地源码/launchd 开发、原生二进制及 Kubernetes 部署不会被强制迁移或伪装为已接入。私有仓库的资产下载暂不支持执行器自动鉴权。完整操作与故障检查见 [Docker Compose 部署](deploy/docs/docker-compose.md)。

实际升级前先备份数据库与配置，再使用当前部署方式的脚本：

```bash
# Docker Compose：同一个 tag 更新 frontend、control-api、runtime-gateway
bash scripts/compose-release.sh up --tag v1.2
# 二进制 systemd：将校验后的发布包放入独立版本目录，安装三个服务单元后切换
sudo bash scripts/service.sh prod switch v1.2
```

镜像位于 `ghcr.io/feize666/kubenova-{frontend,control-api,runtime-gateway}:v1.2`。如果 GHCR 包首次创建为私有，部署主机需 `docker login ghcr.io`，或由仓库管理员将三个包设置为公开。不要沿用旧的 `feize1995` 镜像地址。

systemd 切换会同时重启前端、API、网关并检查健康；失败返回非零且尝试恢复旧版本指针。它不自动撤销数据库迁移，也不承诺秒级恢复。完整步骤与旧平铺目录迁移见 [升级与回滚](deploy/docs/upgrade-rollback.md)。

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

cd frontend && RESOURCE_BROWSER_CHANNEL=chromium node --test src/app/authorization/grant-mutations.browser.test.mjs
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
| v1.2 | 在线升级执行器与任务恢复、资源表格与编辑体验增强、拓扑聚合和自适应布局、AI 操作授权与确认流程 |
| v1.8 | 资源拓扑按 Headlamp 全景图重构（ELK 分层布局、贝塞尔链路、列序修正、紧凑选中信息条、可进入折叠卡与逐级面包屑），Pod 日志／终端全屏工作台接入集群工作区 |
| v1.7 | 统一筛选控件、Headlamp 风格资源详情页、AI 助手与实时工作台 |
| v1.6 | 企业控制台版本，统一 UI、OIDC 与细粒度授权 |
| v1.5 | 可观测性与运行时工作台完善 |
| v1.4 | 资源操作基线 |
| v1.3 | 资源详情与拓扑能力增强 |
| v1.2 | 品牌图标与界面一致性 |
| v1.1 | 拓扑与运维能力刷新 |
