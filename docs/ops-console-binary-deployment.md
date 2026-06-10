# Ops Console Binary Deployment

本文件对应任务 11.3，说明二进制 / 发布目录 / systemd 部署。现有脚本默认使用 `/opt/kubenova/current` 作为运行目录。

## 构建

在仓库根目录执行：

```bash
bash scripts/service.sh build control-api
bash scripts/service.sh build frontend
bash scripts/service.sh build runtime-gateway
```

也可一次构建全部：

```bash
bash scripts/service.sh build all
```

当前脚本行为：

- control-api：执行 `backend/control-api` 下 `npm run build`
- frontend：执行 `frontend` 下 `npm run build:stable`
- runtime-gateway：执行 `go build -o ../../.release/runtime-gateway ./cmd/runtime-gateway`

## 发布目录

目标布局见 [deploy/binary/install-layout.md](../deploy/binary/install-layout.md)：

```text
/opt/kubenova/
  releases/
    <version>/
      control-api/
      runtime-gateway/
      frontend/
      metadata.json
  current -> /opt/kubenova/releases/<version>

/etc/kubenova/
  control-api.env
  runtime-gateway.env
```

不要直接覆盖 `current` 目录。新版本先放入 `releases/<version>`，验证后再切软链。

## 打包与放置

示例：

```bash
VERSION=1.2.3
RELEASE_BASE=/opt/kubenova
TARGET=${RELEASE_BASE}/releases/${VERSION}

sudo mkdir -p "${TARGET}/control-api" "${TARGET}/runtime-gateway" "${TARGET}/frontend"
sudo rsync -a backend/control-api/dist backend/control-api/package*.json backend/control-api/prisma "${TARGET}/control-api/"
sudo rsync -a frontend/.next frontend/package*.json frontend/public "${TARGET}/frontend/"
sudo install -m 0755 .release/runtime-gateway "${TARGET}/runtime-gateway/runtime-gateway"
sudo test -f "${TARGET}/control-api/dist/src/main.js"
sudo test -f "${TARGET}/frontend/.next/standalone/server.js"
sudo test -d "${TARGET}/frontend/.next/standalone/.next/static"
sudo test -x "${TARGET}/runtime-gateway/runtime-gateway"
```

注意：`service.sh prod up` 会检查 frontend standalone 包、control-api 构建产物、runtime-gateway 可执行文件。若构建产物布局不同，需要先调整发布包，而不是跳过检查。

## 配置

安装 systemd 和环境模板：

```bash
sudo ln -sfn /opt/kubenova/releases/<version> /opt/kubenova/current
sudo bash scripts/service.sh prod install
```

环境文件：

- `/etc/kubenova/control-api.env`
- `/etc/kubenova/runtime-gateway.env`

模板来源：

- `deploy/systemd/env/control-api.env.example`
- `deploy/systemd/env/runtime-gateway.env.example`

生产前替换默认密钥、数据库地址、Redis 地址、CORS、AI 模型配置。

## 前台运行

不走 systemd 的脚本运行：

```bash
RELEASE_ROOT=/opt/kubenova/current bash scripts/service.sh prod up
bash scripts/service.sh prod status
bash scripts/service.sh prod logs
```

停止：

```bash
bash scripts/service.sh prod down
```

## systemd 运行

安装后可直接使用 systemd：

```bash
sudo systemctl daemon-reload
sudo systemctl start kubenova-control-api.service kubenova-runtime-gateway.service
sudo systemctl status kubenova-control-api.service --no-pager
sudo systemctl status kubenova-runtime-gateway.service --no-pager
```

聚合 target：

```bash
sudo systemctl start kubenova.target
sudo systemctl status kubenova.target --no-pager
```

日志：

```bash
journalctl -u kubenova-control-api.service -n 200 --no-pager
journalctl -u kubenova-runtime-gateway.service -n 200 --no-pager
```

## 健康检查

```bash
curl -fsS http://127.0.0.1:3000/ >/dev/null && echo frontend-ok
curl -fsS http://127.0.0.1:4000/api/capabilities >/dev/null && echo control-api-ok
curl -fsS http://127.0.0.1:4100/healthz && echo
```

## 升级

```bash
bash scripts/service.sh prod switch <version>
bash scripts/service.sh prod status
```

`service.sh prod switch` 会检查：

- `runtime-gateway/runtime-gateway` 可执行
- `control-api/dist/src/main.js` 存在
- `frontend/.next/standalone/server.js` 存在
- `frontend/.next/standalone/.next/static` 存在

## 回滚

```bash
bash scripts/service.sh prod rollback <previous-version>
bash scripts/service.sh prod status
```

回滚依赖旧版本目录仍保留在 `/opt/kubenova/releases/<previous-version>`。

## 卸载

卸载 systemd 单元和环境模板：

```bash
sudo bash scripts/service.sh prod uninstall
```

该脚本会删除：

- systemd 单元：`kubenova.target`、`kubenova-control-api.service`、`kubenova-runtime-gateway.service`
- 环境文件：`/etc/kubenova/control-api.env`、`/etc/kubenova/runtime-gateway.env`

发布目录和数据库数据需由运维按保留策略单独处理。
