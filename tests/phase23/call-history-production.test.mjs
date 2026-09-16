import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { callHistoryViewModel } from '../../ui/calls/history.mjs';
import { setupPhase9, startCall, transitionCall, addCallText } from '../phase9/call-fixtures.mjs';
import { EXPERIENCE_PRESET } from '../../ui/experience-presets.mjs';

test('call history groups local dates once and renders real start times', () => {
  const now = new Date(2026, 8, 17, 12, 0, 0);
  const identities = new Map([['account:bot', { displayName: 'Kaelan' }]]);
  const session = (id, startedAt) => ({
    callSessionId: id,
    state: 'ended',
    callingAccountId: 'account:user',
    calledAccountId: 'account:bot',
    startedAt: startedAt.toISOString(),
    connectedAt: startedAt.toISOString(),
    endedAt: startedAt.toISOString(),
    durationEvidence: { durationMs: 83_000 },
  });
  const history = callHistoryViewModel({
    sessions: [
      session('call:today', new Date(2026, 8, 17, 9, 7, 0)),
      session('call:yesterday', new Date(2026, 8, 16, 23, 58, 0)),
      session('call:older', new Date(2026, 7, 3, 8, 5, 0)),
    ],
    viewerAccountId: 'account:user',
    identities,
    now,
  });

  assert.deepEqual(history.map(row => row.dateGroupLabel), ['วันนี้', 'เมื่อวาน', '3 ส.ค. 2569']);
  assert.deepEqual(history.map(row => row.timeLabel), ['09:07', '23:58', '08:05']);
  assert.deepEqual(history.map(row => row.durationLabel), ['1:23', '1:23', '1:23']);
});

test('canonical call projection persists start, connected, end, and measured duration evidence', async () => {
  const c = await setupPhase9({ manifestId: 'p23-call-history-time' });
  const started = await startCall(c, { key: 'history-time' });
  const accepted = await transitionCall(c, started.session.callSessionId, 'accept', { key: 'history-time-accept' });
  const ended = await transitionCall(c, started.session.callSessionId, 'end', { actor: c.user, key: 'history-time-end', durationMs: 83_000 });

  assert.match(started.session.startedAt, /^2026-08-13T09:/);
  assert.ok(Date.parse(accepted.session.connectedAt) > Date.parse(started.session.startedAt));
  assert.ok(Date.parse(ended.session.endedAt) > Date.parse(accepted.session.connectedAt));
  assert.equal(ended.session.durationEvidence.durationMs, 83_000);
  assert.equal(ended.session.durationEvidence.basis, 'call-measured');
});

test('production shell no longer hardcodes zero duration or one Today heading per row', async () => {
  const source = await readFile(new URL('../../ui/shell.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /measuredDurationMs:\s*0/);
  assert.doesNotMatch(source, /element\(this\.#document,'h3','Today'\)/);
  assert.match(source, /#measuredCallDuration\(call\)/);
  assert.match(source, /sections\.get\(call\.dateGroupKey\)/);
});

test('selected terminal history exposes scoped Call Details with ordered player and character turns', async () => {
  const c = await setupPhase9({ castSize: 1, manifestId: 'p23-call-details' });
  await c.settings.setPreset({ scope: c.scope, playerInstanceId: c.user.instanceId, preset: EXPERIENCE_PRESET.SIMPLE });
  const started = await startCall(c, { key: 'details' });
  await transitionCall(c, started.session.callSessionId, 'accept', { key: 'details-accept' });
  await addCallText(c, started.session.callSessionId, { speaker: c.user, text: 'อรุณสวัสดิ์', key: 'details-user' });
  await addCallText(c, started.session.callSessionId, { speaker: c.alice, actual: c.alice, device: c.alice, text: 'อรุณสวัสดิ์ครับ', key: 'details-character' });
  await transitionCall(c, started.session.callSessionId, 'end', { actor: c.user, key: 'details-end', durationMs: 12_345 });

  const view = await c.viewModels.selected({
    scope: c.scope,
    deviceId: c.user.deviceId,
    playerActorId: c.user.actorId,
    playerInstanceId: c.user.instanceId,
    route: 'calls',
    controller: c.controller,
    selectedCallSessionId: started.session.callSessionId,
    activeCharacterDisplayName: 'Kaelan Vance',
  });

  assert.equal(view.callUi.details.callSessionId, started.session.callSessionId);
  assert.equal(view.callUi.details.direction, 'outgoing');
  assert.equal(view.callUi.details.durationLabel, '0:12');
  assert.deepEqual(view.callUi.details.transcript.map(row => [row.speakerKind, row.text]), [
    ['player', 'อรุณสวัสดิ์'],
    ['character', 'อรุณสวัสดิ์ครับ'],
  ]);
  assert.equal(view.callUi.details.callbackTarget.accountId, c.alice.accountId);
  assert.equal(view.callUi.details.languageSummary, 'ยังไม่มีเสียงที่บันทึกไว้');
});
