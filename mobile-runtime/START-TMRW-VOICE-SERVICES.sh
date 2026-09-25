#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

readonly TERMUX_PREFIX='/data/data/com.termux/files/usr'
readonly TERMUX_HOME='/data/data/com.termux/files/home'
readonly VOICE_HOME="${TMRW_VOICE_HOME:-$TERMUX_HOME/.tmrw-voice}"
readonly MANAGER_HEALTH='http://127.0.0.1:18768/v1/health'
export HOME="$TERMUX_HOME"
export PREFIX="$TERMUX_PREFIX"
export PATH="$TERMUX_PREFIX/bin:${PATH:-/system/bin}"
if [[ -z "${TMRW_VOICE_PYTHON:-}" && -x "$TERMUX_HOME/genie-tts-portable/venv/bin/python" ]]; then
  export TMRW_VOICE_PYTHON="$TERMUX_HOME/genie-tts-portable/venv/bin/python"
fi

if ! "$TERMUX_PREFIX/bin/curl" --silent --fail --max-time 2 "$MANAGER_HEALTH" >/dev/null 2>&1; then
  if [[ -f "$VOICE_HOME/manager.pid" ]]; then
    prior_pid=$(<"$VOICE_HOME/manager.pid")
    if [[ "$prior_pid" =~ ^[0-9]+$ ]]; then
      "$TERMUX_PREFIX/bin/kill" "$prior_pid" 2>/dev/null || true
    fi
  fi
  "$TERMUX_PREFIX/bin/mkdir" -p "$VOICE_HOME/logs"
  GENIE_DATA_DIR="$TERMUX_HOME/genie-tts-portable/GenieData" \
  PYTHONPATH="$VOICE_HOME/current/tools:$TERMUX_HOME/genie-onnx-private/site-packages" \
  LD_LIBRARY_PATH="$TERMUX_HOME/genie-python313/data/data/com.termux/files/usr/lib:$TERMUX_HOME/genie-onnx-private/lib:$TERMUX_HOME/genie-tts-portable/venv/lib:$TERMUX_PREFIX/lib" \
  TMRW_VOICE_HOME="$VOICE_HOME" "$TERMUX_PREFIX/bin/nohup" \
    "$TERMUX_PREFIX/bin/node" "$VOICE_HOME/app/voice-manager/src/server.mjs" \
    >"$VOICE_HOME/logs/manager.log" 2>&1 </dev/null &
  echo $! > "$VOICE_HOME/manager.pid"
fi

for _ in $("$TERMUX_PREFIX/bin/seq" 1 20); do
  if "$TERMUX_PREFIX/bin/curl" --silent --fail --max-time 2 "$MANAGER_HEALTH" >/dev/null 2>&1; then
    break
  fi
  "$TERMUX_PREFIX/bin/sleep" 1
done

"$VOICE_HOME/current/bin/START-TMRW-VOICE-MOBILE.sh"
