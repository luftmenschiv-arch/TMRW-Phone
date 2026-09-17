#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

readonly GOLDEN_RUNTIME_SHA256='f7b8b334300bb5d7aa3a5963c92e98647250f1f25ae3b46457c86a7f81b38dfd'
readonly TERMUX_PREFIX='/data/data/com.termux/files/usr'
readonly TERMUX_HOME='/data/data/com.termux/files/home'
readonly SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
readonly PACK_ROOT="$(dirname -- "$SCRIPT_DIR")"
readonly WORKSPACE="${TMRW_VOICE_WORKSPACE:-$TERMUX_HOME/genie-tts-portable}"
readonly GOLDEN_RUNTIME="$TERMUX_HOME/TMRW-VOICE-GOLDEN-MASTER/golden-core/runtime/tmrw_call_runtime_v093_deadline_gate.py"
readonly CURRENT_RUNTIME="$TERMUX_HOME/.tmrw-voice/current/runtime/tmrw_call_runtime_v093_deadline_gate.py"
readonly PACK_RUNTIME="$PACK_ROOT/runtime/tmrw_call_runtime_v093_deadline_gate.py"
readonly RUNTIME="${TMRW_VOICE_RUNTIME:-$([[ -f "$PACK_RUNTIME" ]] && printf '%s' "$PACK_RUNTIME" || { [[ -f "$CURRENT_RUNTIME" ]] && printf '%s' "$CURRENT_RUNTIME" || { [[ -f "$GOLDEN_RUNTIME" ]] && printf '%s' "$GOLDEN_RUNTIME" || printf '%s' "$WORKSPACE/tmrw_call_runtime_v093_deadline_gate.py"; }; })}"
readonly PACK_PYTHON="$PACK_ROOT/venv/bin/python"
readonly PYTHON="${TMRW_VOICE_PYTHON:-$([[ -x "$PACK_PYTHON" ]] && printf '%s' "$PACK_PYTHON" || printf '%s' "$WORKSPACE/venv/bin/python")}"
readonly MODEL="${TMRW_VOICE_MODEL:-$([[ -d "$PACK_ROOT/model" ]] && printf '%s' "$PACK_ROOT/model" || printf '%s' "$WORKSPACE/CharacterModels/genie-v2proplus-base")}"
readonly GENIE_DATA="${TMRW_GENIE_DATA_DIR:-$([[ -d "$PACK_ROOT/GenieData" ]] && printf '%s' "$PACK_ROOT/GenieData" || printf '%s' "$WORKSPACE/GenieData")}"
readonly CATALOG="${TMRW_VOICE_CATALOG:-$([[ -f "$PACK_ROOT/catalog/presets.v1.json" ]] && printf '%s' "$PACK_ROOT/catalog/presets.v1.json" || printf '%s' "$TERMUX_HOME/.tmrw-voice/current/catalog/presets.v1.json")}"
readonly RUNTIME_WORKDIR="$([[ "$RUNTIME" == "$PACK_RUNTIME" ]] && printf '%s' "$PACK_ROOT" || printf '%s' "$WORKSPACE")"
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
if [[ "$RUNTIME" == "$GOLDEN_RUNTIME" ]]; then
  expected_runtime_sha256="$GOLDEN_RUNTIME_SHA256"
elif [[ -f "$PACK_ROOT/.runtime.sha256" ]]; then
  expected_runtime_sha256=$("$TERMUX_PREFIX/bin/tr" -d '[:space:]' < "$PACK_ROOT/.runtime.sha256")
elif [[ -f "$TERMUX_HOME/.tmrw-voice/current/.runtime.sha256" ]]; then
  expected_runtime_sha256=$("$TERMUX_PREFIX/bin/tr" -d '[:space:]' < "$TERMUX_HOME/.tmrw-voice/current/.runtime.sha256")
else
  expected_runtime_sha256=''
fi
if [[ -z "$expected_runtime_sha256" || "$actual_sha256" != "$expected_runtime_sha256" ]]; then
  echo "Refusing an unverified TMRW Voice runtime: $actual_sha256" >&2
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
  export HOME="$TERMUX_HOME"
  export PREFIX="$TERMUX_PREFIX"
  export PATH="$TERMUX_PREFIX/bin:${PATH:-/system/bin}"
  export GENIE_DATA_DIR="$GENIE_DATA"
  export PYTHONPATH="$PACK_ROOT/tools:$TERMUX_HOME/.tmrw-voice/current/tools:$TERMUX_HOME/genie-onnx-private/site-packages"
  export LD_LIBRARY_PATH="$TERMUX_HOME/genie-python313/data/data/com.termux/files/usr/lib:$TERMUX_HOME/genie-onnx-private/lib:$PACK_ROOT/venv/lib:$WORKSPACE/venv/lib:$TERMUX_PREFIX/lib"
  export TMRW_VOICE_HOST='127.0.0.1'
  export TMRW_VOICE_PORT='18769'
  export TMRW_VOICE_HOME="${TMRW_VOICE_HOME:-$TERMUX_HOME/.tmrw-voice}"
  export TMRW_VOICE_MODEL="$MODEL"
  export TMRW_VOICE_CATALOG="$CATALOG"
  export TMRW_VOICE_PROFILE="${TMRW_VOICE_PROFILE:-$TERMUX_HOME/.tmrw-voice/profiles/tmrw-male-core/voice.voiceprofile.npz}"

  cd "$RUNTIME_WORKDIR"
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
  if [[ ! -f "$PID_FILE" ]]; then
    echo 'TMRW Voice Mobile startup was stopped.' >&2
    exit 1
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
