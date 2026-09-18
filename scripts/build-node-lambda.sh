#!/usr/bin/env bash
set -e

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Error: Missing arguments."
  echo "Usage: $0 <service-dir> <entrypoint-name>"
  echo "Example: $0 services/auth-stub authorizer"
  exit 1
fi

SERVICE_DIR="$1"
NAME="$2"
ORIGINAL_DIR="$(pwd)"

if [ ! -d "$SERVICE_DIR" ]; then
  echo "Error: Service directory '$SERVICE_DIR' does not exist."
  exit 1
fi

ENTRY_FILE="$SERVICE_DIR/src/${NAME}.ts"
if [ ! -f "$ENTRY_FILE" ]; then
  if [ -f "$SERVICE_DIR/src/index.ts" ]; then
    ENTRY_FILE="$SERVICE_DIR/src/index.ts"
  else
    echo "Error: Entrypoint file '$ENTRY_FILE' not found."
    exit 1
  fi
fi

echo "=== Building Node.js Lambda: $SERVICE_DIR ($NAME) ==="

TMP_BUILD_DIR="$SERVICE_DIR/.build_tmp"
rm -rf "$TMP_BUILD_DIR"
mkdir -p "$TMP_BUILD_DIR"

echo "1. Bundling TypeScript entrypoint ($ENTRY_FILE) with esbuild..."
if [ -f "$ORIGINAL_DIR/node_modules/.bin/esbuild" ]; then
  "$ORIGINAL_DIR/node_modules/.bin/esbuild" "$ENTRY_FILE" \
    --bundle \
    --platform=node \
    --target=node20 \
    --minify \
    --sourcemap=inline \
    --outfile="$TMP_BUILD_DIR/index.js"
else
  npx --yes esbuild "$ENTRY_FILE" \
    --bundle \
    --platform=node \
    --target=node20 \
    --minify \
    --sourcemap=inline \
    --outfile="$TMP_BUILD_DIR/index.js"
fi

if [ ! -f "$TMP_BUILD_DIR/index.js" ]; then
  echo "Error: esbuild failed to generate index.js."
  rm -rf "$TMP_BUILD_DIR"
  exit 1
fi

echo "2. Packaging into ${NAME}.zip..."
cd "$TMP_BUILD_DIR"
if command -v zip >/dev/null 2>&1; then
  zip -q "../${NAME}.zip" index.js
else
  tar -a -cf "../${NAME}.zip" index.js
fi
cd "$ORIGINAL_DIR"

rm -rf "$TMP_BUILD_DIR"

if [ -f "$SERVICE_DIR/${NAME}.zip" ]; then
  ZIP_SIZE=$(du -h "$SERVICE_DIR/${NAME}.zip" 2>/dev/null | cut -f1 || echo "created")
  echo "SUCCESS: Built $SERVICE_DIR/${NAME}.zip ($ZIP_SIZE)"
else
  echo "Error: Output zip $SERVICE_DIR/${NAME}.zip not found."
  exit 1
fi
