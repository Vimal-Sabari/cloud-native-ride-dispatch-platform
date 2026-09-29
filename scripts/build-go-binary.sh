#!/usr/bin/env bash
set -e

# ==============================================================================
# Build Plain Go Binary
# ==============================================================================
# Builds a standalone Go binary for EC2 or local OS process execution.
# Distinct from build-go-lambda.sh: no zipping or bootstrap renaming is performed.
#
# Usage:
#   scripts/build-go-binary.sh <service-dir> <cmd-subdir> <output-path>
# Example:
#   scripts/build-go-binary.sh services/matching-service matching-service bin/matching-service
# ==============================================================================

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

if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
  echo "Error: Missing arguments."
  echo "Usage: $0 <service-dir> <cmd-subdir> <output-path>"
  echo "Example: $0 services/matching-service matching-service bin/matching-service"
  exit 1
fi

SERVICE_DIR="$1"
CMD_SUBDIR="$2"
OUTPUT_PATH="$3"

ORIGINAL_DIR="$(pwd)"

if [ ! -d "$SERVICE_DIR" ]; then
  echo "Error: Service directory '$SERVICE_DIR' does not exist."
  exit 1
fi

if [ ! -d "$SERVICE_DIR/cmd/$CMD_SUBDIR" ]; then
  echo "Error: Command directory '$SERVICE_DIR/cmd/$CMD_SUBDIR' does not exist."
  exit 1
fi

# Convert relative output path to absolute before changing directory
if [[ "$OUTPUT_PATH" != /* ]] && [[ "$OUTPUT_PATH" != [A-Za-z]:* ]]; then
  OUTPUT_PATH="$ORIGINAL_DIR/$OUTPUT_PATH"
fi

# Ensure target directory exists
mkdir -p "$(dirname "$OUTPUT_PATH")"

TARGET_OS="${GOOS:-linux}"
TARGET_ARCH="${GOARCH:-amd64}"

echo "=== Building Plain Go Binary ==="
echo "Service:    $SERVICE_DIR/cmd/$CMD_SUBDIR"
echo "Target OS:  $TARGET_OS / $TARGET_ARCH"
echo "Output:     $OUTPUT_PATH"

cd "$SERVICE_DIR"
GOOS="$TARGET_OS" GOARCH="$TARGET_ARCH" CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$OUTPUT_PATH" "./cmd/$CMD_SUBDIR"
cd "$ORIGINAL_DIR"

if [ -f "$OUTPUT_PATH" ] || [ -f "${OUTPUT_PATH}.exe" ]; then
  echo "SUCCESS: Built $OUTPUT_PATH"
else
  echo "Error: Output binary '$OUTPUT_PATH' was not found after build."
  exit 1
fi
