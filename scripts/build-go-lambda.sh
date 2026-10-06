#!/usr/bin/env bash
set -e

if ! command -v go >/dev/null 2>&1; then
  if [ -d "/c/Program Files/Go/bin" ]; then
    export PATH="/c/Program Files/Go/bin:$PATH"
  elif [ -d "/mnt/c/Program Files/Go/bin" ]; then
    export PATH="/mnt/c/Program Files/Go/bin:$PATH"
  fi
fi

if ! command -v go >/dev/null 2>&1 && command -v go.exe >/dev/null 2>&1; then
  go() {
    go.exe "$@"
  }
fi

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Error: Missing arguments."
  echo "Usage: $0 <service-dir> <cmd-subdir>"
  echo "Example: $0 services/location-service update-location"
  exit 1
fi

SERVICE_DIR="$1"
CMD_SUBDIR="$2"
ORIGINAL_DIR="$(pwd)"

if [ ! -d "$SERVICE_DIR" ]; then
  echo "Error: Service directory '$SERVICE_DIR' does not exist."
  exit 1
fi

if [ ! -d "$SERVICE_DIR/cmd/$CMD_SUBDIR" ]; then
  echo "Error: Command directory '$SERVICE_DIR/cmd/$CMD_SUBDIR' does not exist."
  exit 1
fi

echo "=== Building Go Lambda: $SERVICE_DIR/cmd/$CMD_SUBDIR ==="

cd "$SERVICE_DIR"

echo "1. Compiling Go binary for linux/amd64 (provided.al2023)..."
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bootstrap "./cmd/$CMD_SUBDIR"

if [ ! -f bootstrap ]; then
  echo "Error: Failed to produce bootstrap binary."
  cd "$ORIGINAL_DIR"
  exit 1
fi

echo "2. Packaging bootstrap into ${CMD_SUBDIR}.zip..."
if command -v zip >/dev/null 2>&1; then
  zip -q "${CMD_SUBDIR}.zip" bootstrap
elif python3 -c "import sys" >/dev/null 2>&1; then
  python3 -m zipfile -c "${CMD_SUBDIR}.zip" bootstrap
elif python -c "import sys" >/dev/null 2>&1; then
  python -m zipfile -c "${CMD_SUBDIR}.zip" bootstrap
elif py -c "import sys" >/dev/null 2>&1; then
  py -m zipfile -c "${CMD_SUBDIR}.zip" bootstrap
elif command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe -NoProfile -Command "Compress-Archive -Path 'bootstrap' -DestinationPath '${CMD_SUBDIR}.zip' -Force"
else
  tar -a -cf "${CMD_SUBDIR}.zip" bootstrap
fi

echo "3. Cleaning up temporary bootstrap binary..."
rm -f bootstrap

cd "$ORIGINAL_DIR"

if [ -f "$SERVICE_DIR/${CMD_SUBDIR}.zip" ]; then
  ZIP_SIZE=$(du -h "$SERVICE_DIR/${CMD_SUBDIR}.zip" 2>/dev/null | cut -f1 || echo "created")
  echo "SUCCESS: Built $SERVICE_DIR/${CMD_SUBDIR}.zip ($ZIP_SIZE)"
else
  echo "Error: Output zip $SERVICE_DIR/${CMD_SUBDIR}.zip not found."
  exit 1
fi
