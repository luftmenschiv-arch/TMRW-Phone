import { MIGRATION_ITEM_STATE } from './constants.mjs';
import { previewDigest } from './digest.mjs';

export async function createCallMigrationItem({ scope, call, memberIds }) {
  const sourceRecordId = `scope:${scope.sourceScopeKey}:call:${call.callId || await previewDigest(call)}`; let state = MIGRATION_ITEM_STATE.READY; let reasonCode = null;
  if (!call.callId) { state = MIGRATION_ITEM_STATE.QUARANTINED; reasonCode = 'call-missing-stable-id'; }
  else if (!memberIds.has(call.callerId) || !memberIds.has(call.calleeId) || call.callerId === call.calleeId) { state = MIGRATION_ITEM_STATE.AMBIGUOUS; reasonCode = 'call-participants-unmapped'; }
  else if (!['completed', 'missed'].includes(call.status)) { state = MIGRATION_ITEM_STATE.UNSUPPORTED; reasonCode = 'unsupported-call-status'; }
  else if (!/^(manual|user-action|explicit-canon)$/i.test(call.source)) { state = MIGRATION_ITEM_STATE.QUARANTINED; reasonCode = /pocket/i.test(call.source) ? 'pocket-origin-not-preview-migration-input' : 'call-provenance-not-defensible'; }
  else if (call.status === 'completed' && (!Number.isSafeInteger(call.durationSec) || call.durationSec < 0)) { state = MIGRATION_ITEM_STATE.AMBIGUOUS; reasonCode = 'invalid-call-duration'; }
  else if (call.transcript.length) { state = MIGRATION_ITEM_STATE.QUARANTINED; reasonCode = 'call-transcript-provenance-insufficient'; }
  return Object.freeze({ sourceRecordId, sourceScopeKey: scope.sourceScopeKey, sourceType: 'call', state, reasonCode, sourceFingerprint: await previewDigest(call), data: state === MIGRATION_ITEM_STATE.READY ? Object.freeze({ callSourceId: call.callId, callerSourceId: call.callerId, calleeSourceId: call.calleeId, status: call.status, durationMs: call.durationSec * 1000, displayedTime: call.displayedTime, originalSource: call.source, transcript: Object.freeze(call.transcript) }) : null });
}
