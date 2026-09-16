import test from 'node:test';
import assert from 'node:assert/strict';
import { CallTimingDiagnostics } from '../../application/call-timing-diagnostics.mjs';
import { PuzzleLocalRuntimeVoiceAdapter } from '../../platform/voice/puzzle-local-runtime-adapter.mjs';

test('call timing diagnostics exposes bounded content-free latency evidence', () => {
  let mono = 100;
  const diagnostics = new CallTimingDiagnostics({ now: () => mono, wallClock: () => 1_700_000_000_000, maxTurns: 2, maxEvents: 8 });
  diagnostics.begin('turn-secret-text-must-not-appear', { callSessionId: 'call-1' });
  mono += 40; diagnostics.mark('turn-secret-text-must-not-appear', 'llm-start');
  mono += 160; diagnostics.mark('turn-secret-text-must-not-appear', 'llm-complete', { observable: false });
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

  const one = new CallTimingDiagnostics({ now: () => mono, wallClock: () => 1_700_000_000_000 });
  one.begin('turn-1', { callSessionId: 'call-1' });
  mono += 25; one.mark('turn-1', 'playback-start');
  mono += 10; one.finish('turn-1', 'played');
  const record = one.snapshot().turns[0];
  assert.equal(record.timeToFirstAudioMs, 25);
  assert.equal(record.totalTurnMs, 35);
  assert.equal(record.status, 'played');
});

test('Puzzle runtime emits phase timings without leaking submitted text', async () => {
  const phases = [];
  const fetchImpl = async url => {
    if (url.endsWith('/health')) return new Response(JSON.stringify({ ok: true, ready: true, voice: 'Puzzle' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/turn/start')) return new Response(JSON.stringify({ ok: true, turn_id: 'runtime-turn' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/turn/push')) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/turn/audio?')) return new Response(new Uint8Array(64), { status: 200, headers: { 'Content-Type': 'audio/wav', 'X-TMRW-Duration': '0.25' } });
    throw new Error(`unexpected-url:${url}`);
  };
  const adapter = new PuzzleLocalRuntimeVoiceAdapter({ fetchImpl, createObjectURL: () => 'blob:test-audio', revokeObjectURL: () => {} });
  const sequence = await adapter.openSequence([{
    actorId: 'actor-1', instanceId: 'instance-1', callSessionId: 'call-1', canonicalText: 'TOP SECRET SPOKEN TEXT', subtitleText: 'ข้อความลับ', language: 'en', resolvedProfile: { profileName: 'Puzzle', language: 'en', defaultDelivery: 'natural', traits: {}, providerNeutral: true }, delivery: { preset: 'natural' },
  }], { onTiming: event => phases.push(event) });
  const rendered = await sequence.renderAt(0);
  assert.equal(rendered.status, 'ready');
  assert.deepEqual(phases.map(event => event.phase), ['runtime-health-start', 'runtime-health-end', 'runtime-turn-start', 'runtime-turn-ready', 'runtime-chunk-push-start', 'runtime-chunk-push-end', 'synthesis-start', 'audio-fetch-start', 'synthesis-ready', 'audio-fetch-ready']);
  assert.equal(JSON.stringify(phases).includes('TOP SECRET'), false);
  assert.equal(JSON.stringify(phases).includes('ข้อความลับ'), false);
});
