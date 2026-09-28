# TMRW Phone — Public Beta

โทรศัพท์ของตัวละครใน SillyTavern · **0.1.0-beta.2 — ยังไม่ใช่ stable**

Repo นี้แจกเฉพาะ snapshot สำหรับผู้เล่น แยกจาก repo พัฒนา ไม่ได้เผยแพร่ทุกการแก้ระหว่างทำงาน

## ติดตั้ง Extension

1. สำรองข้อมูล SillyTavern ก่อนทดลอง beta ใช้ได้กับเครื่องที่มี SillyTavern อยู่แล้ว (ชุดตรวจล่าสุดใช้ 1.18.0)
2. เปิด **Extensions → Install extension** แล้ววางลิงก์นี้:

   ```text
   https://github.com/luftmenschiv-arch/SillyTavern-Extension-TMRW-Phone
   ```

3. ติดตั้งเสร็จ รีเฟรชหลังคำตอบที่กำลังสร้างจบ เปิดแชทตัวละคร แล้วเปิด TMRW Phone
4. ตั้ง API สำหรับสร้างคำตอบใน SillyTavern ตามปกติ ตัว Extension ไม่แถม API key หรือบริการโมเดลฟรี

**ถ้ามี TMRW Phone รุ่นพัฒนา/รุ่นเก่าอยู่แล้ว ห้ามเปิดสองชุดพร้อมกัน** ให้สำรองก่อนและใช้การควบคุม Extension ของ ST เพื่อปิดชุดเดิม ไม่ล้าง site data / IndexedDB เพื่อแก้ปัญหาการติดตั้ง การย้ายชุดเดิมบนเครื่องส่วนตัวไม่ใช่ขั้นตอนที่ผ่านการทดสอบใน release นี้

## เสียง: อะไรพร้อมแล้ว และอะไรยังไม่พร้อม

- พรีเซ็ทชื่อเดิม ชาย 12 + หญิง 12 พร้อม WAV ตัวอย่าง 48 ไฟล์
- เลือกอังกฤษแล้วฟังอังกฤษ เลือกญี่ปุ่นแล้วฟังญี่ปุ่น ทุกเสียงใช้ประโยคเดียวกันในภาษานั้น กดฟังไฟล์ที่เตรียมไว้ ไม่ต้องสร้างเสียงใหม่
- **เครื่องใหม่ยังใช้ Local Voice/โคลนเสียงไม่ได้ด้วยการติดตั้ง Extension อย่างเดียว** ต้องมี Voice Manager, runtime, โมเดล และเครื่องมือถอดเสียงเพิ่ม
- แพ็ก `tmrw-voice-companion-0.1.0-beta.2.tar.gz` ในหน้า Releases เป็นส่วนประกอบสำหรับเตรียมตัวติดตั้ง มีโปรไฟล์พรีเซ็ทและ Voice Manager **ไม่ใช่แพ็ก runtime/model ที่ครบสำหรับเปิดใช้งาน** และไม่ใช่ one-click installer
- ปุ่มดาวน์โหลด Local Voice ใน beta นี้แจ้งว่ายังไม่เปิดแจกแพ็ก แทนการพาไป repo private ที่ผู้เล่นโหลดไม่ได้ ส่วน runtime ที่ติดตั้งไว้แล้วไม่ได้ถูกปิด
- คุณภาพ/การออกเสียงของบางเสียงยังต้องเก็บงาน ไม่รับรองว่าทุกเสียงออกเสียงทุกภาษาได้สมบูรณ์

ดาวน์โหลดรุ่นที่ตรึงไว้: [Releases](https://github.com/luftmenschiv-arch/SillyTavern-Extension-TMRW-Phone/releases)

## TMRW—KeyFlow (ไม่บังคับ)

ใช้ [KeyFlow 1.5.1 หรือใหม่กว่า](https://github.com/luftmenschiv-arch/SillyTavern-Extension-TMRW-KeyFlow) ได้ ผลทดสอบแบบจำลองครอบคลุมการส่งคำขอโทรผ่าน ST, retry และ model fallback โดยไม่สร้างคำตอบซ้ำ เปิด Model fallback และตั้งรายการโมเดลสำรองใน KeyFlow หากต้องการฟังก์ชันนี้

การทดสอบนี้ **ไม่ใช่การรับรอง live API หรือทุกมือถือ** ถ้าผู้ให้บริการตอบ 503 ทุกโมเดล ยังโทรไม่สำเร็จได้ รายละเอียดอยู่ใน [สถานะการทดสอบ](QUALITY.md)

## อัปเดตและข้อมูลผู้เล่น

ตอนนี้ `auto_update: false` — **อัปเดตอัตโนมัติยังไม่เสร็จ** อย่าเข้าใจว่าเปิดใช้แล้ว
ระหว่างนี้ใช้การอัปเดต Extension ผ่าน ST หลังสำรองและรอให้งานจบ รุ่นเสียง/โมเดลจะมีวงจรอัปเดตแยกกันในขั้นถัดไป

Repo นี้ไม่มีแชท ประวัติโทร ไฟล์บันทึกเสียงผู้เล่น คีย์ API หรือเสียงที่ผู้เล่นโคลนส่วนตัว ไม่ต้องคัดลอก/อัปโหลดข้อมูลเหล่านี้มาเพื่ออัปเดต อย่าล้างข้อมูลเบราว์เซอร์ เพราะข้อมูล Phone บางส่วนอยู่ใน IndexedDB ของ origin เดิม

## งานถัดไป (ยังไม่เสร็จ)

- [ ] ขั้น 4: ตัวติดตั้ง Termux ครั้งเดียว + แพ็ก runtime/model สำหรับเครื่องใหม่ ตรวจพื้นที่และดาวน์โหลดต่อได้
- [ ] ขั้น 5: อัปเดตอัตโนมัติ แยกเวอร์ชัน Extension/เสียง และทดสอบไม่ทับข้อมูลผู้เล่น
- [ ] ทดสอบติดตั้งจริงบนเครื่องสะอาดและ coexistence กับ KeyFlow แบบ live
- [ ] เก็บการออกเสียงของบางพรีเซ็ท

แจ้งบั๊กพร้อมเวอร์ชัน ST/Extension และขั้นตอนทำซ้ำได้ที่ Issues **อย่าแนบ API key, settings ทั้งไฟล์ หรือแชทส่วนตัว**

## For maintainers

This is a curated distribution snapshot, not the development repository. The extension entry files are at the repository root so ST can install the URL directly. Development history, test fixtures, device captures, and personal data are not copied here.

Run `node scripts/verify-release.mjs` with Node.js 22+ to verify the exact tracked payload, hashes, import closure, 48 WAVs, renamed-folder preview resolution, and passive module import. `release.json` lists the component boundary and checksums. Voice companion assets are attached to the prerelease, not duplicated in Git history. Only promote a reviewed, tested snapshot to `main`; beta does not mean stable.
