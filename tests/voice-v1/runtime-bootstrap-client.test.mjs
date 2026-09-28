import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureLocalVoiceService } from '../../v3/platform/voice/runtime-bootstrap-client.mjs';
import { TMRWLocalVoiceAdapter } from '../../v3/platform/voice/tmrw-local-voice-adapter.mjs';

test('companion recovery carries ST headers and waits for actual readiness', async () => {
  let polls = 0;
  const ready = await ensureLocalVoiceService({ headers: { 'X-CSRF-Token': 'test' }, pollMs: 1, fetchImpl: async (url, options) => {
    if (url.endsWith('/ensure')) { assert.equal(options.method, 'POST'); assert.equal(options.headers['X-CSRF-Token'], 'test'); return Response.json({ ok: true }); }
    return Response.json({ ready: ++polls === 2, phase: 'starting' });
  } });
  assert.equal(ready, true); assert.equal(polls, 2);
});
test('missing companion, explicit pause, and cancellation do not hang recovery', async () => {
  assert.equal(await ensureLocalVoiceService({ fetchImpl: async () => new Response('', { status: 404 }) }), false);
  assert.equal(await ensureLocalVoiceService({ fetchImpl: async url => Response.json(url.endsWith('/ensure') ? { ok: true } : { phase: 'paused' }) }), false);
  const controller = new AbortController();
  const pending = ensureLocalVoiceService({ signal: controller.signal, fetchImpl: async url => Response.json(url.endsWith('/ensure') ? { ok: true } : { phase: 'starting' }) });
  setTimeout(() => controller.abort(), 5);
  assert.equal(await pending, false);
});
test('adapter rechecks recovered runtime and leaves custom endpoints alone', async () => {
  let online = false, recoveries = 0;
  const adapter = new TMRWLocalVoiceAdapter({ fetchImpl: async () => { if (!online) throw new Error('offline'); return Response.json({ ok: true, ready: true, voice: 'TMRW Local Voice' }); }, ensureRuntime: async () => { recoveries++; online = true; return true; } });
  assert.equal((await adapter.warm({ callSessionId: 'a', language: 'en' })).ready, true);
  assert.equal(recoveries, 1);
  online = false;
  assert.equal((await adapter.warm({ callSessionId: 'b', language: 'en', baseUrl: 'http://example.test:18769' })).ready, false);
  assert.equal(recoveries, 1);
});
