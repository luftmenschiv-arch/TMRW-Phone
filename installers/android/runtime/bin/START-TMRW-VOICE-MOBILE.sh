#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
source "$(dirname -- "$0")/environment.sh"
exec /data/data/com.termux/files/usr/bin/node "$TMRW_PACK_ROOT/tools/services.mjs" start-runtime
