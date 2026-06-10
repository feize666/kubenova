#!/usr/bin/env bash
# Unified service command entrypoint.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/service.sh <command> [options]

Commands:
  dev up [--no-gateway] [--stable-frontend|--dev-frontend] [--stable-api|--dev-api]
                                Start local development services
  dev down [service...]        Stop local development services
  dev restart [service...]     Restart local development services
  dev status                   Show local development service status
  dev logs [service]           Tail local service logs

  prod up                      Start production release services
  prod down                    Stop production release services
  prod restart                 Restart production release services
  prod status                  Show production release service status
  prod logs [service]          Tail production service logs
  prod install                 Install systemd units and env templates
  prod uninstall               Uninstall systemd units and env templates
  prod switch <version>        Switch /opt/kubenova/current to a release
  prod rollback <version>      Roll back /opt/kubenova/current to a release

  install-deps                 Install local dependencies
  db-init                      Initialize local database
  build frontend               Build frontend stable bundle
  build control-api            Build control-api
  build runtime-gateway        Build runtime-gateway binary
  build all                    Build all production artifacts
  package release              Build and package Ubuntu binary release tarball
  test topology                Run topology verification
  clean topology-artifacts     Clean topology artifacts
  clean dev-cache              Clean local frontend development build cache
  help                         Show this help

Services:
  frontend | control-api | runtime-gateway | all

Environment:
  FRONTEND_PORT, CONTROL_API_PORT, RUNTIME_GATEWAY_PORT, FRONTEND_BOOT_MODE,
  START_GATEWAY, USE_TMUX, RELEASE_ROOT, SYSTEMD_ENV_DIR

Notes:
  --stable-frontend runs the frontend from the Next standalone build. Prefer it
  for release/browser regression because Next dev can restart under memory
  pressure during large route sweeps.
USAGE
}

die() {
  echo "[错误] $*" >&2
  echo "诊断: bash scripts/service.sh help" >&2
  exit 2
}

diagnostic_fail() {
  local component="$1" reason="$2" next="${3:-bash scripts/service.sh help}"
  echo "[错误] component=$component" >&2
  echo "原因: $reason" >&2
  echo "下一步: $next" >&2
  exit 1
}

require_command() {
  local component="$1" cmd="$2" hint="${3:-install $cmd}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    diagnostic_fail "$component" "缺少依赖命令: $cmd" "$hint"
  fi
}

ensure_dir() {
  local component="$1" dir="$2"
  if [[ ! -d "$dir" ]]; then
    diagnostic_fail "$component" "目录不存在: $dir" "检查仓库完整性或重新拉取代码"
  fi
}

preflight_common() {
  require_command common bash "安装 bash"
  require_command common tail "安装 coreutils"
  require_command common fuser "安装 psmisc"
}

preflight_dev() {
  preflight_common
  require_command dev node "安装 Node.js"
  require_command dev npm "安装 npm"
  require_command dev curl "安装 curl"
  ensure_dir frontend "$ROOT_DIR/frontend"
  ensure_dir control-api "$ROOT_DIR/backend/control-api"
  ensure_dir runtime-gateway "$ROOT_DIR/backend/runtime-gateway"
}

preflight_prod() {
  preflight_common
  require_command prod node "安装 Node.js"
  require_command prod curl "安装 curl"
  local release_root="${RELEASE_ROOT:-/opt/kubenova/current}"
  if [[ "${1:-}" == "start" || "${1:-}" == "up" ]]; then
    ensure_dir prod "$release_root"
  fi
}

preflight_logs() {
  preflight_common
}

run_script() {
  local script="$1"
  shift || true
  if [[ ! -f "$ROOT_DIR/scripts/$script" ]]; then
    die "脚本不存在: scripts/$script"
  fi
  exec bash "$ROOT_DIR/scripts/$script" "$@"
}

run_dev() {
  exec bash "$ROOT_DIR/scripts/dev.sh" "$@"
}

run_prod() {
  exec bash "$ROOT_DIR/scripts/prod.sh" "$@"
}

install_deps() {
  echo "[安装] 正在安装前端依赖..."
  npm --prefix "$ROOT_DIR/frontend" install

  echo "[安装] 正在安装 control-api 依赖..."
  npm --prefix "$ROOT_DIR/backend/control-api" install

  if [[ -d "$ROOT_DIR/backend/runtime-gateway" ]]; then
    echo "[安装] 正在安装 runtime-gateway 依赖（go mod download）..."
    (cd "$ROOT_DIR/backend/runtime-gateway" && go mod download)
  fi

  echo ""
  echo "✔ 所有依赖已安装"
}

db_init() {
  local control_api_dir="$ROOT_DIR/backend/control-api"
  local db_name="${DB_NAME:-k8s_aiops}"
  local db_user="${DB_USER:-kubenova}"
  local db_pass="${DB_PASS:-kubenova_dev}"
  local db_host="${DB_HOST:-localhost}"
  local db_port="${DB_PORT:-5432}"
  local database_url="postgresql://${db_user}:${db_pass}@${db_host}:${db_port}/${db_name}"
  local reset="false"

  for arg in "$@"; do
    [[ "$arg" == "--reset" ]] && reset="true"
  done

  echo "[数据库初始化] 目标：$database_url"

  run_psql() {
    sudo -u postgres psql -v ON_ERROR_STOP=1 -c "$1" 2>&1
  }

  if [[ "$reset" == "true" ]]; then
    echo "[数据库初始化] --reset：正在删除数据库 $db_name ..."
    run_psql "DROP DATABASE IF EXISTS $db_name;" || true
  fi

  echo "[数据库初始化] 正在确保角色 '$db_user' 存在..."
  run_psql "DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$db_user') THEN
      CREATE ROLE $db_user LOGIN PASSWORD '$db_pass' CREATEDB;
    END IF;
  END \$\$;" 2>/dev/null || run_psql "ALTER USER $db_user WITH PASSWORD '$db_pass' CREATEDB;"

  echo "[数据库初始化] 正在确保数据库 '$db_name' 存在..."
  sudo -u postgres psql -c "SELECT 1 FROM pg_database WHERE datname='$db_name'" | grep -q 1 \
    || run_psql "CREATE DATABASE $db_name OWNER $db_user;"

  run_psql "GRANT ALL PRIVILEGES ON DATABASE $db_name TO $db_user;" 2>/dev/null || true

  echo "[数据库初始化] 正在执行 prisma migrate deploy..."
  (cd "$control_api_dir" && DATABASE_URL="$database_url" npx prisma migrate deploy 2>&1)

  echo "[数据库初始化] 正在生成 Prisma Client..."
  (cd "$control_api_dir" && DATABASE_URL="$database_url" npx prisma generate 2>&1)

  echo ""
  echo "✔ 数据库初始化完成：$database_url"
  echo "  可执行 'bash scripts/service.sh dev up' 启动所有服务。"
}

clean_topology_artifacts() {
  local dry_run="false"
  if [[ "${1:-}" == "--dry-run" ]]; then
    dry_run="true"
  fi
  local targets=(
    "$ROOT_DIR/.playwright-mcp"
    "$ROOT_DIR/tmp-topology-default.md"
    "$ROOT_DIR/tmp-topology-default.png"
  )

  echo "[topology-clean] root=$ROOT_DIR dry_run=$dry_run"
  local target
  for target in "${targets[@]}"; do
    [[ -e "$target" ]] || continue
    if [[ "$dry_run" == "true" ]]; then
      echo "[topology-clean] would remove: $target"
      continue
    fi
    rm -rf "$target"
    echo "[topology-clean] removed: $target"
  done
  echo "[topology-clean] done"
}

clean_dev_cache() {
  local targets=(
    "$ROOT_DIR/frontend/.next/dev"
    "$ROOT_DIR/frontend/.next/cache"
  )
  echo "[dev-cache-clean] root=$ROOT_DIR"
  local target
  for target in "${targets[@]}"; do
    if [[ -e "$target" ]]; then
      rm -rf "$target"
      echo "[dev-cache-clean] removed: $target"
    fi
  done
  echo "[dev-cache-clean] done"
}

service_log_dir() {
  local mode="$1" service="$2"
  case "$mode:$service" in
    dev:frontend) echo "$ROOT_DIR/frontend/logs" ;;
    dev:control-api) echo "$ROOT_DIR/backend/control-api/logs" ;;
    dev:runtime-gateway) echo "$ROOT_DIR/backend/runtime-gateway/logs" ;;
    prod:frontend) echo "${RELEASE_ROOT:-/opt/kubenova/current}/frontend/logs" ;;
    prod:control-api) echo "${RELEASE_ROOT:-/opt/kubenova/current}/control-api/logs" ;;
    prod:runtime-gateway) echo "${RELEASE_ROOT:-/opt/kubenova/current}/runtime-gateway/logs" ;;
    *) return 1 ;;
  esac
}

tail_logs() {
  local mode="$1" service="${2:-all}" suffix
  case "$mode" in
    dev) suffix="dev" ;;
    prod) suffix="prod" ;;
    *) die "未知日志模式: $mode" ;;
  esac

  local services=()
  if [[ "$service" == "all" ]]; then
    services=(frontend control-api runtime-gateway)
  else
    services=("$service")
  fi

  local files=()
  local item dir file
  for item in "${services[@]}"; do
    case "$item" in
      frontend|control-api|runtime-gateway) ;;
      *) die "未知服务: $item" ;;
    esac
    dir="$(service_log_dir "$mode" "$item")" || die "无法解析日志目录: $item"
    file="$dir/${suffix}.log"
    if [[ -f "$file" ]]; then
      files+=("$file")
    else
      echo "[$item] 日志不存在: $file" >&2
    fi
  done

  if [[ "${#files[@]}" -eq 0 ]]; then
    die "没有可读取的日志文件"
  fi

  exec tail -n "${LOG_LINES:-120}" -F "${files[@]}"
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  help|-h|--help)
    usage
    ;;
  dev)
    sub="${1:-help}"
    shift || true
    case "$sub" in
      up|start|restart)
        preflight_dev
        run_dev "$sub" "$@"
        ;;
      down|stop)
        preflight_common
        run_dev "$sub" "$@"
        ;;
      status)
        preflight_common
        run_dev "$sub" "$@"
        ;;
      logs)
        preflight_logs
        tail_logs dev "${1:-all}"
        ;;
      help|-h|--help) usage ;;
      *) die "未知 dev 命令: $sub" ;;
    esac
    ;;
  prod)
    sub="${1:-help}"
    shift || true
    case "$sub" in
      up|start|restart)
        preflight_prod "$sub"
        run_prod "$sub" "$@"
        ;;
      down|stop)
        preflight_common
        run_prod "$sub" "$@"
        ;;
      status)
        preflight_common
        run_prod "$sub" "$@"
        ;;
      logs)
        preflight_logs
        tail_logs prod "${1:-all}"
        ;;
      install|uninstall|switch|rollback)
        preflight_common
        run_prod "$sub" "$@"
        ;;
      help|-h|--help) usage ;;
      *) die "未知 prod 命令: $sub" ;;
    esac
    ;;
  install-deps)
    install_deps "$@"
    ;;
  db-init)
    db_init "$@"
    ;;
  build)
    sub="${1:-all}"
    shift || true
    case "$sub" in
      frontend)
        exec bash -lc "cd $(printf '%q' "$ROOT_DIR/frontend") && npm run build:stable"
        ;;
      control-api)
        exec bash -lc "cd $(printf '%q' "$ROOT_DIR/backend/control-api") && npm run build"
        ;;
      runtime-gateway)
        exec bash -lc "cd $(printf '%q' "$ROOT_DIR/backend/runtime-gateway") && go build -o ../../.release/runtime-gateway ./cmd/runtime-gateway"
        ;;
      all)
        bash "$ROOT_DIR/scripts/service.sh" build control-api
        bash "$ROOT_DIR/scripts/service.sh" build frontend
        exec bash "$ROOT_DIR/scripts/service.sh" build runtime-gateway
        ;;
      help|-h|--help) usage ;;
      *) die "未知 build 命令: $sub" ;;
    esac
    ;;
  package)
    sub="${1:-help}"
    shift || true
    case "$sub" in
      release)
        run_script package-release.sh "$@"
        ;;
      help|-h|--help) usage ;;
      *) die "未知 package 命令: $sub" ;;
    esac
    ;;
  test)
    sub="${1:-help}"
    shift || true
    case "$sub" in
      topology) run_script topology-verify.sh "$@" ;;
      help|-h|--help) usage ;;
      *) die "未知 test 命令: $sub" ;;
    esac
    ;;
  clean)
    sub="${1:-help}"
    shift || true
    case "$sub" in
      topology-artifacts) clean_topology_artifacts "$@" ;;
      dev-cache) clean_dev_cache "$@" ;;
      help|-h|--help) usage ;;
      *) die "未知 clean 命令: $sub" ;;
    esac
    ;;
  *)
    die "未知命令: $cmd"
    ;;
esac
