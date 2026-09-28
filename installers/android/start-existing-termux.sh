#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

# Bridge for an existing private Termux installation. Public beta installs
# provide the managed `tmrw-start` launcher instead.
readonly termux_home='/data/data/com.termux/files/home'
readonly st_dir="$termux_home/SillyTavern"
readonly voice_start="$termux_home/.tmrw-voice/current/bin/START-TMRW-VOICE-SERVICES.sh"

if command -v tmrw-start >/dev/null 2>&1; then
  exec tmrw-start "$@"
fi

if [[ ! -f "$st_dir/start.sh" || ! -f "$voice_start" ]]; then
  echo 'ไม่พบ SillyTavern หรือแพ็กเสียงที่ติดตั้งไว้ เครื่องนี้ต้องติดตั้ง TMRW Phone ก่อน' >&2
  exit 1
fi

echo 'กำลังเปิดบริการเสียง TMRW…'
bash "$voice_start"

if curl --silent --output /dev/null --max-time 2 'http://127.0.0.1:8000/'; then
  echo 'เสียงพร้อมแล้ว และ SillyTavern เปิดอยู่แล้ว — กลับไปที่เบราว์เซอร์ได้เลย'
  exit 0
fi

echo 'เสียงพร้อมแล้ว กำลังเปิด SillyTavern…'
cd "$st_dir"
exec bash start.sh
