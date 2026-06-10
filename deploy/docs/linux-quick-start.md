# Linux 启动速查卡

## 开发机

```bash
bash scripts/service.sh install-deps
bash scripts/service.sh db-init
bash scripts/service.sh dev up
bash scripts/service.sh dev status
bash scripts/service.sh dev down
```

访问：

- `http://localhost:3000`
- `http://localhost:4000`
- `ws://localhost:4100`

## 正式环境

```bash
bash scripts/service.sh prod install
bash scripts/service.sh prod up
bash scripts/service.sh prod status
bash scripts/service.sh prod switch <version>
bash scripts/service.sh prod rollback <version>
bash scripts/service.sh prod down
bash scripts/service.sh prod uninstall
```

## 目录

```text
/opt/kubenova/current
/opt/kubenova/releases/<version>
/etc/kubenova/*.env
```

## 常看命令

```bash
bash scripts/service.sh dev status
bash scripts/service.sh prod status
tail -n 200 .run/logs/frontend.log
tail -n 200 .run/logs/control-api.log
tail -n 200 .run/logs/runtime-gateway.log
```

