#!/usr/bin/env bash

service_lib_init() {
  : "${ROOT_DIR:?ROOT_DIR must be set before sourcing _service-lib.sh}"
  : "${RUN_DIR:=$ROOT_DIR/.run}"
  : "${SERVICE_PID_SUFFIX:=}"
  : "${SERVICE_LOG_SUFFIX:=}"
  mkdir -p "$RUN_DIR"
}

stream_match() {
  local pattern="$1"
  if command -v rg >/dev/null 2>&1; then
    rg -q -- "$pattern"
  else
    grep -Eq -- "$pattern"
  fi
}

check_dep() {
  local cmd="$1" pkg="${2:-$1}"
  if ! command -v "$cmd" &>/dev/null; then
    echo "[错误] 未找到 '$cmd'，请先安装 $pkg。" >&2
    exit 1
  fi
}

service_port() {
  local name="$1"
  case "$name" in
    frontend) echo "${FRONTEND_PORT:-3000}" ;;
    control-api) echo "${CONTROL_API_PORT:-4000}" ;;
    runtime-gateway) echo "${RUNTIME_GATEWAY_PORT:-4100}" ;;
    *) echo "" ;;
  esac
}

service_health_url() {
  local name="$1" port="${2:-}"
  [[ -n "$port" ]] || port="$(service_port "$name")"
  case "$name" in
    frontend) echo "http://127.0.0.1:${port}/" ;;
    control-api) echo "http://127.0.0.1:${port}/api/capabilities" ;;
    runtime-gateway) echo "http://127.0.0.1:${port}/healthz" ;;
    *) echo "" ;;
  esac
}

service_session_name() {
  local name="$1"
  echo "aiops-${name}"
}

service_pid_file() {
  local name="$1"
  if [[ "$name" == "frontend" && "${FRONTEND_BOOT_MODE:-dev}" == "dev" && "${USE_TMUX:-false}" != "true" ]]; then
    echo "$RUN_DIR/${name}${SERVICE_PID_SUFFIX}.supervisor.pid"
  else
    echo "$RUN_DIR/${name}${SERVICE_PID_SUFFIX}.pid"
  fi
}

service_child_pid_file() {
  local name="$1"
  echo "$RUN_DIR/${name}${SERVICE_PID_SUFFIX}.pid"
}

service_uses_supervisor() {
  local name="$1"
  [[ "$name" == "frontend" && "${FRONTEND_BOOT_MODE:-dev}" == "dev" && "${USE_TMUX:-false}" != "true" ]]
}

service_dir() {
  local name="$1"
  case "$name" in
    frontend) echo "${FRONTEND_DIR:?FRONTEND_DIR is required}" ;;
    control-api) echo "${CONTROL_API_DIR:?CONTROL_API_DIR is required}" ;;
    runtime-gateway) echo "${RUNTIME_GATEWAY_DIR:?RUNTIME_GATEWAY_DIR is required}" ;;
    *) return 1 ;;
  esac
}

service_log_dir() {
  local name="$1"
  echo "$(service_dir "$name")/logs"
}

service_log_file() {
  local name="$1"
  local suffix="${SERVICE_LOG_SUFFIX:-dev}"
  echo "$(service_log_dir "$name")/${suffix}.log"
}

ensure_service_log_dir() {
  local name="$1"
  mkdir -p "$(service_log_dir "$name")"
}

service_log_dirs_summary() {
  echo "日志目录:"
  echo "  frontend: $(service_log_dir frontend)"
  echo "  control-api: $(service_log_dir control-api)"
  echo "  runtime-gateway: $(service_log_dir runtime-gateway)"
}

tmux_session_exists() {
  local session="$1"
  tmux has-session -t "$session" 2>/dev/null
}

listener_pid() {
  local port="$1"
  fuser -n tcp "$port" 2>/dev/null | tr ' ' '\n' | sed '/^$/d' | head -n 1
}

wait_for_port_free() {
  local port="$1"
  local retries="${2:-10}"
  for _ in $(seq 1 "$retries"); do
    if ! listener_pid "$port" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

terminate_pid() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
  fi
}

process_cmdline() {
  local pid="$1"
  ps -p "$pid" -o args= 2>/dev/null || true
}

process_cwd() {
  local pid="$1"
  readlink -f "/proc/$pid/cwd" 2>/dev/null || true
}

is_runtime_gateway_process() {
  local pid="$1"
  local cmdline
  cmdline="$(process_cmdline "$pid")"
  [[ "$cmdline" == *"runtime-gateway"* || "$cmdline" == *"cmd/runtime-gateway"* ]]
}

is_frontend_process() {
  local pid="$1"
  local cmdline
  cmdline="$(process_cmdline "$pid")"
  [[ "$cmdline" == *"dev-supervise.sh frontend"* || "$cmdline" == *"next-server"* || "$cmdline" == *"frontend/.next/standalone/server.js"* || "$cmdline" == *"next/dist/bin/next start"* || "$cmdline" == *"next/dist/bin/next dev"* || "$cmdline" == *".next/standalone/server.js"* ]]
}

is_frontend_standalone_process() {
  local pid="$1"
  local cwd
  cwd="$(process_cwd "$pid")"
  [[ "$cwd" == *"/frontend/.next/standalone" || "$cwd" == *"/.next/standalone" ]]
}

is_control_api_process() {
  local pid="$1"
  local cmdline
  cmdline="$(process_cmdline "$pid")"
  [[ "$cmdline" == *"/backend/control-api/dist/"* || "$cmdline" == *"dist/src/main.js"* || "$cmdline" == *"nestjs"* || "$cmdline" == *"start:dev"* ]]
}

service_matches_pid() {
  local name="$1" pid="$2"
  case "$name" in
    frontend) is_frontend_process "$pid" ;;
    control-api) is_control_api_process "$pid" ;;
    runtime-gateway) is_runtime_gateway_process "$pid" ;;
    *) return 1 ;;
  esac
}

service_is_starting() {
  local pid="$1" port="$2"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
  if [[ -n "$port" ]] && ss -ltnp "( sport = :$port )" 2>/dev/null | stream_match "pid=$pid"; then
    return 1
  fi
  local stat
  stat="$(ps -p "$pid" -o stat= 2>/dev/null | tr -d '[:space:]' || true)"
  [[ -n "$stat" ]]
}

is_healthy() {
  local url="$1"
  if [[ -z "$url" ]]; then
    return 0
  fi
  local code
  code="$(curl -s -o /dev/null -m 2 -w "%{http_code}" "$url" || true)"
  [[ "$code" =~ ^[234][0-9][0-9]$ ]]
}

health_text() {
  local url="$1"
  if is_healthy "$url"; then
    echo "正常"
  else
    echo "异常"
  fi
}

wait_for_health() {
  local url="$1" retries="${2:-12}"
  if [[ -z "$url" ]]; then
    return 0
  fi
  for _ in $(seq 1 "$retries"); do
    if is_healthy "$url"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_detached() {
  local workdir="$1" cmd="$2" log_file="$3" pid_file="$4"
  mkdir -p "$(dirname "$log_file")"
  : >"$log_file"
  (
    cd "$workdir"
    if command -v setsid >/dev/null 2>&1; then
      setsid bash -lc "$cmd" >"$log_file" 2>&1 < /dev/null &
    else
      nohup bash -lc "$cmd" >"$log_file" 2>&1 < /dev/null &
    fi
    echo $! >"$pid_file"
  )
}

service_health_timeout() {
  local name="$1"
  case "$name" in
    control-api) echo 180 ;;
    frontend) echo 120 ;;
    runtime-gateway) echo 120 ;;
    *) echo 60 ;;
  esac
}

resolve_managed_pid() {
  local name="$1" port="$2" fallback_pid="${3:-}"
  local bound_pid
  bound_pid="$(listener_pid "$port" || true)"

  if [[ -n "$bound_pid" ]] && service_matches_pid "$name" "$bound_pid"; then
    echo "$bound_pid"
    return
  fi

  if [[ -n "$fallback_pid" ]]; then
    echo "$fallback_pid"
  fi
}

stop_service() {
  local name="$1"
  local port="${2:-$(service_port "$name")}"
  local adopt_listener="${3:-true}"
  local pid_file child_pid_file session_name
  pid_file="$(service_pid_file "$name")"
  child_pid_file="$(service_child_pid_file "$name")"
  session_name="$(service_session_name "$name")"

  if [[ "${USE_TMUX:-false}" == "true" ]] && command -v tmux >/dev/null 2>&1 && tmux_session_exists "$session_name"; then
    echo "[$name] 停止 tmux 会话 $session_name"
    tmux kill-session -t "$session_name" 2>/dev/null || true
    rm -f "$pid_file"
    sleep 1
  fi

  if [[ ! -f "$pid_file" ]]; then
    if [[ "$adopt_listener" != "true" ]]; then
      echo "[$name] 未运行"
      return
    fi
    local bound_pid
    bound_pid="$(listener_pid "$port" || true)"
    if [[ -n "$bound_pid" ]] && service_matches_pid "$name" "$bound_pid"; then
      echo "[$name] 接管 pid=$bound_pid 后停止"
      echo "$bound_pid" >"$pid_file"
    elif [[ -n "$bound_pid" ]]; then
      echo "[$name] 未受管监听 pid=$bound_pid port=$port"
      return
    else
      echo "[$name] 未运行"
      return
    fi
  fi

  local pid
  pid="$(cat "$pid_file")"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    echo "[$name] 停止 pid=$pid"
    terminate_pid "$pid"
    if service_uses_supervisor "$name" && [[ -f "$child_pid_file" ]]; then
      local child_pid
      child_pid="$(cat "$child_pid_file")"
      if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
        echo "[$name] 停止 child=$child_pid"
        terminate_pid "$child_pid"
      fi
    fi
    local listener_now
    listener_now="$(listener_pid "$port" || true)"
    if [[ -n "$listener_now" ]] && service_matches_pid "$name" "$listener_now"; then
      echo "[$name] 停止 listener=$listener_now"
      terminate_pid "$listener_now"
    fi
    wait_for_port_free "$port" 10 || true
    echo "[$name] 已停止"
  else
    echo "[$name] 清理旧 pid"
  fi

  rm -f "$pid_file"
  if service_uses_supervisor "$name"; then
    rm -f "$child_pid_file"
  fi
}

check_service_status() {
  local name="$1"
  local port="${2:-$(service_port "$name")}"
  local pid_file child_pid_file health_url session_name pid=""
  pid_file="$(service_pid_file "$name")"
  child_pid_file="$(service_child_pid_file "$name")"
  health_url="$(service_health_url "$name" "$port")"
  session_name="$(service_session_name "$name")"

  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      local display_pid="$pid"
      local listener=""
      if service_uses_supervisor "$name" && [[ -f "$child_pid_file" ]]; then
        local child_pid
        child_pid="$(cat "$child_pid_file")"
        if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
          display_pid="$pid child=$child_pid"
        fi
      fi
      listener="$(listener_pid "$port" || true)"
      if [[ -n "$listener" ]] && service_matches_pid "$name" "$listener"; then
        if service_uses_supervisor "$name"; then
          display_pid="$display_pid listener=$listener"
        fi
        echo "[$name] 运行 pid=$display_pid port=$port health=$(health_text "$health_url")"
        return
      fi
      if is_healthy "$health_url"; then
        echo "[$name] 运行 pid=$display_pid port=$port health=$(health_text "$health_url")"
      elif service_is_starting "$pid" "$port"; then
        echo "[$name] 启动中 pid=$display_pid port=$port"
      else
        echo "[$name] 运行 pid=$display_pid port=$port health=$(health_text "$health_url")"
      fi
      return
    fi
    rm -f "$pid_file"
    echo "[$name] 清理旧 pid"
  fi

  if [[ "${USE_TMUX:-false}" == "true" ]] && command -v tmux >/dev/null 2>&1 && tmux_session_exists "$session_name"; then
    pid="$(listener_pid "$port" || true)"
    if [[ -n "$pid" ]]; then
      if [[ "${SERVICE_STATUS_ADOPT:-true}" == "true" ]]; then
        echo "$pid" >"$pid_file"
      fi
      echo "[$name] 运行 pid=$pid port=$port health=$(health_text "$health_url") tmux=$session_name"
    else
      echo "[$name] tmux=$session_name 存在，port=$port 无监听"
    fi
    return
  fi

  pid="$(listener_pid "$port" || true)"
  if [[ -n "$pid" ]]; then
    if service_matches_pid "$name" "$pid"; then
      if [[ "${SERVICE_STATUS_ADOPT:-true}" == "true" ]]; then
        echo "$pid" >"$pid_file"
      fi
      if service_is_starting "$pid" "$port"; then
        if [[ "${SERVICE_STATUS_ADOPT:-true}" == "true" ]]; then
          echo "[$name] 启动中 pid=$pid port=$port adopted=true"
        else
          echo "[$name] 启动中 pid=$pid port=$port detected=true"
        fi
      else
        if [[ "${SERVICE_STATUS_ADOPT:-true}" == "true" ]]; then
          echo "[$name] 运行 pid=$pid port=$port health=$(health_text "$health_url") adopted=true"
        else
          echo "[$name] 运行 pid=$pid port=$port health=$(health_text "$health_url") detected=true"
        fi
      fi
    else
      echo "[$name] 未受管 pid=$pid port=$port health=$(health_text "$health_url")"
    fi
    return
  fi

  echo "[$name] 未运行"
}
