#!/usr/bin/env bash

load_dev_env_defaults() {
  local file line key value
  local files=(
    "$ROOT_DIR/.env"
    "$ROOT_DIR/backend/control-api/.env"
    "$ROOT_DIR/frontend/.env.local"
  )

  for file in "${files[@]}"; do
    [[ -f "$file" ]] || continue
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ -n "$line" ]] || continue
      [[ "$line" =~ ^[[:space:]]*# ]] && continue
      key="${line%%=*}"
      value="${line#*=}"
      key="${key#"${key%%[![:space:]]*}"}"
      key="${key%"${key##*[![:space:]]}"}"
      [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
      [[ -z "${!key+x}" ]] || continue
      value="${value%$'\r'}"
      if [[ "$value" =~ ^\".*\"$ || "$value" =~ ^\'.*\'$ ]]; then
        value="${value:1:-1}"
      fi
      printf -v "$key" '%s' "$value"
      export "$key"
    done <"$file"
  done

  : "${DATABASE_URL:=postgresql://k8s_aiops:k8s_aiops_dev@localhost:5432/k8s_aiops}"
  : "${REDIS_URL:=redis://localhost:6379}"
  : "${JWT_SECRET:=dev-secret-please-change-in-production}"
  : "${JWT_EXPIRES_IN:=15m}"
  : "${REFRESH_TOKEN_EXPIRES_IN:=7d}"
  : "${RUNTIME_GATEWAY_BASE_URL:=ws://localhost:4100}"
  : "${RUNTIME_TOKEN_SECRET:=dev-runtime-token-secret}"
  : "${SWAGGER_ENABLED:=true}"
  : "${CORS_ORIGINS:=http://localhost:3000}"
  : "${DEFAULT_ADMIN_EMAIL:=admin@local.dev}"
  : "${DEFAULT_ADMIN_PASSWORD:=admin123456}"
  : "${NEXT_PUBLIC_CONTROL_API_BASE:=http://localhost:4000}"

  export DATABASE_URL REDIS_URL JWT_SECRET JWT_EXPIRES_IN REFRESH_TOKEN_EXPIRES_IN
  export RUNTIME_GATEWAY_BASE_URL RUNTIME_TOKEN_SECRET SWAGGER_ENABLED CORS_ORIGINS
  export DEFAULT_ADMIN_EMAIL DEFAULT_ADMIN_PASSWORD NEXT_PUBLIC_CONTROL_API_BASE
}
