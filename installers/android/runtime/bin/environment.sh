#!/data/data/com.termux/files/usr/bin/bash
# Source only from the pack's own launchers, not from a user's shell startup file.
TMRW_PACK_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export TMRW_VOICE_HOME="${TMRW_VOICE_HOME:-/data/data/com.termux/files/home/.tmrw-voice}"
export PYTHONHOME="$TMRW_PACK_ROOT/python"
export PYTHONPATH="$TMRW_PACK_ROOT/tools:$TMRW_PACK_ROOT/onnx/site-packages:$TMRW_PACK_ROOT/python/site-packages"
export PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1
export LD_LIBRARY_PATH="$TMRW_PACK_ROOT/lib:$TMRW_PACK_ROOT/python/lib:/data/data/com.termux/files/usr/lib"
export GENIE_DATA_DIR="$TMRW_PACK_ROOT/GenieData"
export TMRW_VOICE_MODEL="$TMRW_PACK_ROOT/model"
export TMRW_VOICE_CATALOG="$TMRW_PACK_ROOT/catalog/presets.v1.json"
export TMRW_VOICE_PROFILE="$TMRW_VOICE_HOME/profiles/tmrw-male-core/voice.voiceprofile.npz"
export TMRW_VOICE_PYTHON="$TMRW_PACK_ROOT/bin/python"
export TMRW_STT_MODEL="$TMRW_PACK_ROOT/stt/ggml-base-q5_1.bin"
export TMRW_WHISPER_CLI="$TMRW_PACK_ROOT/stt/whisper-cli"
export PATH="/data/data/com.termux/files/usr/bin:$PATH"
