# 升级与回滚

## 发布契约

GitHub tag 触发构建，发布包和三个镜像均验证通过后才公布正式 Release。更新管理只展示真实版本、检测结果和下载入口，不执行宿主机部署。发布新版本不会自动升级现有服务。

升级前：备份 PostgreSQL、/etc/kubenova 或 Compose 环境文件，保留原 AI 加密密钥；确认数据库迁移兼容性、磁盘容量和维护窗口。应用回滚不等于数据库回滚。

## Docker Compose

使用 v1.11 中的新脚本与 Compose 文件；旧镜像仓库 feize1995 已改为 feize666。三个镜像必须使用同一个 tag。若 GHCR 包为私有，先 docker login ghcr.io，或将三个包设为公开。

```bash
bash scripts/compose-release.sh preflight --env-file deploy/docker/.env
bash scripts/compose-release.sh up --tag v1.11 --env-file deploy/docker/.env
```

脚本先拉取，再启动，等待 PostgreSQL、Redis、API、网关和前端均 healthy。失败返回非零，不自动切换数据库。确认旧版兼容当前数据库后，才使用 rollback <已有镜像版本>。此前仅有 Git tag 不代表该版本存在可拉取镜像。

## Binary + systemd

下载 archive 和 SHA256 文件到同一目录；不得覆盖正在运行的版本目录。以下命令假设 current 已是符号链接，v1.11 目录尚不存在：

```bash
sha256sum -c kubenova-ubuntu.tar.gz.sha256
sudo mkdir -p /opt/kubenova/releases/v1.11
sudo tar -xzf kubenova-ubuntu.tar.gz -C /opt/kubenova/releases/v1.11 --strip-components=1
# 使用新版本脚本补齐前端 systemd 单元；不会覆盖已有 /etc/kubenova 配置。
sudo bash /opt/kubenova/releases/v1.11/scripts/prod.sh install
sudo bash /opt/kubenova/releases/v1.11/scripts/prod.sh switch v1.11
```

switch 校验版本和完整目录、原子替换 current，再重启三个服务，并等待三个 HTTP 健康端点成功。重启/健康检查失败时返回非零并尝试恢复旧版本指针；如果旧服务重启也失败，需人工检查数据库兼容性与日志。不存在“秒级回滚”保证。

若旧版把文件直接放在 /opt/kubenova/current 实体目录：在维护窗口停止旧服务（包括非 systemd 启动的前端），将该实体目录重命名为 releases 下的一个保留目录，再创建指向它的 current 软链。先验证旧版可以恢复，再按上述步骤升级。脚本会拒绝直接覆盖实体 current，避免丢失旧版本。不要将 current 当作可删除的缓存目录。

## 验收

- /api/health/ready、/healthz、/login 均返回 2xx。
- 更新页显示真实运行版本；没有把旧 state JSON 的虚拟版本恢复进来。
- 登录、集群列表、资源详情、授权及日志/终端实际可用。
- 保留旧产物和数据库备份，观察稳定后再清理；不要删除正在使用的版本目录。
