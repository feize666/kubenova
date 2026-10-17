# Docker Compose

## 前置条件

Linux 主机安装 Node.js 22+、Docker Compose；在线升级执行器额外要求 systemd 和 root。端口默认 3000/4000/4100，可在环境文件调整。macOS 源码开发不安装此宿主机执行器。

## 首次安装

```bash
# 在项目或发布包根目录执行
bash scripts/compose-release.sh init
# 编辑 deploy/docker/.env 的公网域名、WebSocket 地址及第三方凭据
bash scripts/compose-release.sh up --tag v1.1
```

初始化会生成数据库密码、JWT、Runtime token、网关内部鉴权、AI 凭据加密密钥、初始管理员密码，六项独立随机生成，文件权限 0600。已有文件原样保留，不轮换凭据；旧模板占位值需要人工补齐。管理员初始密码在私有配置的 `DEFAULT_ADMIN_PASSWORD`，不会打印到日志。

远程访问时设置 `CORS_ORIGINS=https://your-domain`、`CONTROL_API_BASE_URL=https://your-domain/api`、`RUNTIME_GATEWAY_BASE_URL=wss://your-domain/ws`、`RUNTIME_GATEWAY_PUBLIC_BASE_URL=wss://your-domain`。公网域名、AI key、外部数据库、SMTP 凭据无法自动推导，仍需手填。

## 接入网页在线升级

在运行 Compose 的 Linux 宿主机安装，不能在容器内安装：

```bash
sudo node scripts/install-update-executor.mjs --env-file /绝对路径/docker.env
# 已有部署必须传实际运行版本，避免意外降级；配置只初始化一次
sudo bash scripts/compose-release.sh up --tag <当前部署版本> --env-file /绝对路径/docker.env
sudo systemctl status kubenova-update-executor.service --no-pager
sudo journalctl -u kubenova-update-executor.service -n 50 --no-pager
```

省略 `--env-file` 时使用项目的 `deploy/docker/.env`。安装器解析部署路径，保留现有容器的 Compose 项目名，避免误建数据库卷。新项目使用 Compose 文件目录名。配置冲突或升级任务运行中拒绝重装。

安装会自动生成/复用执行器 token，并分别写入 `/etc/kubenova/update-executor.env` 与 `/etc/kubenova/update-client.env`（0600）。后者仅注入 control-api，不进入前端共享配置。执行器默认监听 `/run/kubenova-update/executor.sock`，无需 IP/端口，不暴露 Docker socket。socket 目录只读挂载到 API，0600 权限适配当前 root API 镜像；自定义非 root 镜像需要受控 UID/GID，不得改为全局可写。

安装不直接重建业务容器，需用当前版本执行一次 `compose-release.sh up` 接入；以后在网页点击升级。启用执行器后统一使用该脚本，它自动叠加 `docker-compose.update.yml`；直接 Docker CLI 必须同时传基础文件和覆盖文件，以及 `KUBENOVA_COMPOSE_ENV_FILE` 绝对路径。

`--prepare-only` 只生成配置，不启动 systemd 或操作 Docker，不能作为已部署的证明。升级需要公开 GitHub Release 资产；私有 GHCR 镜像需要宿主机预先登录镜像仓库。macOS launchd、原生二进制和 Kubernetes 不在此自动接入范围。

## 验证

```bash
curl -fsS http://127.0.0.1:3000/ >/dev/null
curl -fsS http://127.0.0.1:4100/healthz
curl -fsS http://127.0.0.1:4000/api/health/ready >/dev/null
```

超级管理员进入“系统设置 → 更新管理”，确认执行器就绪；缺密钥、socket 挂载失败、Docker 不可用时升级按钮应禁用并说明原因。升级期间 API 短暂断连后可恢复任务进度，不据此判定升级失败。

## 回滚与保护

网页仅允许回滚到最近一次成功升级前的镜像版本，也可使用：

```bash
bash scripts/compose-release.sh rollback <上一版本> --env-file /绝对路径/docker.env
```

执行器先流式备份 PostgreSQL，再下载并校验资产，最后切换镜像并检查健康。备份失败不切换服务；切换失败才自动回滚镜像。数据库迁移不会自动撤销，正式升级前仍须异机备份。备份与状态在 `/var/lib/kubenova/update-executor`，不通过网页暴露。持有执行器密钥意味着主机部署权限，不能提交 Git 或下发浏览器。

## 故障排查

- 执行器不就绪：检查 systemd 日志、私有配置权限、Docker/Compose 和 API socket 挂载。
- 容器反复重启：检查对应容器日志、Prisma 迁移和健康探针。
- 浏览器空白/登录失败：检查同源代理、CORS 与前端静态文件，不以 HTTP 200 代替页面验收。
- 已有部署升级：保留原环境文件和 Compose 项目名，禁止轮换数据库/JWT/AI 加密密钥或删除数据卷。
