import test from 'node:test';
import assert from 'node:assert/strict';
import { CallTimingDiagnostics, CALL_FIRST_AUDIO_BUDGET_MS } from '../../application/call-timing-diagnostics.mjs';
import { TMRWLocalVoiceAdapter } from '../../platform/voice/tmrw-local-voice-adapter.mjs';

test('call timing diagnostics exposes bounded content-free latency evidence', () => {
  let mono = 100;
  const diagnostics = new CallTimingDiagnostics({ now: () => mono, wallClock: () => 1_700_000_000_000, maxTurns: 2, maxEvents: 8 });
  diagnostics.begin('turn-secret-text-must-not-appear', { callSessionId: 'call-1' });
  mono += 40; diagnostics.mark('turn-secret-text-must-not-appear', 'llm-start');
  mono += 160; diagnostics.mark('turn-secret-text-must-not-appear', 'llm-complete', { observable: false });
  diagnostics.mark('turn-secret-text-must-not-appear', 'structured-validation', { outcome: 'valid', outputCharacters: 128, segmentCount: 2, prompt: 'TOP SECRET' });
  mono += 75; diagnostics.mark('turn-secret-text-must-not-appear', 'playback-start', { segmentIndex: 0, segmentCount: 2, language: 'en' });
  mono += 300; diagnostics.finish('turn-secret-text-must-not-appear', 'played');
  diagnostics.begin('turn-2', { callSessionId: 'call-2' });
  diagnostics.begin('turn-3', { callSessionId: 'call-3' });

  const snapshot = diagnostics.snapshot();
  assert.equal(snapshot.turns.length, 2);
  assert.deepEqual(snapshot.turns.map(row => row.turnId), ['turn-3', 'turn-2']);
  assert.equal(snapshot.privacy.promptTextStored, false);
  assert.equal(snapshot.privacy.reasoningStored, false);
  assert.equal(JSON.stringify(snapshot).includes('provider-response'), false);
  assert.equal(JSON.stringify(snapshot).includes('TOP SECRET'), false);

  const one = new CallTimingDiagnostics({ now: () => mono, wallClock: () => 1_700_000_000_000 });
  one.begin('turn-1', { callSessionId: 'call-1' });
  mono += 25; one.mark('turn-1', 'playback-start');
  mono += 10; one.finish('turn-1', 'played');
  const record = one.snapshot().turns[0];
  assert.equal(record.timeToFirstAudioMs, 25);
  assert.equal(record.totalTurnMs, 35);
  assert.equal(record.status, 'played');
  assert.equal(record.firstAudioOverBudget, false);
});

test('first-audio budget warns once without call text or IDs', () => {
  let mono = 0;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const diagnostics = new CallTimingDiagnostics({ now: () => mono });
    diagnostics.begin('private-turn', { callSessionId: 'private-call' });
    mono = CALL_FIRST_AUDIO_BUDGET_MS + 1;
    diagnostics.mark('private-turn', 'playback-start', { segmentIndex: 0 });
    diagnostics.mark('private-turn', 'playback-start', { segmentIndex: 1 });
    const record = diagnostics.snapshot().turns[0];
    assert.equal(record.firstAudioOverBudget, true);
    assert.equal(warnings.length, 1);
    assert.equal(JSON.stringify(warnings).includes('private-'), false);
  } finally { console.warn = originalWarn; }
});

test('later runtime pushes do not block fetching the first call segment', async () => {
  let releaseSecondPush;
  const secondPush = new Promise(resolve => { releaseSecondPush = resolve; });
  const events = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/health')) return new Response(JSON.stringify({ ok: true, ready: true, voice: 'TMRW Local Voice' }), { status: 200 });
    if (url.endsWith('/turn/start')) return new Response(JSON.stringify({ ok: true, turn_id: 'turn-1' }), { status: 200 });
    if (url.endsWith('/turn/push')) {
      const index = JSON.parse(options.body).index;
      events.push(`push:${index}`);
      if (index === 1) await secondPush;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.includes('/turn/audio?')) {
      const index = Number(new URL(url).searchParams.get('index'));
      events.push(`audio:${index}`);
      return new Response(new Uint8Array(64), { status: 200, headers: { 'Content-Type': 'audio/wav' } });
    }
    throw new Error(`unexpected-url:${url}`);
  };
  const adapter = new TMRWLocalVoiceAdapter({ fetchImpl, createObjectURL: () => 'blob:test', revokeObjectURL: () => {}, requestTimeoutMs: 1000 });
  const profile = { profileName: 'male-polite-dangerous', language: 'en', defaultDelivery: 'natural', traits: {}, providerNeutral: true };
  const request = index => ({ actorId: 'actor', instanceId: 'instance', callSessionId: 'call', canonicalText: `Sentence ${index}.`, subtitleText: `ประโยค ${index}`, language: 'en', resolvedProfile: profile });
  const sequence = await adapter.openSequence([request(0), request(1)]);
  const first = await sequence.renderAt(0);
  assert.equal(first.status, 'ready');
  assert.ok(events.includes('audio:0'), 'first audio must not wait for the later push');
  let secondReady = false;
  const second = sequence.renderAt(1).then(result => { secondReady = true; return result; });
  await Promise.resolve();
  assert.equal(secondReady, false, 'second audio waits until its own push completes');
  releaseSecondPush();
  assert.equal((await second).status, 'ready');
});

test('TMRW Local Voice runtime emits phase timings without leaking submitted text', async () => {
  const phases = [];
  const fetchImpl = async url => {
    if (url.endsWith('/health')) return new Response(JSON.stringify({ ok: true, ready: true, voice: 'TMRW Local Voice' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/turn/start')) return new Response(JSON.stringify({ ok: true, turn_id: 'runtime-turn' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/turn/push')) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/turn/audio?')) return new Response(new Uint8Array(64), { status: 200, headers: { 'Content-Type': 'audio/wav', 'X-TMRW-Duration': '0.25' } });
    throw new Error(`unexpected-url:${url}`);
  };
  const adapter = new TMRWLocalVoiceAdapter({ fetchImpl, createObjectURL: () => 'blob:test-audio', revokeObjectURL: () => {} });
  const sequence = await adapter.openSequence([{
    actorId: 'actor-1', instanceId: 'instance-1', callSessionId: 'call-1', canonicalText: 'TOP SECRET SPOKEN TEXT', subtitleText: 'ข้อความลับ', language: 'en', resolvedProfile: { profileName: 'male-polite-dangerous', language: 'en', defaultDelivery: 'natural', traits: {}, providerNeutral: true }, delivery: { preset: 'natural' },
  }], { onTiming: event => phases.push(event) });
  const rendered = await sequence.renderAt(0);
  assert.equal(rendered.status, 'ready');
  assert.deepEqual(phases.map(event => event.phase), ['runtime-health-start', 'runtime-health-end', 'runtime-turn-start', 'runtime-turn-ready', 'runtime-chunk-push-start', 'runtime-chunk-push-end', 'synthesis-start', 'audio-fetch-start', 'synthesis-ready', 'audio-fetch-ready']);
  assert.equal(JSON.stringify(phases).includes('TOP SECRET'), false);
  assert.equal(JSON.stringify(phases).includes('ข้อความลับ'), false);
});
