import fs from 'node:fs/promises';
import { createVoiceSupervisor } from './voice-supervisor.mjs';

export const info = { id: 'tmrw-voice-bootstrap', name: 'TMRW Voice Startup', description: 'Starts local TMRW voice with SillyTavern and recovers unavailable services.' };
let supervisor, timer;
export async function init(router) {
  const config = JSON.parse(await fs.readFile(new URL('./config.json', import.meta.url), 'utf8'));
  supervisor = createVoiceSupervisor(config);
  router.get('/status', async (_req, res) => {
    try { res.json(await supervisor.status()); } catch { res.status(503).json({ ready: false, phase: 'failed' }); }
  });
  router.post('/ensure', (_req, res) => {
    // No caller-supplied paths, commands, ports, or environment are accepted.
    void supervisor.ensure().catch(() => {});
    res.status(202).json({ ok: true, phase: 'starting' });
  });
  // ST awaits init(). Model loading must stay outside that startup barrier.
  void supervisor.ensure().catch(() => {});
  timer = setInterval(() => { void supervisor.ensure().catch(() => {}); }, 15000);
  timer.unref();
}
export function exit() { clearInterval(timer); supervisor?.close(); }
