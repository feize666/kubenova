#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 3 ]]; then
  echo "usage: dev-supervise.sh <name> <child-pid-file> <command>" >&2
  exit 2
fi

name="$1"
child_pid_file="$2"
cmd="$3"

restart_max="${DEV_SUPERVISE_RESTART_MAX:-50}"
restart_delay="${DEV_SUPERVISE_RESTART_DELAY:-2}"
restart_delay_max="${DEV_SUPERVISE_RESTART_DELAY_MAX:-20}"

child_pid=""
stopping="false"
restart_count=0

timestamp() {
  date "+%Y-%m-%d %H:%M:%S"
}

stop_child() {
  if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
    kill -- "-$child_pid" 2>/dev/null || kill "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
}

on_signal() {
  stopping="true"
  echo "[$(timestamp)] [$name] supervisor stopping"
  stop_child
  rm -f "$child_pid_file"
  exit 0
}

trap on_signal TERM INT

while true; do
  echo "[$(timestamp)] [$name] starting"
  if command -v setsid >/dev/null 2>&1; then
    setsid bash -lc "$cmd" &
  else
    bash -lc "$cmd" &
  fi
  child_pid="$!"
  echo "$child_pid" >"$child_pid_file"

  set +e
  wait "$child_pid"
  status="$?"
  set -e
  rm -f "$child_pid_file"

  if [[ "$stopping" == "true" ]]; then
    exit 0
  fi

  restart_count=$((restart_count + 1))
  echo "[$(timestamp)] [$name] exited status=$status restart=$restart_count/$restart_max"
  if (( restart_count >= restart_max )); then
    echo "[$(timestamp)] [$name] restart limit reached" >&2
    exit "$status"
  fi

  sleep_for=$((restart_delay * restart_count))
  if (( sleep_for > restart_delay_max )); then
    sleep_for="$restart_delay_max"
  fi
  sleep "$sleep_for"
done
