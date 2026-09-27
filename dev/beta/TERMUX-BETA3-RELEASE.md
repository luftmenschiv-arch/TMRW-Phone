# TMRW Phone 0.1.0-beta.3 + Local Voice 1.0.0-beta.1

รุ่น beta สำหรับผู้เล่น Android arm64 ที่มี SillyTavern ใน Termux อยู่แล้ว
ยังไม่ใช่ stable และไม่ได้แถม API key/บริการสร้างคำตอบฟรี

## ติดตั้งพร้อมระบบเสียง

เตรียมพื้นที่ว่าง **4 GiB** แล้ววางใน Termux ครั้งเดียว:

```bash
curl -fL --proto '=https' https://github.com/luftmenschiv-arch/SillyTavern-Extension-TMRW-Phone/releases/download/v0.1.0-beta.3/install.sh -o "$TMPDIR/tmrw-install.sh" && bash "$TMPDIR/tmrw-install.sh"
```

ไม่ต้องลง Extension ผ่านปุ่ม ST ก่อน ตัวติดตั้งจะลงรุ่นที่ตรึงไว้ให้เอง ถ้า ST
ไม่ได้อยู่ที่ `~/SillyTavern` เติม `--st=/พาธจริง/SillyTavern` ท้ายคำสั่ง bash
ครั้งต่อไปเปิด Termux แล้วใช้ `tmrw-start` หรือ `tmrw-start --voice-only`

- พรีเซ็ทชาย 12 + หญิง 12 ชื่อเดิม พร้อมตัวอย่างอังกฤษ/ญี่ปุ่น 48 WAV
- โมเดลและ runtime ครบ แบ่งดาวน์โหลดเป็นส่วน ตรวจ hash และใช้ส่วนที่โหลดครบแล้วเมื่อรันซ้ำ
- Python ส่วนตัว ไม่ลดเวอร์ชัน Python ของ Termux และไม่ลง ST ทับ
- ตรวจพื้นที่/แพ็ก/การทำงานก่อนเปิดใช้ ไม่ทับเสียงที่ผู้เล่นโคลนเอง
- ไม่เปิดซ้อนกับ Phone รุ่นเก่า และไม่เปลี่ยน checkout ที่มีไฟล์แก้ไข
- เก็บส่วนดาวน์โหลดที่ตรวจแล้วไว้เป็นแคช: แพ็กประมาณ 780 MB; ไฟล์ใช้งานประมาณ
  1.16 GB; มีแคชและพื้นที่ชั่วคราวเพิ่มเติม จึงให้เตรียม 4 GiB
- `auto_update` ยังเป็น false — อัปเดตอัตโนมัติเป็นงานขั้น 5

## ผลตรวจและข้อจำกัด

เทสต์อัตโนมัติ 64/64 ผ่าน พร้อมการติดตั้งแยกบน Realme RMX3370 / Android 13:
อังกฤษและญี่ปุ่น สร้างเสียง ถอดเสียง โคลนเสียง และเปิด runtime กลับได้ ทดสอบลงซ้ำ
โดยโปรไฟล์ 31 ไฟล์ ประวัติจำลองและ active pointer ไม่เปลี่ยน

ยังไม่ใช่การรับรองทุกมือถือหรือเครื่องที่เพิ่งลง Android/Termux ใหม่ทั้งหมด
มือถือทดสอบมี system dependencies อยู่ก่อนแล้ว และไม่ได้ทดสอบ live API ทุกผู้ให้บริการ
ตรวจไฟล์ release บน GitHub ครบ 52 ไฟล์ ขนาดและ SHA-256 ตรงกันทั้งหมด และลอง
ดาวน์โหลด bootstrap/installer/index จากลิงก์ public โดยไม่ใช้บัญชีสำเร็จ ติดตั้ง
Extension ตรงรุ่นบนสาขา main พร้อมระบบเสียงทำงานและข้อมูลจำลองยังอยู่ครบ
การตรวจรอบสุดท้ายใช้ archive โมเดลที่ตรวจแล้วจากแคช ไม่ใช่โหลด 780 MB ใหม่ทั้งหมด
503 จากผู้ให้บริการยังเกิดได้ เปิด Termux ค้างระหว่างใช้งาน; Android อาจหยุดงานเบื้องหลัง

ห้ามล้าง site data / IndexedDB / แชทเพื่อข้ามคำเตือนการติดตั้ง รุ่นเก่าหรือชุดทดลอง
ส่วนตัวต้องมีขั้นตอนย้ายแยก ไม่ควรฝืนลงทับ

Third-party notices, Python-SoXR/libsoxr source and build inputs accompany the
runtime pack. Unused readline/gdbm native modules are excluded. Individual
components retain their own license terms; see the pack's NOTICE.md.

## Assets

`install.sh` is the pinned bootstrap. `installer.tar.gz` contains its installer
code. `install-index.json` pins the public extension commit and all runtime part
hashes. `runtime.part-*` are consumed automatically; users do not need to join
them manually. `SHA256SUMS.txt` lists release asset checksums. The extension zip
is optional for maintainers; it does not by itself install the voice runtime.
