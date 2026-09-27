export function buildUpdateGuide(tag: string, mode: "compose" | "systemd"): string {
  if (!/^v\d+\.\d+(?:\.\d+)?$/.test(tag)) return "";
  const health = `# 默认端口示例；自定义端口请同步替换。随后登录验证资源、权限、日志与终端。
curl -fsS http://127.0.0.1:4000/api/health/ready
curl -fsS http://127.0.0.1:4100/healthz
curl -fsS http://127.0.0.1:3000/login >/dev/null`;
  if (mode === "compose") return `# 在目标 Release 对应的源码目录执行；保留原有环境文件与加密密钥。
set -euo pipefail
umask 077
backup_dir="backups/pre-upgrade-\$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
install -m 600 deploy/docker/.env "$backup_dir/compose.env"
docker compose -f deploy/docker/docker-compose.prod.yml --env-file deploy/docker/.env images > "$backup_dir/images.txt"
docker compose -f deploy/docker/docker-compose.prod.yml --env-file deploy/docker/.env exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_dir/database.dump"
test -s "$backup_dir/database.dump"
# 先确认备份可恢复；私有镜像需提前 docker login ghcr.io。
bash scripts/compose-release.sh preflight --env-file deploy/docker/.env
bash scripts/compose-release.sh up --tag ${tag} --env-file deploy/docker/.env
${health}`;
  return `# 下载同一 Release 的发布包和 SHA256 文件后，在该目录执行。
# 适用 Ubuntu 24.04 x64 / Node.js 22+；current 必须已经是符号链接。
set -euo pipefail
umask 077
: "\${DATABASE_URL:?请设置现有数据库连接串，切勿使用示例密码}"
backup_dir="$PWD/pre-upgrade-\$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
pg_dump "$DATABASE_URL" -Fc > "$backup_dir/database.dump"
test -s "$backup_dir/database.dump"
sudo cp -a /etc/kubenova "$backup_dir/config"
test -L /opt/kubenova/current
readlink /opt/kubenova/current > "$backup_dir/previous-release.txt"
sha256sum -c kubenova-ubuntu.tar.gz.sha256
test ! -e /opt/kubenova/releases/${tag}
sudo mkdir -p /opt/kubenova/releases/${tag}
sudo tar -xzf kubenova-ubuntu.tar.gz -C /opt/kubenova/releases/${tag} --strip-components=1
sudo bash /opt/kubenova/releases/${tag}/scripts/prod.sh install
sudo bash /opt/kubenova/releases/${tag}/scripts/prod.sh switch ${tag}
${health}`;
}
