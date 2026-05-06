#!/usr/bin/env bash
# Package the Chrome extension into a ZIP for distribution / Chrome Web Store.
#
# Uses `git ls-files` so only TRACKED files are included — no .DS_Store, no
# stray .tmp dirs, no untracked node_modules, no IDE crud.
#
# Usage:
#   ./scripts/package-extension.sh                 # version from manifest.json
#   ./scripts/package-extension.sh 0.2.0           # override version
#
# Output:
#   dist/qa-annotator-extension-v<version>.zip

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f manifest.json ]; then
  echo "✗ manifest.json not found at $REPO_ROOT — run from a checkout of the qa-annotator-extension repo." >&2
  exit 1
fi

# Read version from manifest.json (or override from $1)
if [ "${1:-}" != "" ]; then
  VERSION="$1"
else
  VERSION="$(node -e "console.log(require('./manifest.json').version)")"
fi

if [ -z "$VERSION" ]; then
  echo "✗ Could not determine extension version." >&2
  exit 1
fi

DIST_DIR="dist"
ZIP_NAME="qa-annotator-extension-v${VERSION}.zip"
ZIP_PATH="${DIST_DIR}/${ZIP_NAME}"

# Files that belong in the extension ZIP.
# We list them explicitly rather than `git ls-files` because we want to EXCLUDE
# things like the plugin/ folder, planning docs, and dev scripts.
INCLUDE_PATHS=(
  manifest.json
  src
  assets
  README.md
)

# Verify everything tracked.
for p in "${INCLUDE_PATHS[@]}"; do
  if ! git ls-files --error-unmatch -- "$p" > /dev/null 2>&1; then
    if [ ! -e "$p" ]; then
      echo "✗ $p does not exist." >&2
      exit 1
    fi
    echo "⚠ $p exists but is not tracked by git — including anyway." >&2
  fi
done

mkdir -p "$DIST_DIR"
rm -f "$ZIP_PATH"

# zip recursively, excluding common junk just in case.
zip -r "$ZIP_PATH" "${INCLUDE_PATHS[@]}" \
  -x "*.DS_Store" \
  -x "*Thumbs.db" \
  -x "*/.git/*" \
  -x "*/node_modules/*" > /dev/null

SIZE_KB="$(du -k "$ZIP_PATH" | awk '{print $1}')"

echo
echo "✓ Packaged $ZIP_PATH (${SIZE_KB} KB)"
echo
echo "Contents:"
unzip -l "$ZIP_PATH" | tail -n +4 | head -n -2 | awk '{ printf "  %s  %s\n", $1, $4 }' | head -40
echo "  ..."
echo
echo "Next steps:"
echo "  Manual install:    chrome://extensions → Developer mode → Load unpacked → unzipped folder"
echo "  Web Store upload:  https://chrome.google.com/webstore/devconsole → New item → upload $ZIP_PATH"
