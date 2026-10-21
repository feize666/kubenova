# 升级与回滚

## 发布契约

GitHub tag 触发构建，发布包和三个镜像均验证通过后才公布正式 Release。更新管理的在线升级由已安装的宿主机执行器完成；发布新版本不会自动升级现有服务。

`v1.1` 及更早版本的更新页只提供下载与手动部署，没有可调用宿主机执行器的在线升级实现。因此首次从这些版本升级到带执行器的版本必须按下方原生包步骤手动完成一次；后续版本才能从页面一键升级。不能只在旧版本主机上安装新执行器就让旧页面获得新 API 能力。

## 预检与当前支持范围

更新设置由超级管理员在更新页面维护，服务端使用首次安装生成的 `KUBENOVA_UPDATE_ENCRYPTION_KEY` 加密保存数据库连接凭据。Compose/systemd 当前预检会检查执行器、部署健康、本地备份目录写入/剩余空间以及 PostgreSQL 完整导出，并清理探测备份；正式任务使用预检绑定的本机绝对路径。

宿主执行器内置临时数据库生命周期：以迁移测试目标的 PostgreSQL 管理连接生成随机库名，创建独立数据库，将当前库 custom-format dump 恢复进去，完成后使用 `DROP DATABASE ... WITH (FORCE)` 清理。建库、恢复和清理不再由自定义命令实现。目标版本迁移通过受保护配置 `KUBENOVA_UPDATE_MIGRATION_TEST_COMMAND` 执行；旧版本兼容检查通过 `KUBENOVA_UPDATE_OLD_VERSION_COMPATIBILITY_COMMAND` 执行。两者必须以临时库为目标，使用环境变量 `DATABASE_URL` 连接；执行器另提供 `KUBENOVA_UPDATE_REHEARSAL_TARGET_VERSION`。命令退出非零、工具缺失、不能创建/恢复数据库或清理失败时，预检失败并阻止升级。严禁在这些命令中硬编码生产数据库地址，执行器传入的 `DATABASE_URL` 才是隔离测试库。标记为“本机 PostgreSQL 临时测试库”的连接串仅接受 `localhost`、`127.0.0.1` 或 `::1`；远端数据库必须明确选择“外部 PostgreSQL 测试库”。

Compose 和 systemd 执行器使用同一备份保留规则：至少保留最近 3 份，并保留全部 30 天内的备份；只有同时超过最近 3 份及 30 天的备份才可清理。文件扩展名 `.sql` 和 `.dump` 均受管理，其他文件不会由更新清理器删除。

S3 兼容备份通过宿主机 AWS CLI 执行。需在执行器主机安装 AWS CLI，并为更新管理配置独立的 `s3://bucket/dedicated-prefix`、`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`；兼容服务可额外配置 `AWS_ENDPOINT_URL` 和区域。预检会上传、读回并删除随机探测对象，任何一步失败都会阻断升级。远端清理只处理该前缀下名称匹配 `kubenova-update-*.dump` 或 `.sql` 的备份，并保留最近 3 份及所有 30 天内备份。Kubernetes 使用持久签名任务队列和独立 namespace-scoped 控制器；提交升级前会先备份、恢复到临时库、执行目标版本迁移、用当前镜像检查迁移后 readiness，并清理临时 Job、Secret 和数据库。所有检查和清理通过后才提交滚动更新。成功任务持久保存升级前三个服务的不可变镜像摘要，页面可一键回滚到该镜像集；回滚同样先备份数据库，但不会自动撤销数据库迁移。

升级前：备份 PostgreSQL、/etc/kubenova 或 Compose 环境文件，保留原 AI 加密密钥；确认数据库迁移兼容性、磁盘容量和维护窗口。应用回滚不等于数据库回滚。

## Docker Compose

使用 v1.1 中的新脚本与 Compose 文件；旧镜像仓库 feize1995 已改为 feize666。三个镜像必须使用同一个 tag。若 GHCR 包为私有，先 docker login ghcr.io，或将三个包设为公开。

```bash
bash scripts/compose-release.sh preflight --env-file deploy/docker/.env
bash scripts/compose-release.sh up --tag v1.1 --env-file deploy/docker/.env
```

脚本先拉取，再启动，等待 PostgreSQL、Redis、API、网关和前端均 healthy。失败返回非零，不自动切换数据库。确认旧版兼容当前数据库后，才使用 rollback <已有镜像版本>。此前仅有 Git tag 不代表该版本存在可拉取镜像。

## Binary + systemd

在原生包部署中，首次运行 `prod.sh install` 会安装 systemd 更新执行器，生成本机私有 socket 和随机密钥，并写入 `/etc/kubenova/control-api.env`。执行器以 root 运行，仅通过 `/run/kubenova-update/executor.sock` 接收 control-api 的受限升级请求；不要开放 TCP 更新端口或把密钥放进浏览器。

页面内升级会备份 PostgreSQL、下载并校验 Release 包与 SHA256，核对 `metadata.json` 后解压到新的版本目录，再调用 `prod.sh switch` 原子切换 `current` 并检查三个服务。失败时恢复原版本指针；数据库迁移不会自动回滚。无需先手动下载包。

手动方式仅用于执行器不可用时的应急恢复。下载 archive 和 SHA256 文件到同一目录；不得覆盖正在运行的版本目录。以下命令假设 current 已是符号链接，v1.1 目录尚不存在：

```bash
sha256sum -c kubenova-ubuntu.tar.gz.sha256
sudo mkdir -p /opt/kubenova/releases/v1.1
sudo tar -xzf kubenova-ubuntu.tar.gz -C /opt/kubenova/releases/v1.1 --strip-components=1
# 使用新版本脚本补齐前端 systemd 单元；不会覆盖已有 /etc/kubenova 配置。
sudo bash /opt/kubenova/releases/v1.1/scripts/prod.sh install
sudo bash /opt/kubenova/releases/v1.1/scripts/prod.sh switch v1.1
```

switch 校验版本和完整目录、原子替换 current，再重启三个服务，并等待三个 HTTP 健康端点成功。重启/健康检查失败时返回非零并尝试恢复旧版本指针；如果旧服务重启也失败，需人工检查数据库兼容性与日志。不存在“秒级回滚”保证。

若旧版把文件直接放在 /opt/kubenova/current 实体目录：在维护窗口停止旧服务（包括非 systemd 启动的前端），将该实体目录重命名为 releases 下的一个保留目录，再创建指向它的 current 软链。先验证旧版可以恢复，再按上述步骤升级。脚本会拒绝直接覆盖实体 current，避免丢失旧版本。不要将 current 当作可删除的缓存目录。

## 验收

- /api/health/ready、/healthz、/login 均返回 2xx。
- 更新页显示真实运行版本；没有把旧 state JSON 的虚拟版本恢复进来。
- 登录、集群列表、资源详情、授权及日志/终端实际可用。
- 保留旧产物和数据库备份，观察稳定后再清理；不要删除正在使用的版本目录。
