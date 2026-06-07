#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/tmp/release}"
SKIP_BUILD="${SKIP_BUILD:-false}"
PACKAGE_NAME="k8s-aiops-manager-ubuntu"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/package-release.sh [options]

Options:
  --out-dir <dir>           Output directory, default tmp/release
  --skip-build              Package current build outputs without rebuilding
  -h, --help                Show help

Outputs:
  <out-dir>/k8s-aiops-manager-ubuntu.tar.gz
  <out-dir>/metadata.json
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out-dir)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[错误] 未知参数: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

require_cmd() {
  local cmd="$1" hint="${2:-$1}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[错误] 缺少命令: $cmd" >&2
    echo "下一步: 安装 $hint 后重试" >&2
    exit 1
  fi
}

copy_dir() {
  local src="$1" dst="$2"
  if [[ ! -d "$src" ]]; then
    echo "[错误] 缺少目录: $src" >&2
    exit 1
  fi
  mkdir -p "$dst"
  cp -a "$src"/. "$dst"/
}

require_release_layout() {
  local base="$1"
  [[ -f "$base/frontend/.next/standalone/server.js" ]] || { echo "[错误] 缺少 frontend standalone server"; exit 1; }
  [[ -d "$base/frontend/.next/standalone/.next/static" ]] || { echo "[错误] 缺少 frontend static"; exit 1; }
  [[ -f "$base/control-api/dist/src/main.js" ]] || { echo "[错误] 缺少 control-api dist"; exit 1; }
  [[ -x "$base/runtime-gateway/runtime-gateway" ]] || { echo "[错误] 缺少 runtime-gateway executable"; exit 1; }
}

require_cmd node "Node.js"
require_cmd npm "npm"
require_cmd go "Go"
require_cmd tar "tar"

mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
STAGE_DIR="$OUT_DIR/stage/$PACKAGE_NAME"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"/{frontend,control-api,runtime-gateway,env,deploy}

if [[ "$SKIP_BUILD" != "true" ]]; then
  echo "[build] frontend"
  (cd "$ROOT_DIR/frontend" && npm ci && npm run build:stable)
  echo "[build] control-api"
  (cd "$ROOT_DIR/backend/control-api" && npm ci && npx prisma generate && npm run build)
  echo "[build] runtime-gateway"
  (cd "$ROOT_DIR/backend/runtime-gateway" && CGO_ENABLED=0 GOOS="${GOOS:-linux}" GOARCH="${GOARCH:-amd64}" go build -trimpath -ldflags="-s -w" -o "$ROOT_DIR/tmp/runtime-gateway" ./cmd/runtime-gateway)
else
  echo "[build] skipped; using current build outputs"
fi

echo "[package] binary release layout"
copy_dir "$ROOT_DIR/frontend/.next/standalone" "$STAGE_DIR/frontend/.next/standalone"
mkdir -p "$STAGE_DIR/frontend/.next/standalone/.next"
copy_dir "$ROOT_DIR/frontend/.next/static" "$STAGE_DIR/frontend/.next/standalone/.next/static"
if [[ -d "$ROOT_DIR/frontend/public" ]]; then
  copy_dir "$ROOT_DIR/frontend/public" "$STAGE_DIR/frontend/public"
fi

copy_dir "$ROOT_DIR/backend/control-api/dist" "$STAGE_DIR/control-api/dist"
copy_dir "$ROOT_DIR/backend/control-api/prisma" "$STAGE_DIR/control-api/prisma"
copy_dir "$ROOT_DIR/backend/control-api/node_modules" "$STAGE_DIR/control-api/node_modules"

RUNTIME_BIN="$ROOT_DIR/tmp/runtime-gateway"
if [[ "$SKIP_BUILD" == "true" ]]; then
  RUNTIME_BIN="$ROOT_DIR/.release/runtime-gateway"
fi
install -m 0755 "$RUNTIME_BIN" "$STAGE_DIR/runtime-gateway/runtime-gateway"

cp -a "$ROOT_DIR/deploy/systemd" "$STAGE_DIR/deploy/systemd"
cp -a "$ROOT_DIR/scripts" "$STAGE_DIR/deploy/scripts"
cp "$ROOT_DIR/deploy/systemd/env/control-api.env.example" "$STAGE_DIR/env/control-api.env.example"
cp "$ROOT_DIR/deploy/systemd/env/runtime-gateway.env.example" "$STAGE_DIR/env/runtime-gateway.env.example"

cat > "$STAGE_DIR/metadata.json" <<EOF
{
  "name": "k8s-aiops-manager",
  "package": "$PACKAGE_NAME",
  "target": "ubuntu-systemd",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "gitCommit": "$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
}
EOF

require_release_layout "$STAGE_DIR"
tar -C "$OUT_DIR/stage" -czf "$OUT_DIR/k8s-aiops-manager-ubuntu.tar.gz" "$PACKAGE_NAME"

cp "$STAGE_DIR/metadata.json" "$OUT_DIR/metadata.json"

echo "✔ release packaged"
echo "  tar: $OUT_DIR/k8s-aiops-manager-ubuntu.tar.gz"
echo "  metadata: $OUT_DIR/metadata.json"
