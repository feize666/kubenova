#!/usr/bin/env bash
# db-init.sh — 初始化 / 重置本地开发数据库
# 用法: bash scripts/db-init.sh [--reset]
#   --reset  先删除再重建数据库（危险！会清空所有数据）
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTROL_API_DIR="$ROOT_DIR/backend/control-api"

DB_NAME="${DB_NAME:-k8s_aiops}"
DB_USER="${DB_USER:-k8s_aiops}"
DB_PASS="${DB_PASS:-k8s_aiops_dev}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

RESET=false
for arg in "$@"; do
  [[ "$arg" == "--reset" ]] && RESET=true
done

echo "[数据库初始化] 目标：$DATABASE_URL"

# ── 1. 创建用户和数据库（以 postgres 超级用户执行）──────
run_psql() {
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "$1" 2>&1
}

# 如果是 reset，先删库
if [[ "$RESET" == "true" ]]; then
  echo "[数据库初始化] --reset：正在删除数据库 $DB_NAME ..."
  run_psql "DROP DATABASE IF EXISTS $DB_NAME;" || true
fi

echo "[数据库初始化] 正在确保角色 '$DB_USER' 存在..."
run_psql "DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS' CREATEDB;
  END IF;
END \$\$;" 2>/dev/null || run_psql "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS' CREATEDB;"

echo "[数据库初始化] 正在确保数据库 '$DB_NAME' 存在..."
sudo -u postgres psql -c "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || run_psql "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

run_psql "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null || true

# ── 2. 运行 Prisma migrate ──────────────────────────────
echo "[数据库初始化] 正在执行 prisma migrate deploy..."
cd "$CONTROL_API_DIR"
DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy 2>&1

# ── 3. 生成 Prisma Client ───────────────────────────────
echo "[数据库初始化] 正在生成 Prisma Client..."
DATABASE_URL="$DATABASE_URL" npx prisma generate 2>&1

echo ""
echo "✔ 数据库初始化完成：$DATABASE_URL"
echo "  可执行 'bash scripts/dev-up.sh' 启动所有服务。"
