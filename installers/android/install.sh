#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
# Release tooling replaces these pins only after package qualification.
readonly RELEASE_BASE='@RELEASE_BASE@'
readonly INSTALLER_SHA256='@INSTALLER_SHA256@'
readonly INDEX_SHA256='@INDEX_SHA256@'
if [[ "$RELEASE_BASE" == @* || "$INSTALLER_SHA256" == @* || "$INDEX_SHA256" == @* ]]; then
  echo 'ตัวติดตั้งนี้ยังเป็น source template ไม่ใช่รุ่นแจก กรุณาใช้คำสั่งจาก release ที่ผ่านการตรวจแล้ว' >&2
  exit 1
fi
[[ "${PREFIX:-}" == /data/data/com.termux/files/usr && "$(uname -m)" == aarch64 ]] || { echo 'ต้องใช้ Termux มาตรฐานบน Android 64-bit (arm64)' >&2; exit 1; }
echo 'TMRW Phone + Local Voice (beta) — ไม่ลบแชท ไม่แทนที่ ST และไม่ลง Python ทับของเดิม'
packages=()
for program in git curl tar ffmpeg; do
  command -v "$program" >/dev/null || packages+=("$program")
done
[[ -f "$PREFIX/lib/libsndfile.so" ]] || packages+=(libsndfile)
if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  packages+=(nodejs-lts)
fi
if (( ${#packages[@]} )); then
  pkg update -y
  pkg install -y "${packages[@]}"
else
  echo 'ใช้เครื่องมือ Termux ที่มีอยู่แล้ว ไม่อัปเกรดแพ็กเกจระบบที่ไม่จำเป็น'
fi
readonly WORK_DIR="$(mktemp -d "${TMPDIR:-$PREFIX/tmp}/tmrw-installer.XXXXXXXX")"
# Keep this small diagnostic directory on error; model parts use persistent cache.
trap 'echo "ติดตั้งยังไม่ครบ ดูข้อความด้านบนแล้วรันคำสั่งเดิมซ้ำได้ ส่วนโมเดลที่ตรวจแล้วจะไม่โหลดซ้ำ (ไฟล์ตรวจสอบ: $WORK_DIR)" >&2' ERR
curl --proto '=https' --tlsv1.2 --fail --location --retry 3 --connect-timeout 20 --output "$WORK_DIR/installer.tar.gz" "$RELEASE_BASE/installer.tar.gz"
printf '%s  %s\n' "$INSTALLER_SHA256" "$WORK_DIR/installer.tar.gz" | sha256sum --check --status
curl --proto '=https' --tlsv1.2 --fail --location --retry 3 --connect-timeout 20 --output "$WORK_DIR/install-index.json" "$RELEASE_BASE/install-index.json"
printf '%s  %s\n' "$INDEX_SHA256" "$WORK_DIR/install-index.json" | sha256sum --check --status
tar -xzf "$WORK_DIR/installer.tar.gz" -C "$WORK_DIR" --no-same-owner --no-same-permissions
node "$WORK_DIR/installer/setup.mjs" "--index=$WORK_DIR/install-index.json" "--index-sha256=$INDEX_SHA256" "$@"
