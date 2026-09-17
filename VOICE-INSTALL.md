# TMRW Local Voice

Local Voice is the default path. Fish Audio remains an optional external provider for users who prefer a paid hosted service.

## Android / Termux

Run one command in Termux:

```sh
curl -fsSL https://raw.githubusercontent.com/luftmenschiv-arch/TMRW-Phone-V3/main/installers/android/install.sh | bash
```

The installer updates Termux packages, installs Voice Manager, FFmpeg, whisper.cpp, and the multilingual `base-q5_1` speech-to-text model. If the optimized phone runtime already exists, it creates a separately verified TMRW copy without changing the original. A fresh device downloads the large TTS runtime/model from Settings → Voice.

After installation:

1. Open TMRW Phone → Settings → Voice.
2. Tap **ตรวจอีกครั้ง**.
3. Tap **ติดตั้ง Local Voice** if the runtime pack is not installed yet.
4. Choose one of 12 male or 12 female presets for each character, or upload a clip to create a character-specific clone.

For cloning, TMRW converts the uploaded audio, transcribes English or Japanese locally, and opens the detected text for optional correction. The user is not asked to type a transcript first.

## Windows

Download `Install-TMRW-Voice.ps1`, then run it from PowerShell. It installs the Voice Manager as a per-user logon task. No administrator account is required for the manager itself.

## Release maintainer

Build a checked, 16 MiB-part runtime pack:

```sh
node dev/voice/build-release-pack.mjs --source=/clean/runtime --output=voice-release --id=tmrw-local-voice-android-arm64 --platform=android-arm64 --base-url=https://github.com/luftmenschiv-arch/TMRW-Phone-V3/releases/download/voice-v1.0.0/
```

The clean runtime source should contain `runtime/`, `model/`, `venv/`, and any required `GenieData/`. The builder adds the startup scripts, preset catalog, base profiles, clone tools, and per-runtime checksum automatically.

Upload `pack-index.json` and every generated part to the same GitHub Release. The manager verifies every part and the reconstructed archive before atomically replacing an installed pack. The in-app installer currently expects the latest release asset at `releases/latest/download/pack-index.json`.
