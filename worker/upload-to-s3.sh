#!/bin/bash
# Upload docs/ to S3-compatible object storage
#
# Prerequisites:
#   - AWS CLI v2 installed (https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
#   - Configure credentials:
#       export AWS_ACCESS_KEY_ID="your-access-key"
#       export AWS_SECRET_ACCESS_KEY="your-secret-key"
#
# Usage:
#   ./upload-to-s3.sh                          # Upload all files
#   ./upload-to-s3.sh --delete                 # Sync and delete removed files
#   ./upload-to-s3.sh --dry-run                # Preview changes without uploading

set -euo pipefail

# ---- Configuration ----
S3_ENDPOINT="${S3_ENDPOINT:-https://s3.hi168.com}"
S3_BUCKET="${S3_BUCKET:-hi168-32227-8062svww}"
DOCS_DIR="$(cd "$(dirname "$0")/.." && pwd)/docs"

# ---- Argument Parsing ----
EXTRA_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --delete)
      EXTRA_ARGS+=("--delete")
      ;;
    --dry-run)
      EXTRA_ARGS+=("--dryrun")
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--delete] [--dry-run]"
      exit 1
      ;;
  esac
done

# ---- Validation ----
if [ ! -d "$DOCS_DIR" ]; then
  echo "Error: docs/ directory not found at $DOCS_DIR"
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
echo "  PvZ2 Gardendless - S3 Upload"
echo "============================================"
echo "  Endpoint:  $S3_ENDPOINT"
echo "  Bucket:    $S3_BUCKET"
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

aws s3 sync "$DOCS_DIR" "s3://$S3_BUCKET/" \
  --endpoint-url "$S3_ENDPOINT" \
  "${EXTRA_ARGS[@]}"

echo ""
echo "Upload complete!"
