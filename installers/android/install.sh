#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

readonly REPOSITORY_URL="${TMRW_PHONE_REPOSITORY_URL:-https://github.com/luftmenschiv-arch/TMRW-Phone-V3.git}"
readonly VOICE_HOME="${TMRW_VOICE_HOME:-$HOME/.tmrw-voice}"
readonly APP_DIR="$VOICE_HOME/app"

echo 'ติดตั้ง TMRW Local Voice สำหรับ Android…'
pkg update -y
pkg install -y nodejs-lts git python ffmpeg curl tar
mkdir -p "$VOICE_HOME"

if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" pull --ff-only
else
  rm -rf "$APP_DIR.partial"
  git clone --depth 1 "$REPOSITORY_URL" "$APP_DIR.partial"
  mv "$APP_DIR.partial" "$APP_DIR"
fi

mkdir -p "$VOICE_HOME/profiles/tmrw-male-core" "$VOICE_HOME/profiles/tmrw-female-core"
cp "$APP_DIR/voice-packs/profiles/tmrw-male-core.voiceprofile.npz" "$VOICE_HOME/profiles/tmrw-male-core/voice.voiceprofile.npz"
cp "$APP_DIR/voice-packs/profiles/tmrw-female-core.voiceprofile.npz" "$VOICE_HOME/profiles/tmrw-female-core/voice.voiceprofile.npz"
mkdir -p "$VOICE_HOME/current/tools" "$VOICE_HOME/current/bin" "$VOICE_HOME/current/catalog" "$VOICE_HOME/logs"
cp "$APP_DIR/voice-manager/tools/extract_voice_profile.py" "$VOICE_HOME/current/tools/"
cp "$APP_DIR/voice-manager/tools/transcribe.py" "$VOICE_HOME/current/tools/"
cp "$APP_DIR/voice-manager/tools/android_sitecustomize/sitecustomize.py" "$VOICE_HOME/current/tools/"
cp "$APP_DIR/mobile-runtime/START-TMRW-VOICE-MOBILE.sh" "$VOICE_HOME/current/bin/"
cp "$APP_DIR/mobile-runtime/STOP-TMRW-VOICE-MOBILE.sh" "$VOICE_HOME/current/bin/"
cp "$APP_DIR/mobile-runtime/START-TMRW-VOICE-SERVICES.sh" "$VOICE_HOME/current/bin/"
chmod 700 "$VOICE_HOME/current/bin/"*.sh
cp "$APP_DIR/voice-packs/catalog/presets.v1.json" "$VOICE_HOME/current/catalog/"
mkdir -p "$VOICE_HOME/current/stt"
if ! command -v whisper-cli >/dev/null 2>&1 && [[ ! -x "$VOICE_HOME/current/stt/whisper-cli" ]]; then
  if ! pkg install -y whisper-cpp; then
    echo 'แพ็กเกจ whisper.cpp ไม่มีใน mirror นี้ กำลังสร้างตัวถอดเสียง local…'
    pkg install -y cmake clang make
    WHISPER_SOURCE="$VOICE_HOME/whisper.cpp-v1.9.4"
    if [[ ! -d "$WHISPER_SOURCE/.git" ]]; then
      git clone --depth 1 --branch v1.9.4 https://github.com/ggml-org/whisper.cpp.git "$WHISPER_SOURCE"
    fi
    cmake -S "$WHISPER_SOURCE" -B "$WHISPER_SOURCE/build-tmrw" -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON
    cmake --build "$WHISPER_SOURCE/build-tmrw" --config Release --target whisper-cli -j 2
    cp "$WHISPER_SOURCE/build-tmrw/bin/whisper-cli" "$VOICE_HOME/current/stt/whisper-cli"
    chmod 700 "$VOICE_HOME/current/stt/whisper-cli"
  fi
fi
if [[ ! -s "$VOICE_HOME/current/stt/ggml-base-q5_1.bin" ]]; then
  curl -L --fail --retry 5 --retry-delay 5 --output "$VOICE_HOME/current/stt/ggml-base-q5_1.bin.partial" 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin'
  mv "$VOICE_HOME/current/stt/ggml-base-q5_1.bin.partial" "$VOICE_HOME/current/stt/ggml-base-q5_1.bin"
fi

if [[ -f "$HOME/TMRW-VOICE-GOLDEN-MASTER/golden-core/runtime/tmrw_call_runtime_v093_deadline_gate.py" ]]; then
  mkdir -p "$VOICE_HOME/current/runtime"
  node "$APP_DIR/dev/voice/patch-mobile-runtime.mjs" "$HOME/TMRW-VOICE-GOLDEN-MASTER/golden-core/runtime/tmrw_call_runtime_v093_deadline_gate.py" --output="$VOICE_HOME/current/runtime/tmrw_call_runtime_v093_deadline_gate.py"
  sha256sum "$VOICE_HOME/current/runtime/tmrw_call_runtime_v093_deadline_gate.py" | cut -d ' ' -f 1 > "$VOICE_HOME/current/.runtime.sha256"
  if [[ ! -e "$VOICE_HOME/current/model" ]]; then
    ln -s "$HOME/genie-tts-portable/CharacterModels/genie-v2proplus-base" "$VOICE_HOME/current/model"
  fi
  echo 'พบ runtime ที่ผ่านการปรับแต่งในเครื่องและสร้างสำเนาสำหรับ TMRW แล้ว'
fi

if [[ -f "$VOICE_HOME/manager.pid" ]]; then
  kill "$(cat "$VOICE_HOME/manager.pid")" 2>/dev/null || true
fi
GENIE_DATA_DIR="$HOME/genie-tts-portable/GenieData" \
PYTHONPATH="$VOICE_HOME/current/tools:$HOME/genie-onnx-private/site-packages" \
LD_LIBRARY_PATH="$HOME/genie-python313/data/data/com.termux/files/usr/lib:$HOME/genie-onnx-private/lib:$HOME/genie-tts-portable/venv/lib:$PREFIX/lib" \
TMRW_VOICE_HOME="$VOICE_HOME" nohup node "$APP_DIR/voice-manager/src/server.mjs" >"$VOICE_HOME/logs/manager.log" 2>&1 </dev/null &
echo $! > "$VOICE_HOME/manager.pid"

echo 'เสร็จแล้ว: เปิด TMRW Phone → Settings → Voice'
echo 'Voice Manager: http://127.0.0.1:18768/v1/health'
