# Linux 启动速查卡

## 开发机

```bash
bash scripts/install-deps.sh
bash scripts/db-init.sh
bash scripts/dev-up.sh
bash scripts/dev-status.sh
bash scripts/dev-down.sh
```

访问：

- `http://localhost:3000`
- `http://localhost:4000`
- `ws://localhost:4100`

## 正式环境

```bash
bash scripts/prod-install.sh
bash scripts/prod-up.sh
bash scripts/prod-status.sh
bash scripts/prod-switch.sh <version>
bash scripts/prod-rollback.sh <version>
bash scripts/prod-down.sh
bash scripts/prod-uninstall.sh
```

## 目录

```text
/opt/k8s-aiops-manager/current
/opt/k8s-aiops-manager/releases/<version>
/etc/k8s-aiops-manager/*.env
```

## 常看命令

```bash
bash scripts/dev-status.sh
bash scripts/prod-status.sh
tail -n 200 .run/logs/frontend.log
tail -n 200 .run/logs/control-api.log
tail -n 200 .run/logs/runtime-gateway.log
```

