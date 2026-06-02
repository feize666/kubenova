#!/usr/bin/env bash
# Unified service command entrypoint.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/service.sh <command> [options]

Commands:
  dev up [--no-gateway] [--stable-frontend|--dev-frontend]
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
  prod switch <version>        Switch current release
  prod rollback <version>      Roll back current release

  install-deps                 Install local dependencies
  db-init                      Initialize local database
  build frontend               Build frontend stable bundle
  build control-api            Build control-api
  build runtime-gateway        Build runtime-gateway binary
  build all                    Build all production artifacts
  test topology                Run topology verification
  clean topology-artifacts     Clean topology artifacts
  topology verify              Run topology verification
  topology clean               Clean topology artifacts
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
  local release_root="${RELEASE_ROOT:-/opt/k8s-aiops-manager/current}"
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

service_log_dir() {
  local mode="$1" service="$2"
  case "$mode:$service" in
    dev:frontend) echo "$ROOT_DIR/frontend/logs" ;;
    dev:control-api) echo "$ROOT_DIR/backend/control-api/logs" ;;
    dev:runtime-gateway) echo "$ROOT_DIR/backend/runtime-gateway/logs" ;;
    prod:frontend) echo "${RELEASE_ROOT:-/opt/k8s-aiops-manager/current}/frontend/logs" ;;
    prod:control-api) echo "${RELEASE_ROOT:-/opt/k8s-aiops-manager/current}/control-api/logs" ;;
    prod:runtime-gateway) echo "${RELEASE_ROOT:-/opt/k8s-aiops-manager/current}/runtime-gateway/logs" ;;
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
      up|start)
        preflight_dev
        run_script dev-up.sh "$@"
        ;;
      down|stop)
        preflight_common
        run_script dev-down.sh "$@"
        ;;
      restart)
        preflight_dev
        bash "$ROOT_DIR/scripts/dev-down.sh" "$@"
        exec bash "$ROOT_DIR/scripts/dev-up.sh"
        ;;
      status)
        preflight_common
        run_script dev-status.sh "$@"
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
      up|start)
        preflight_prod "$sub"
        run_script prod-up.sh "$@"
        ;;
      down|stop)
        preflight_common
        run_script prod-down.sh "$@"
        ;;
      restart)
        preflight_prod up
        bash "$ROOT_DIR/scripts/prod-down.sh" "$@"
        exec bash "$ROOT_DIR/scripts/prod-up.sh"
        ;;
      status)
        preflight_common
        run_script prod-status.sh "$@"
        ;;
      logs)
        preflight_logs
        tail_logs prod "${1:-all}"
        ;;
      install)
        preflight_common
        run_script prod-install.sh "$@"
        ;;
      uninstall)
        preflight_common
        run_script prod-uninstall.sh "$@"
        ;;
      switch)
        preflight_common
        run_script prod-switch.sh "$@"
        ;;
      rollback)
        preflight_common
        run_script prod-rollback.sh "$@"
        ;;
      help|-h|--help) usage ;;
      *) die "未知 prod 命令: $sub" ;;
    esac
    ;;
  install-deps)
    run_script install-deps.sh "$@"
    ;;
  db-init)
    run_script db-init.sh "$@"
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
      topology-artifacts) run_script topology-clean-artifacts.sh "$@" ;;
      help|-h|--help) usage ;;
      *) die "未知 clean 命令: $sub" ;;
    esac
    ;;
  topology)
    sub="${1:-help}"
    shift || true
    case "$sub" in
      verify) run_script topology-verify.sh "$@" ;;
      clean) run_script topology-clean-artifacts.sh "$@" ;;
      help|-h|--help) usage ;;
      *) die "未知 topology 命令: $sub" ;;
    esac
    ;;
  *)
    die "未知命令: $cmd"
    ;;
esac
