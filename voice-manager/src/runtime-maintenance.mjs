import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const MARKER = 'voice-runtime-maintenance.json';
const LOCK = 'start.lock';

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

async function readOwnedFile(file) {
  const stat = await fs.lstat(file).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe-voice-maintenance-file');
  const text = await fs.readFile(file, 'utf8');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('invalid-voice-maintenance-file'); }
  if (!Number.isSafeInteger(value.pid) || value.pid < 1) throw new Error('invalid-voice-maintenance-owner');
  return { text, value };
}

async function clearDeadOwner(file) {
  const owned = await readOwnedFile(file);
  if (!owned) return true;
  if (processAlive(owned.value.pid)) return false;
  if (await fs.readFile(file, 'utf8').catch(() => null) !== owned.text) return false;
  await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  return true;
}

async function acquireStartLock(root, { waitMs = 240000, intervalMs = 1000 } = {}) {
  const file = path.join(root, LOCK);
  const deadline = Date.now() + waitMs;
  while (true) {
    let handle;
    try { handle = await fs.open(file, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (await clearDeadOwner(file)) continue;
      if (Date.now() >= deadline) throw new Error('voice-start-lock-timeout');
      await delay(intervalMs);
      continue;
    }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid })); }
    catch (error) { await handle.close(); await fs.unlink(file).catch(() => {}); throw error; }
    return async () => { await handle.close(); await fs.unlink(file); };
  }
}

export async function withRuntimeMaintenance(root, task, options = {}) {
  const file = path.join(root, MARKER);
  const text = JSON.stringify({ pid: process.pid, id: crypto.randomUUID(), kind: 'voice-clone' });
  let handle;
  try { handle = await fs.open(file, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!await clearDeadOwner(file)) throw new Error('voice-maintenance-in-progress');
    handle = await fs.open(file, 'wx', 0o600);
  }
  let written = false;
  try {
    await handle.writeFile(text);
    written = true;
    const unlock = await acquireStartLock(root, options);
    try { return await task(); }
    finally { await unlock(); }
  } finally {
    await handle.close();
    if (!written || await fs.readFile(file, 'utf8').catch(() => null) === text) await fs.unlink(file);
  }
}
