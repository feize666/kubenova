#!/usr/bin/env bash

service_lib_init() {
  : "${ROOT_DIR:?ROOT_DIR must be set before sourcing _service-lib.sh}"
  : "${RUN_DIR:=$ROOT_DIR/.run}"
  : "${SERVICE_PID_SUFFIX:=}"
  : "${SERVICE_LOG_SUFFIX:=}"
  : "${SERVICE_STATUS_ADOPT:=true}"
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
  echo "kubenova-${name}"
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

process_ppid() {
  local pid="$1"
  ps -p "$pid" -o ppid= 2>/dev/null | tr -d '[:space:]' || true
}

path_is_under() {
  local path="$1" parent="$2"
  [[ -n "$path" && -n "$parent" ]] || return 1
  [[ "$path" == "$parent" || "$path" == "$parent/"* ]]
}

pid_is_current_script() {
  local pid="$1"
  [[ "$pid" == "$$" || "$pid" == "${BASHPID:-}" || "$pid" == "${PPID:-}" ]]
}

service_scope_matches() {
  local name="$1" pid="$2"
  local dir cwd cmdline
  dir="$(service_dir "$name" 2>/dev/null || true)"
  cwd="$(process_cwd "$pid")"
  cmdline="$(process_cmdline "$pid")"

  if [[ -n "$dir" ]]; then
    if path_is_under "$cwd" "$dir" || [[ "$cmdline" == *"$dir/"* ]]; then
      return 0
    fi
  fi

  if [[ "$name" == "frontend" ]]; then
    [[ "$cmdline" == *"$ROOT_DIR/scripts/dev-supervise.sh frontend"* ]]
    return
  fi

  return 1
}

frontend_cmd_matches() {
  local cmdline="$1"
  [[ "$cmdline" == *"dev-supervise.sh frontend"* || "$cmdline" == *"next-server"* || "$cmdline" == *"frontend/.next/standalone/server.js"* || "$cmdline" == *"next/dist/bin/next start"* || "$cmdline" == *"next/dist/bin/next dev"* || "$cmdline" == *".next/standalone/server.js"* ]]
}

control_api_cmd_matches() {
  local cmdline="$1"
  [[ "$cmdline" == *"/backend/control-api/dist/"* || "$cmdline" == *"dist/src/main.js"* || "$cmdline" == *"nest start --watch"* || "$cmdline" == *"@nestjs/cli"* || "$cmdline" == *"start:dev"* ]]
}

runtime_gateway_cmd_matches() {
  local cmdline="$1"
  [[ "$cmdline" == *"runtime-gateway"* || "$cmdline" == *"cmd/runtime-gateway"* || "$cmdline" == *"go run ./cmd/runtime-gateway"* ]]
}

is_runtime_gateway_process() {
  local pid="$1"
  local cmdline
  cmdline="$(process_cmdline "$pid")"
  service_scope_matches "runtime-gateway" "$pid" && runtime_gateway_cmd_matches "$cmdline"
}

is_frontend_process() {
  local pid="$1"
  local cmdline
  cmdline="$(process_cmdline "$pid")"
  service_scope_matches "frontend" "$pid" && frontend_cmd_matches "$cmdline"
}

is_frontend_standalone_process() {
  local pid="$1"
  local cwd
  cwd="$(process_cwd "$pid")"
  [[ "$cwd" == *"/frontend/.next/standalone"* || "$cwd" == *"/.next/standalone"* ]]
}

is_control_api_process() {
  local pid="$1"
  local cmdline
  cmdline="$(process_cmdline "$pid")"
  service_scope_matches "control-api" "$pid" && control_api_cmd_matches "$cmdline"
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

service_related_process() {
  local name="$1" pid="$2"
  local cmdline
  pid_is_current_script "$pid" && return 1
  service_scope_matches "$name" "$pid" || return 1
  cmdline="$(process_cmdline "$pid")"

  case "$name" in
    frontend)
      frontend_cmd_matches "$cmdline" || [[ "$cmdline" == *"node"* || "$cmdline" == *"npm"* || "$cmdline" == *"npx"* || "$cmdline" == *"bash -lc"* || "$cmdline" == *"sh -c"* ]]
      ;;
    control-api)
      control_api_cmd_matches "$cmdline" || [[ "$cmdline" == *"node"* || "$cmdline" == *"npm"* || "$cmdline" == *"npx"* || "$cmdline" == *"nest"* || "$cmdline" == *"bash -lc"* || "$cmdline" == *"sh -c"* ]]
      ;;
    runtime-gateway)
      runtime_gateway_cmd_matches "$cmdline" || [[ "$cmdline" == *"go run"* || "$cmdline" == *"/tmp/go-build"* || "$cmdline" == *"bash -lc"* || "$cmdline" == *"sh -c"* ]]
      ;;
    *)
      return 1
      ;;
  esac
}

pid_in_list() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

append_related_pid() {
  local name="$1" pid="$2"
  shift 2
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  service_related_process "$name" "$pid" || return 1
  pid_in_list "$pid" "$@" && return 1
  echo "$pid"
}

collect_service_related_pids() {
  local name="$1"
  shift
  local related=()
  local seed child parent idx current appended

  for seed in "$@"; do
    [[ -n "$seed" ]] || continue
    appended="$(append_related_pid "$name" "$seed" "${related[@]}" || true)"
    [[ -n "$appended" ]] && related+=("$appended")

    parent="$(process_ppid "$seed")"
    while [[ -n "$parent" && "$parent" != "0" && "$parent" != "1" ]]; do
      appended="$(append_related_pid "$name" "$parent" "${related[@]}" || true)"
      [[ -n "$appended" ]] || break
      related+=("$appended")
      parent="$(process_ppid "$parent")"
    done
  done

  idx=0
  while (( idx < ${#related[@]} )); do
    current="${related[$idx]}"
    while read -r child; do
      [[ -n "$child" ]] || continue
      appended="$(append_related_pid "$name" "$child" "${related[@]}" || true)"
      [[ -n "$appended" ]] && related+=("$appended")
    done < <(pgrep -P "$current" 2>/dev/null || true)
    idx=$((idx + 1))
  done

  if (( ${#related[@]} > 0 )); then
    printf '%s\n' "${related[@]}"
  fi
}

service_stale_pids() {
  local name="$1"
  local candidate
  local related=()
  local pids=()
  while read -r candidate; do
    [[ -n "$candidate" ]] || continue
    pid_is_current_script "$candidate" && continue
    service_matches_pid "$name" "$candidate" || continue
    mapfile -t related < <(collect_service_related_pids "$name" "$candidate")
    local pid
    for pid in "${related[@]}"; do
      pid_in_list "$pid" "${pids[@]}" || pids+=("$pid")
    done
  done < <(ps -eo pid= 2>/dev/null | tr -d ' ')
  if (( ${#pids[@]} > 0 )); then
    printf '%s\n' "${pids[@]}"
  fi
}

join_pids() {
  local IFS=","
  echo "$*"
}

format_rss_kib() {
  local rss_kib="${1:-0}"
  awk -v rss="$rss_kib" 'BEGIN {
    if (rss >= 1048576) {
      printf "%.1fGiB", rss / 1048576
    } else {
      printf "%.0fMiB", rss / 1024
    }
  }'
}

process_resources_text() {
  local pids=("$@")
  local pid cpu rss line
  local total_cpu="0.0"
  local total_rss=0
  local live=0

  for pid in "${pids[@]}"; do
    [[ -n "$pid" ]] || continue
    line="$(ps -p "$pid" -o %cpu=,rss= 2>/dev/null || true)"
    [[ -n "$line" ]] || continue
    read -r cpu rss <<<"$line"
    [[ -n "${cpu:-}" && -n "${rss:-}" ]] || continue
    total_cpu="$(awk -v a="$total_cpu" -v b="$cpu" 'BEGIN { printf "%.1f", a + b }')"
    total_rss=$((total_rss + rss))
    live=$((live + 1))
  done

  if (( live == 0 )); then
    return 0
  fi
  echo "pids=$live cpu=${total_cpu}% rss=$(format_rss_kib "$total_rss")"
}

service_mode_text() {
  local name="$1"
  shift || true
  local pid cmdline cwd

  case "$name" in
    frontend)
      for pid in "$@"; do
        [[ -n "$pid" ]] || continue
        cmdline="$(process_cmdline "$pid")"
        cwd="$(process_cwd "$pid")"
        if [[ "$cmdline" == *"next dev"* || "$cmdline" == *"dev-supervise.sh frontend"* ]]; then
          echo "mode=dev"
          return
        fi
        if [[ "$cmdline" == *".next/standalone/server.js"* || "$cwd" == *"/frontend/.next/standalone"* || "$cwd" == *"/.next/standalone"* ]]; then
          echo "mode=stable"
          return
        fi
      done
      echo "mode=${FRONTEND_BOOT_MODE:-dev}"
      ;;
    control-api)
      for pid in "$@"; do
        [[ -n "$pid" ]] || continue
        cmdline="$(process_cmdline "$pid")"
        if [[ "$cmdline" == *"nest start --watch"* || "$cmdline" == *"@nestjs/cli"* ]]; then
          echo "mode=dev"
          return
        fi
        if [[ "$cmdline" == *"dist/src/main.js"* || "$cmdline" == *"/backend/control-api/dist/"* ]]; then
          echo "mode=stable"
          return
        fi
      done
      [[ -n "${CONTROL_API_BOOT_MODE:-}" ]] && echo "mode=$CONTROL_API_BOOT_MODE"
      ;;
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
      local stale_pids=()
      mapfile -t stale_pids < <(service_stale_pids "$name")
      if (( ${#stale_pids[@]} > 0 )); then
        local stale_pid
        echo "[$name] 清理无监听残留 pids=$(join_pids "${stale_pids[@]}")"
        for stale_pid in "${stale_pids[@]}"; do
          terminate_pid "$stale_pid"
        done
        echo "[$name] 已停止"
      else
        echo "[$name] 未运行"
      fi
      return
    fi
  fi

  local pid
  pid="$(cat "$pid_file")"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    if ! service_related_process "$name" "$pid"; then
      echo "[$name] pid=$pid 不匹配服务范围，仅清理 pid 文件"
      rm -f "$pid_file"
      if service_uses_supervisor "$name"; then
        rm -f "$child_pid_file"
      fi
      return
    fi

    local stop_pids=()
    local seed_pids=("$pid")
    if service_uses_supervisor "$name" && [[ -f "$child_pid_file" ]]; then
      local child_pid
      child_pid="$(cat "$child_pid_file")"
      [[ -n "$child_pid" ]] && seed_pids+=("$child_pid")
    fi
    local listener_now
    listener_now="$(listener_pid "$port" || true)"
    [[ -n "$listener_now" ]] && service_matches_pid "$name" "$listener_now" && seed_pids+=("$listener_now")

    mapfile -t stop_pids < <(collect_service_related_pids "$name" "${seed_pids[@]}")
    echo "[$name] 停止 pids=$(join_pids "${stop_pids[@]}")"
    local stop_pid
    for stop_pid in "${stop_pids[@]}"; do
      terminate_pid "$stop_pid"
    done

    mapfile -t stop_pids < <(service_stale_pids "$name")
    if (( ${#stop_pids[@]} > 0 )); then
      echo "[$name] 清理无监听残留 pids=$(join_pids "${stop_pids[@]}")"
      for stop_pid in "${stop_pids[@]}"; do
        terminate_pid "$stop_pid"
      done
    fi

    wait_for_port_free "$port" 10 || true
    echo "[$name] 已停止"
  else
    echo "[$name] 清理旧 pid"
    local stale_pids=()
    mapfile -t stale_pids < <(service_stale_pids "$name")
    if (( ${#stale_pids[@]} > 0 )); then
      local stale_pid
      echo "[$name] 清理无监听残留 pids=$(join_pids "${stale_pids[@]}")"
      for stale_pid in "${stale_pids[@]}"; do
        terminate_pid "$stale_pid"
      done
      echo "[$name] 已停止"
    fi
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
      if ! service_related_process "$name" "$pid"; then
        rm -f "$pid_file"
        if service_uses_supervisor "$name"; then
          rm -f "$child_pid_file"
        fi
        echo "[$name] 清理旧 pid"
      else
      local display_pid="$pid"
      local listener=""
      local status_pids=("$pid")
      local status_resources=""
      local mode_text=""
      if service_uses_supervisor "$name" && [[ -f "$child_pid_file" ]]; then
        local child_pid
        child_pid="$(cat "$child_pid_file")"
        if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
          display_pid="$pid child=$child_pid"
          status_pids+=("$child_pid")
        fi
      fi
      listener="$(listener_pid "$port" || true)"
      if [[ -n "$listener" ]] && service_matches_pid "$name" "$listener"; then
        status_pids+=("$listener")
        if service_uses_supervisor "$name"; then
          display_pid="$display_pid listener=$listener"
        fi
        mapfile -t status_pids < <(collect_service_related_pids "$name" "${status_pids[@]}")
        status_resources="$(process_resources_text "${status_pids[@]}")"
        mode_text="$(service_mode_text "$name" "${status_pids[@]}")"
        echo "[$name] 运行 pid=$display_pid port=$port health=$(health_text "$health_url")${mode_text:+ $mode_text}${status_resources:+ $status_resources}"
        return
      fi
      mapfile -t status_pids < <(collect_service_related_pids "$name" "${status_pids[@]}")
      status_resources="$(process_resources_text "${status_pids[@]}")"
      mode_text="$(service_mode_text "$name" "${status_pids[@]}")"
      if is_healthy "$health_url"; then
        echo "[$name] 运行 pid=$display_pid port=$port health=$(health_text "$health_url")${mode_text:+ $mode_text}${status_resources:+ $status_resources}"
      elif service_is_starting "$pid" "$port"; then
        echo "[$name] 启动中 pid=$display_pid port=$port${mode_text:+ $mode_text}${status_resources:+ $status_resources}"
      else
        echo "[$name] 运行 pid=$display_pid port=$port health=$(health_text "$health_url")${mode_text:+ $mode_text}${status_resources:+ $status_resources}"
      fi
      return
      fi
    fi
    if [[ -f "$pid_file" ]]; then
      rm -f "$pid_file"
      echo "[$name] 清理旧 pid"
    fi
  fi

  if [[ "${USE_TMUX:-false}" == "true" ]] && command -v tmux >/dev/null 2>&1 && tmux_session_exists "$session_name"; then
    pid="$(listener_pid "$port" || true)"
    if [[ -n "$pid" ]]; then
      if [[ "${SERVICE_STATUS_ADOPT:-true}" == "true" ]]; then
        echo "$pid" >"$pid_file"
      fi
      local tmux_resources tmux_mode tmux_pids=()
      mapfile -t tmux_pids < <(collect_service_related_pids "$name" "$pid")
      tmux_resources="$(process_resources_text "${tmux_pids[@]}")"
      tmux_mode="$(service_mode_text "$name" "${tmux_pids[@]}")"
      echo "[$name] 运行 pid=$pid port=$port health=$(health_text "$health_url") tmux=$session_name${tmux_mode:+ $tmux_mode}${tmux_resources:+ $tmux_resources}"
    else
      echo "[$name] tmux=$session_name 存在，port=$port 无监听"
    fi
    return
  fi

  pid="$(listener_pid "$port" || true)"
  if [[ -n "$pid" ]]; then
    if service_matches_pid "$name" "$pid"; then
      local detected_resources detected_mode detected_pids=()
      mapfile -t detected_pids < <(collect_service_related_pids "$name" "$pid")
      detected_resources="$(process_resources_text "${detected_pids[@]}")"
      detected_mode="$(service_mode_text "$name" "${detected_pids[@]}")"
      if [[ "${SERVICE_STATUS_ADOPT:-true}" == "true" ]]; then
        echo "$pid" >"$pid_file"
      fi
      if service_is_starting "$pid" "$port"; then
        if [[ "${SERVICE_STATUS_ADOPT:-true}" == "true" ]]; then
          echo "[$name] 启动中 pid=$pid port=$port adopted=true${detected_mode:+ $detected_mode}${detected_resources:+ $detected_resources}"
        else
          echo "[$name] 启动中 pid=$pid port=$port detected=true${detected_mode:+ $detected_mode}${detected_resources:+ $detected_resources}"
        fi
      else
        if [[ "${SERVICE_STATUS_ADOPT:-true}" == "true" ]]; then
          echo "[$name] 运行 pid=$pid port=$port health=$(health_text "$health_url") adopted=true${detected_mode:+ $detected_mode}${detected_resources:+ $detected_resources}"
        else
          echo "[$name] 运行 pid=$pid port=$port health=$(health_text "$health_url") detected=true${detected_mode:+ $detected_mode}${detected_resources:+ $detected_resources}"
        fi
      fi
    else
      local unmanaged_resources unmanaged_mode
      unmanaged_resources="$(process_resources_text "$pid")"
      unmanaged_mode="$(service_mode_text "$name" "$pid")"
      echo "[$name] 未受管 pid=$pid port=$port health=$(health_text "$health_url") scope=external${unmanaged_mode:+ $unmanaged_mode}${unmanaged_resources:+ $unmanaged_resources}"
    fi
    return
  fi

  local stale_pids=()
  mapfile -t stale_pids < <(service_stale_pids "$name")
  if (( ${#stale_pids[@]} > 0 )); then
    local stale_resources stale_mode
    stale_resources="$(process_resources_text "${stale_pids[@]}")"
    stale_mode="$(service_mode_text "$name" "${stale_pids[@]}")"
    echo "[$name] 残留 pids=$(join_pids "${stale_pids[@]}") port=$port no-listener=true${stale_mode:+ $stale_mode}${stale_resources:+ $stale_resources}"
    return
  fi

  local stopped_mode
  stopped_mode="$(service_mode_text "$name")"
  echo "[$name] 未运行${stopped_mode:+ $stopped_mode}"
}
