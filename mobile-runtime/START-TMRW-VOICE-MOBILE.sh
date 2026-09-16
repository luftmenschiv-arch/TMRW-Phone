#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

readonly EXPECTED_RUNTIME_SHA256='f7b8b334300bb5d7aa3a5963c92e98647250f1f25ae3b46457c86a7f81b38dfd'
readonly TERMUX_PREFIX='/data/data/com.termux/files/usr'
readonly TERMUX_HOME='/data/data/com.termux/files/home'
readonly WORKSPACE="${TMRW_VOICE_WORKSPACE:-$TERMUX_HOME/genie-tts-portable}"
readonly RUNTIME="$WORKSPACE/tmrw_call_runtime_v093_deadline_gate.py"
readonly PYTHON="$WORKSPACE/venv/bin/python"
readonly STATE_DIR="$TERMUX_HOME/.tmrw-phone-runtime"
readonly PID_FILE="$STATE_DIR/mobile-voice.pid"
readonly OUT_LOG="$STATE_DIR/mobile-voice.out.log"
readonly ERR_LOG="$STATE_DIR/mobile-voice.err.log"
readonly HEALTH_URL='http://127.0.0.1:18769/health'

health_ready() {
  "$TERMUX_PREFIX/bin/curl" --silent --show-error --fail --max-time 2 "$HEALTH_URL" 2>/dev/null \
    | "$TERMUX_PREFIX/bin/grep" -Eq '"ready"[[:space:]]*:[[:space:]]*true'
}

if health_ready; then
  echo 'TMRW Voice Mobile is already READY at http://127.0.0.1:18769'
  exit 0
fi

if [[ ! -f "$RUNTIME" || ! -x "$PYTHON" ]]; then
  echo "TMRW Voice Mobile installation is incomplete under $WORKSPACE" >&2
  exit 1
fi

actual_sha256=$("$TERMUX_PREFIX/bin/sha256sum" "$RUNTIME" | "$TERMUX_PREFIX/bin/cut" -d ' ' -f 1)
if [[ "$actual_sha256" != "$EXPECTED_RUNTIME_SHA256" ]]; then
  echo "Refusing unapproved Mobile runtime: $actual_sha256" >&2
  exit 1
fi

"$TERMUX_PREFIX/bin/mkdir" -p "$STATE_DIR"

if [[ -f "$PID_FILE" ]]; then
  prior_pid=$(<"$PID_FILE")
  if [[ "$prior_pid" =~ ^[0-9]+$ ]] && "$TERMUX_PREFIX/bin/kill" -0 "$prior_pid" 2>/dev/null; then
    echo "TMRW Voice Mobile is still starting (PID $prior_pid)."
  else
    "$TERMUX_PREFIX/bin/rm" -f "$PID_FILE"
  fi
fi

if [[ ! -f "$PID_FILE" ]]; then
  export PREFIX="$TERMUX_PREFIX"
  export PATH="$TERMUX_PREFIX/bin:${PATH:-/system/bin}"
  export GENIE_DATA_DIR="$WORKSPACE/GenieData"
  export PYTHONPATH="$TERMUX_HOME/genie-onnx-private/site-packages"
  export LD_LIBRARY_PATH="$TERMUX_HOME/genie-python313/data/data/com.termux/files/usr/lib:$TERMUX_HOME/genie-onnx-private/lib:$WORKSPACE/venv/lib:$TERMUX_PREFIX/lib"
  export TMRW_VOICE_HOST='127.0.0.1'
  export TMRW_VOICE_PORT='18769'

  cd "$WORKSPACE"
  "$TERMUX_PREFIX/bin/nohup" "$PYTHON" "$RUNTIME" >"$OUT_LOG" 2>"$ERR_LOG" </dev/null &
  runtime_pid=$!
  echo "$runtime_pid" >"$PID_FILE"
  echo "Starting approved TMRW Voice Mobile (PID $runtime_pid)..."
fi

for _ in $("$TERMUX_PREFIX/bin/seq" 1 180); do
  if health_ready; then
    echo 'READY: http://127.0.0.1:18769'
    exit 0
  fi
  runtime_pid=$(<"$PID_FILE")
  if ! "$TERMUX_PREFIX/bin/kill" -0 "$runtime_pid" 2>/dev/null; then
    echo "TMRW Voice Mobile exited before READY. See $ERR_LOG" >&2
    exit 1
  fi
  "$TERMUX_PREFIX/bin/sleep" 1
done

echo "TMRW Voice Mobile did not become READY within 180 seconds. See $OUT_LOG and $ERR_LOG" >&2
exit 1
