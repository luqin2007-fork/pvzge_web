#!/bin/bash
# Upload docs/ to S3-compatible object storage using rclone
#
# Prerequisites:
#   - rclone installed (https://rclone.org/install/)
#   - Configure credentials:
#       export AWS_ACCESS_KEY_ID="your-access-key"
#       export AWS_SECRET_ACCESS_KEY="your-secret-key"
#
# Usage:
#   ./upload-to-s3.sh                          # Upload all files
#   ./upload-to-s3.sh --dry-run                # Preview changes without uploading

set -euo pipefail

# ---- Configuration ----
S3_ENDPOINT="${S3_ENDPOINT:-https://s3.hi168.com}"
S3_BUCKET="${S3_BUCKET:-hi168-32227-8062svww}"
S3_REGION="${S3_REGION:-us-east-1}"
DOCS_DIR="$(cd "$(dirname "$0")/.." && pwd)/docs"

# ---- Argument Parsing ----
EXTRA_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run)
      EXTRA_ARGS+=("--dry-run")
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--dry-run]"
      exit 1
      ;;
  esac
done

# ---- Validation ----
if [ ! -d "$DOCS_DIR" ]; then
  echo "Error: docs/ directory not found at $DOCS_DIR"
  exit 1
fi

if ! command -v rclone &> /dev/null; then
  echo "Error: rclone is not installed"
  echo "  Install: curl https://rclone.org/install.sh | sudo bash"
  exit 1
fi

if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  echo "Error: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set"
  echo ""
  echo "  export AWS_ACCESS_KEY_ID='your-access-key'"
  echo "  export AWS_SECRET_ACCESS_KEY='your-secret-key'"
  exit 1
fi

FILE_COUNT=$(find "$DOCS_DIR" -type f | wc -l)
TOTAL_SIZE=$(du -sh "$DOCS_DIR" | cut -f1)

echo "============================================"
echo "  PvZ2 Gardendless - S3 Upload (rclone)"
echo "============================================"
echo "  Endpoint:  $S3_ENDPOINT"
echo "  Bucket:    $S3_BUCKET"
echo "  Region:    $S3_REGION"
echo "  Source:    $DOCS_DIR"
echo "  Files:     $FILE_COUNT"
echo "  Size:      $TOTAL_SIZE"
echo "  Options:   ${EXTRA_ARGS[*]:-none}"
echo "============================================"
echo ""

read -p "Continue? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "Uploading to s3://$S3_BUCKET/ ..."
echo ""

# Configure rclone via environment variables
export RCLONE_CONFIG_S3_TYPE=s3
export RCLONE_CONFIG_S3_PROVIDER=Other
export RCLONE_CONFIG_S3_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID"
export RCLONE_CONFIG_S3_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_S3_ENDPOINT="$S3_ENDPOINT"
export RCLONE_CONFIG_S3_REGION="$S3_REGION"

rclone sync "$DOCS_DIR" "s3:$S3_BUCKET/" \
  --transfers 16 \
  --checkers 32 \
  --s3-no-check-bucket \
  --no-update-modtime \
  -v \
  "${EXTRA_ARGS[@]}"

echo ""
echo "Upload complete!"
