#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

readonly TERMUX_PREFIX='/data/data/com.termux/files/usr'
readonly TERMUX_HOME='/data/data/com.termux/files/home'
readonly WORKSPACE="${TMRW_VOICE_WORKSPACE:-$TERMUX_HOME/genie-tts-portable}"
readonly RUNTIME="$WORKSPACE/tmrw_call_runtime_v093_deadline_gate.py"
readonly STATE_DIR="$TERMUX_HOME/.tmrw-phone-runtime"
readonly PID_FILE="$STATE_DIR/mobile-voice.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo 'TMRW Voice Mobile is not managed by this launcher.'
  exit 0
fi

runtime_pid=$(<"$PID_FILE")
if [[ ! "$runtime_pid" =~ ^[0-9]+$ ]]; then
  echo 'Invalid Mobile runtime PID file; refusing to signal any process.' >&2
  exit 1
fi

if "$TERMUX_PREFIX/bin/kill" -0 "$runtime_pid" 2>/dev/null; then
  command_line=$("$TERMUX_PREFIX/bin/tr" '\0' ' ' <"/proc/$runtime_pid/cmdline")
  if [[ "$command_line" != *"$RUNTIME"* ]]; then
    echo 'PID does not belong to the approved Mobile runtime; refusing to stop it.' >&2
    exit 1
  fi
  "$TERMUX_PREFIX/bin/kill" "$runtime_pid"
  for _ in $("$TERMUX_PREFIX/bin/seq" 1 10); do
    "$TERMUX_PREFIX/bin/kill" -0 "$runtime_pid" 2>/dev/null || break
    "$TERMUX_PREFIX/bin/sleep" 1
  done
fi

"$TERMUX_PREFIX/bin/rm" -f "$PID_FILE"
echo 'TMRW Voice Mobile stopped.'
