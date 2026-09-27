import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { autoUpdate, atomicJson } from './auto-update.mjs';
import { acquireLock } from './download.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await fs.readFile(path.join(here, 'config.json'), 'utf8'));
const action = process.argv[2] || 'start';
if (!['start', '--voice-only', '--stop-voice', '--update-only', '--updates-off', '--updates-on'].includes(action)) throw new Error('Use tmrw-start [--voice-only | --stop-voice | --update-only | --updates-off | --updates-on]');
function child(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { stdio: 'inherit', ...options });
    p.once('error', reject); p.once('exit', code => code === 0 ? resolve() : reject(new Error(`process-exited:${code}`)));
  });
}
const unlock = await acquireLock(path.join(config.root, 'start.lock'));
try {
if (['--updates-off', '--updates-on'].includes(action)) {
  await atomicJson(path.join(config.root, 'update-settings.json'), { enabled: action === '--updates-on' });
  console.log(action === '--updates-on' ? 'เปิดอัปเดตตอนเริ่มใช้งานแล้ว' : 'ปิดอัปเดตของ tmrw-start แล้ว (การอัปเดตใน ST เป็นคนละส่วน)');
} else {
if (action !== '--stop-voice') {
  try { await autoUpdate(config); }
  catch (error) {
    console.warn(`ตรวจอัปเดตไม่สำเร็จ ใช้รุ่นเดิมต่อ: ${error.message}`);
    if (await fs.stat(path.join(config.root, 'pending-update.json')).catch(() => null)) throw new Error('ต้องปิด ST แล้วเปิด tmrw-start ใหม่เพื่อกู้การอัปเดตที่ค้าง');
  }
}
const active = JSON.parse(await fs.readFile(path.join(config.root, 'active-pack.json'), 'utf8'));
const rel = path.relative(path.join(config.root, 'packs'), active.target);
if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('invalid-active-pack');
if (action !== '--update-only') await child('bash', [path.join(active.target, 'bin', action === '--stop-voice' ? 'STOP-TMRW-VOICE-SERVICES.sh' : 'START-TMRW-VOICE-SERVICES.sh')], {
  env: { ...process.env, TMRW_VOICE_HOME: config.root, TMRW_VOICE_PORT: String(config.runtimePort), TMRW_VOICE_MANAGER_PORT: String(config.managerPort) },
});
}
} finally { await unlock(); }
if (action === 'start') {
  let alreadyRunning = false;
  try { const r = await fetch(process.env.TMRW_ST_URL || 'http://127.0.0.1:8000', { signal: AbortSignal.timeout(3000) }); alreadyRunning = !!r; } catch {}
  if (alreadyRunning) console.log('มีเว็บเซิร์ฟเวอร์ที่พอร์ต ST อยู่แล้ว จึงไม่เปิดซ้ำ — กลับไปเปิด ST ในเบราว์เซอร์ได้เลย');
  else await child('bash', ['start.sh'], { cwd: config.st });
}
