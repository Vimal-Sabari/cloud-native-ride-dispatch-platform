#!/usr/bin/env bash
set -e

# ==============================================================================
# Build Node.js Lambda Artifact
# ==============================================================================
# Usage:
#   bash scripts/build-node-lambda.sh <service-dir> <entry-file> <output-name>
#
# Examples:
#   bash scripts/build-node-lambda.sh services/trip-service src/handlers/request-ride-entry.ts request-ride
#   bash scripts/build-node-lambda.sh services/auth-stub src/authorizer.ts authorizer
# ==============================================================================

if [ "$#" -lt 2 ]; then
  echo "Error: Missing arguments."
  echo "Usage: $0 <service-dir> <entry-file> <output-name>"
  echo "   or: $0 <service-dir> <entrypoint-name>"
  exit 1
fi

# Ensure node is available if running in environments where only node.exe is present
if ! command -v node >/dev/null 2>&1; then
  if command -v node.exe >/dev/null 2>&1; then
    mkdir -p /tmp/node-bin 2>/dev/null || true
    ln -sf "$(command -v node.exe)" /tmp/node-bin/node 2>/dev/null || true
    export PATH="/tmp/node-bin:$PATH"
  fi
fi

SERVICE_DIR="$1"
ORIGINAL_DIR="$(pwd)"

if [ ! -d "$SERVICE_DIR" ]; then
  echo "Error: Service directory '$SERVICE_DIR' does not exist."
  exit 1
fi

if [ "$#" -ge 3 ]; then
  ENTRY_REL="$2"
  OUTPUT_NAME="$3"
  ENTRY_FILE="$SERVICE_DIR/$ENTRY_REL"
else
  # Backward compatibility for 2-argument calls (e.g. services/auth-stub authorizer)
  OUTPUT_NAME="$2"
  if [ -f "$SERVICE_DIR/src/${OUTPUT_NAME}.ts" ]; then
    ENTRY_FILE="$SERVICE_DIR/src/${OUTPUT_NAME}.ts"
  elif [ -f "$SERVICE_DIR/src/index.ts" ]; then
    ENTRY_FILE="$SERVICE_DIR/src/index.ts"
  else
    ENTRY_FILE="$SERVICE_DIR/$2"
  fi
fi

if [ ! -f "$ENTRY_FILE" ]; then
  echo "Error: Entrypoint file '$ENTRY_FILE' not found."
  exit 1
fi

echo "=== Building Node.js Lambda: $OUTPUT_NAME ==="
echo "Service:    $SERVICE_DIR"
echo "Entrypoint: $ENTRY_FILE"

DIST_DIR="$SERVICE_DIR/dist/$OUTPUT_NAME"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

OUT_JS="$DIST_DIR/index.js"
OUT_ZIP="$SERVICE_DIR/${OUTPUT_NAME}.zip"
rm -f "$OUT_ZIP"

# Ensure shared workspace dependencies are compiled before bundling
if [ ! -f "$ORIGINAL_DIR/shared/models/ts/dist/index.js" ] && [ -d "$ORIGINAL_DIR/shared/models/ts" ]; then
  npm run build --workspace=@ride-dispatch/models --prefix="$ORIGINAL_DIR" >/dev/null 2>&1 || true
fi
if [ ! -f "$ORIGINAL_DIR/shared/dynamo-client/ts/dist/index.js" ] && [ -d "$ORIGINAL_DIR/shared/dynamo-client/ts" ]; then
  npm run build --workspace=@ride-dispatch/dynamo-client --prefix="$ORIGINAL_DIR" >/dev/null 2>&1 || true
fi
if [ ! -f "$ORIGINAL_DIR/shared/auth/ts/dist/index.js" ] && [ -d "$ORIGINAL_DIR/shared/auth/ts" ]; then
  npm run build --workspace=@ride-dispatch/auth --prefix="$ORIGINAL_DIR" >/dev/null 2>&1 || true
fi
if [ ! -f "$ORIGINAL_DIR/shared/sns-client/ts/dist/index.js" ] && [ -d "$ORIGINAL_DIR/shared/sns-client/ts" ]; then
  npm run build --workspace=@ride-dispatch/sns-client --prefix="$ORIGINAL_DIR" >/dev/null 2>&1 || true
fi
if [ ! -f "$ORIGINAL_DIR/shared/logging/ts/dist/index.js" ] && [ -d "$ORIGINAL_DIR/shared/logging/ts" ]; then
  npm run build --workspace=@ride-dispatch/logging --prefix="$ORIGINAL_DIR" >/dev/null 2>&1 || true
fi

echo "1. Bundling with esbuild (Node 20, platform node)..."
if npx --yes esbuild "$ENTRY_FILE" \
  --bundle \
  --platform=node \
  --target=node20 \
  --minify \
  --sourcemap=inline \
  --outfile="$OUT_JS"; then
  :
elif [ -f "$ORIGINAL_DIR/node_modules/.bin/esbuild" ]; then
  "$ORIGINAL_DIR/node_modules/.bin/esbuild" "$ENTRY_FILE" \
    --bundle \
    --platform=node \
    --target=node20 \
    --minify \
    --sourcemap=inline \
    --outfile="$OUT_JS"
fi

if [ ! -f "$OUT_JS" ]; then
  echo "Error: esbuild failed to generate $OUT_JS."
  exit 1
fi

echo "2. Packaging into ${OUTPUT_NAME}.zip..."
cd "$DIST_DIR"
if command -v zip >/dev/null 2>&1; then
  zip -q "../../${OUTPUT_NAME}.zip" index.js
elif command -v tar >/dev/null 2>&1; then
  tar -a -cf "../../${OUTPUT_NAME}.zip" index.js
elif command -v python3 >/dev/null 2>&1; then
  python3 -m zipfile -c "../../${OUTPUT_NAME}.zip" index.js
elif command -v python >/dev/null 2>&1; then
  python -m zipfile -c "../../${OUTPUT_NAME}.zip" index.js
fi
cd "$ORIGINAL_DIR"

if [ -f "$OUT_ZIP" ]; then
  ZIP_SIZE=$(du -h "$OUT_ZIP" 2>/dev/null | cut -f1 || echo "created")
  echo "SUCCESS: Built $OUT_ZIP ($ZIP_SIZE)"
else
  echo "Error: Output zip $OUT_ZIP was not created."
  exit 1
fi
