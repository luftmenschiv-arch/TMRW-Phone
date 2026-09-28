import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { acquireLock } from './download.mjs';

export function createVoiceSupervisor(config, { fetchImpl = fetch, start = startServices, now = Date.now } = {}) {
  let pending = null, closed = false, failureCount = 0, nextAttempt = 0;
  let state = { phase: 'starting', ready: false };
  const probe = async (port, route, identity) => {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(1500) });
      const body = await response.json();
      return { present: response.ok && body.ok === true && identity(body), ready: body.ready === true };
    } catch { return { present: false, ready: false }; }
  };
  async function maintenanceActive() {
    const file = path.join(config.root, 'voice-runtime-maintenance.json');
    const stat = await fs.lstat(file).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) return false;
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe-voice-maintenance-file');
    const text = await fs.readFile(file, 'utf8');
    let marker;
    try { marker = JSON.parse(text); } catch { throw new Error('invalid-voice-maintenance-file'); }
    if (!Number.isSafeInteger(marker.pid) || marker.pid < 1) throw new Error('invalid-voice-maintenance-owner');
    let alive = true;
    try { process.kill(marker.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    if (alive) return true;
    if (await fs.readFile(file, 'utf8').catch(() => null) === text) await fs.unlink(file);
    return false;
  }
  async function status() {
    if (await fs.stat(path.join(config.root, 'voice-autostart-paused.json')).catch(() => null)) return { phase: 'paused', ready: false, present: false };
    if (await maintenanceActive()) return { phase: 'maintenance', ready: false, present: false };
    const [runtime, manager] = await Promise.all([
      probe(config.runtimePort, '/health', body => ['TMRW Local Voice', 'TMRW Male Core'].includes(body.voice)),
      probe(config.managerPort, '/v1/health', body => body.service === 'TMRW Voice Manager'),
    ]);
    if (runtime.present && manager.present) {
      state = { phase: runtime.ready && manager.ready ? 'ready' : 'starting', ready: runtime.ready && manager.ready };
      if (state.ready) { failureCount = 0; nextAttempt = 0; }
    } else if (!pending && state.phase !== 'failed') state = { phase: 'stopped', ready: false };
    return { ...state, present: runtime.present && manager.present };
  }
  function ensure() {
    if (closed) return Promise.resolve({ phase: 'stopped', ready: false });
    if (pending) return pending;
    pending = (async () => {
      const current = await status();
      // Loading models are already running. Starting another engine here can
      // double memory usage and delay both instances.
      if (current.present || ['paused', 'maintenance'].includes(current.phase) || now() < nextAttempt) return current;
      state = { phase: 'starting', ready: false };
      let unlock;
      try {
        unlock = await acquireLock(path.join(config.root, 'start.lock'));
        const lockedState = await status();
        if (['paused', 'maintenance'].includes(lockedState.phase)) return lockedState;
        if (!lockedState.present) await start(config);
        const result = await status();
        if (result.phase === 'maintenance') return result;
        if (!result.present) throw new Error('voice-service-unavailable');
        return result;
      } catch (error) {
        if (String(error.message).startsWith('install-locked:')) {
          nextAttempt = now() + 5000;
          state = { phase: 'starting', ready: false };
        } else {
          nextAttempt = now() + Math.min(300000, 30000 * 2 ** Math.min(failureCount++, 4));
          state = { phase: 'failed', ready: false, error: 'voice-start-failed' };
          console.warn('[TMRW] Voice startup failed; see voice logs. Will retry with backoff.');
        }
        return { ...state };
      } finally { if (unlock) await unlock(); }
    })().finally(() => { pending = null; });
    return pending;
  }
  return { ensure, status, close() { closed = true; } };
}

async function startServices(config) {
  let target;
  if (config.legacy === true) target = path.join(config.root, 'current');
  else {
    const active = JSON.parse(await fs.readFile(path.join(config.root, 'active-pack.json'), 'utf8'));
    target = path.resolve(active.target);
    const relative = path.relative(path.join(config.root, 'packs'), target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('invalid-active-pack');
  }
  const script = path.join(target, 'bin/START-TMRW-VOICE-SERVICES.sh');
  if (!(await fs.stat(script)).isFile()) throw new Error('voice-launcher-missing');
  await fs.mkdir(path.join(config.root, 'logs'), { recursive: true });
  const log = await fs.open(path.join(config.root, 'logs/auto-start.log'), 'a');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('bash', [script], { stdio: ['ignore', log.fd, log.fd],
        env: { ...process.env, TMRW_VOICE_HOME: config.root, TMRW_VOICE_PORT: String(config.runtimePort), TMRW_VOICE_MANAGER_PORT: String(config.managerPort) } });
      const timer = setTimeout(() => { child.kill(); reject(new Error('voice-start-timeout')); }, 240000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('voice-start-failed')); });
    });
  } finally { await log.close(); }
}
