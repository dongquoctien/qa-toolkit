#!/usr/bin/env bash
# Convenience shim around package-extension.mjs.
#
# Usage:
#   ./scripts/package-extension.sh           # version from manifest.json
#   ./scripts/package-extension.sh 0.2.0     # override version
set -euo pipefail
exec node "$(dirname "$0")/package-extension.mjs" "$@"
