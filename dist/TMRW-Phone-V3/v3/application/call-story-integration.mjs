import { requireEventScope } from '../domain/events/event-validator.mjs';
import { CALL_ACTION, CALL_STATE } from '../domain/calls/call-state-machine.mjs';
import { AUDIENCE_KIND } from '../domain/knowledge/audience-policy.mjs';
import { normalizeMainRpSource } from '../platform/sillytavern/message-events.mjs';

export const CALL_CONTINUATION_ROUTE = Object.freeze({ NONE: 'none', GENERATE: 'generate', CONTINUE: 'continue' });
export const CALL_INTENT_STATUS = Object.freeze({ NONE: 'none', READY: 'ready', AMBIGUOUS: 'ambiguous', BLOCKED: 'blocked' });

const CONSEQUENCE_KINDS = new Set(['fact', 'promise', 'relationship', 'plan', 'decision', 'agreement', 'secret', 'emotion', 'outcome']);
const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();
const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const BLOCKED_CALL_CONTEXT = Object.freeze([
  /(?:เมื่อวาน|เมื่อคืน|ก่อนหน้านี้|ครั้งก่อน|เคย)\s*[\s\S]{0,80}(?:โทร|call)/iu,
  /(?:ถ้า|หาก|สมมติ|เผื่อ)\s*[\s\S]{0,80}(?:โทร|call)/iu,
  /(?:คิด(?:ว่า|จะ)?|กำลังคิด|วางแผน|อยากจะ|ตั้งใจจะ|คงจะ|น่าจะ|อาจจะ|จะ)\s*[\s\S]{0,60}โทร/iu,
  /(?:ไม่|ไม่ได้|ไม่คิดจะ|จะไม่|ไม่มีทาง)\s*[\s\S]{0,40}โทร/iu,
  /(?:เขา|เธอ|นาย|หล่อน|พวกเขา)\s*(?:บอก|เล่า|พูด)ว่า[\s\S]{0,120}โทร/iu,
  /\b(?:yesterday|previously|used to call|called before|would call|will call|going to call|plan(?:ned)? to call|thinking of calling|thought about calling|did not call|didn't call|never call|said that|told me|heard that)\b/iu,
]);
const EXAMPLE_OR_QUOTE = /(?:^|\s)(?:ตัวอย่าง|example|quoted example|เช่น)\s*[:：]/iu;

function mentionsInCallPhrase(source) {
  const text = normalizeText(source.text).replace(/\*/g, '');
  const found = [];
  for (const [label, bindings] of Object.entries(source.mentionBindings || {})) {
    const safe = escapeRegex(label);
    const patterns = [
      new RegExp(`(?:โทร(?:ศัพท์)?(?:ไป)?หา|โทรหา)\\s*${safe}(?=$|[\\s,.!?…。，！？])`, 'iu'),
      new RegExp(`\\bcall(?:ing)?\\s+${safe}(?=$|[\\s,.!?…])`, 'iu'),
    ];
    if (patterns.some(pattern => pattern.test(text))) found.push({ label, bindings: Array.isArray(bindings) ? bindings : [] });
  }
  return found;
}

export function detectCurrentCallIntent(inputSource) {
  const source = normalizeMainRpSource(inputSource);
  if (source.role !== 'user' || source.mode !== 'normal' || source.origin !== 'main-rp') {
    return Object.freeze({ status: CALL_INTENT_STATUS.NONE, reason: 'not-normal-user-main-rp' });
  }
  const text = normalizeText(source.text);
  if (!text || !/(?:โทร|\bcall(?:ing)?\b)/iu.test(text)) return Object.freeze({ status: CALL_INTENT_STATUS.NONE, reason: 'no-call-language' });
  if (EXAMPLE_OR_QUOTE.test(text) || (/^\s*["“「『]/u.test(text) && /["”」』]\s*$/u.test(text))) {
    return Object.freeze({ status: CALL_INTENT_STATUS.BLOCKED, reason: 'quoted-or-example' });
  }
  if (BLOCKED_CALL_CONTEXT.some(pattern => pattern.test(text))) {
    return Object.freeze({ status: CALL_INTENT_STATUS.BLOCKED, reason: 'non-current-call-context' });
  }
  const mentions = mentionsInCallPhrase(source);
  if (mentions.length !== 1 || mentions[0].bindings.length !== 1) {
    return Object.freeze({ status: CALL_INTENT_STATUS.AMBIGUOUS, reason: mentions.length === 0 ? 'unresolved-call-target' : 'ambiguous-call-target' });
  }
  const called = mentions[0].bindings[0];
  if (!source.actorBinding?.accountId || !called?.accountId || source.actorBinding.accountId === called.accountId) {
    return Object.freeze({ status: CALL_INTENT_STATUS.AMBIGUOUS, reason: 'invalid-call-endpoints' });
  }
  return Object.freeze({
    status: CALL_INTENT_STATUS.READY,
    reason: 'current-explicit-call-action',
    targetLabel: mentions[0].label,
    caller: structuredClone(source.actorBinding),
    called: structuredClone(called),
    actionKey: `role-call:${called.accountId}`,
  });
}

export function decideCallContinuation({ enabled, oneShot = false, latestVisibleRole }) {
  if (!enabled && !oneShot) return CALL_CONTINUATION_ROUTE.NONE;
  if (latestVisibleRole === 'assistant' || latestVisibleRole === 'bot') return CALL_CONTINUATION_ROUTE.CONTINUE;
  if (latestVisibleRole === 'user') return CALL_CONTINUATION_ROUTE.GENERATE;
  return CALL_CONTINUATION_ROUTE.NONE;
}

function normalizeConsequences(values) {
  const rows = [];
  for (const [index, input] of (values || []).entries()) {
    const kind = String(input?.kind || '').trim();
    const text = normalizeText(input?.text);
    if (!CONSEQUENCE_KINDS.has(kind)) throw new TypeError(`Unsupported Call consequence kind at ${index}: ${kind}`);
    if (!text || text.length > 1000) throw new TypeError('Call consequence text must be 1-1000 characters');
    rows.push(Object.freeze({ kind, text }));
  }
  if (rows.length > 24) throw new TypeError('A Call end may commit at most 24 durable consequences');
  return Object.freeze(rows);
}

export class CallStoryIntegrationCoordinator {
  #handoff;
  #calls;
  #callCoordinator;
  #knowledge;
  #phoneContext;
  #settings;

  constructor({ handoffCoordinator, callService, callCoordinator, knowledgeService, phoneContextBuilder, settingsService }) {
    if (!handoffCoordinator?.processSource || !callService?.listCalls || !callCoordinator?.transition || !knowledgeService?.disclose || !phoneContextBuilder?.build || !settingsService?.get) {
      throw new TypeError('CallStoryIntegrationCoordinator requires Phase 10 handoff, canonical Calls, Knowledge, phone context, and settings');
    }
    this.#handoff = handoffCoordinator;
    this.#calls = callService;
    this.#callCoordinator = callCoordinator;
    this.#knowledge = knowledgeService;
    this.#phoneContext = phoneContextBuilder;
    this.#settings = settingsService;
  }

  async interceptRoleTriggeredCall({ scope: inputScope, source: sourceInput, abortGeneration = null, discardPartialAssistant = null }) {
    const scope = requireEventScope(inputScope);
    const source = normalizeMainRpSource(sourceInput);
    const intent = detectCurrentCallIntent(source);
    if (intent.status !== CALL_INTENT_STATUS.READY) return Object.freeze({ intercepted: false, intent });

    const action = Object.freeze({ actionKey: intent.actionKey, kind: 'call.initiate', completed: true, caller: intent.caller, called: intent.called });
    const result = await this.#handoff.processSource({ scope, source: { ...source, explicitPhoneActions: [action] } });
    const committed = result.proposals.find(row => row.committed && row.event?.eventType === 'calls.session-initiated.v1');
    if (!committed) return Object.freeze({ intercepted: false, intent, result });

    if (typeof abortGeneration === 'function') await abortGeneration(true);
    if (typeof discardPartialAssistant === 'function') await discardPartialAssistant({ afterSourceOrdinal: source.sourceOrdinal, sourceMessageId: source.sourceMessageId });
    const session = committed.session || committed.event?.payload?.session || null;
    return Object.freeze({ intercepted: true, intent, result, session, event: committed.event, replayed: Boolean(committed.replayed), userMessagePreserved: true, assistantResponseReplacedByCall: true });
  }

  async guardMainRpGeneration({ scope: inputScope, accountId, abortGeneration = null, discardPartialAssistant = null }) {
    const scope = requireEventScope(inputScope);
    const id = String(accountId || '').trim();
    if (!id) return Object.freeze({ blocked: false, reason: 'no-account' });
    const calls = await this.#calls.listCalls({ scope, viewerAccountId: id, limit: 10 });
    const open = calls.find(row => [CALL_STATE.RINGING, CALL_STATE.ACTIVE].includes(row.state));
    if (!open) return Object.freeze({ blocked: false, reason: 'no-open-call' });

    if (typeof abortGeneration === 'function') await abortGeneration(true);
    if (typeof discardPartialAssistant === 'function') await discardPartialAssistant({ callSessionId: open.callSessionId });
    return Object.freeze({ blocked: true, reason: 'open-call-excludes-main-rp', callSessionId: open.callSessionId, state: open.state });
  }

  async #commitConsequences({ scope, session, endEvent, consequences, source }) {
    const rows = normalizeConsequences(consequences);
    if (rows.length === 0) return Object.freeze([]);

    const actorIds = session.participants.map(row => row.actorId);
    const instanceIds = session.participants.map(row => row.instanceId);
    const accountIds = session.participants.map(row => row.accountId);
    const results = [];

    for (const [index, consequence] of rows.entries()) {
      const fragmentKey = `call-consequence-${index + 1}`;
      const observations = session.participants.map((participant, participantIndex) => ({
        targetActorId: participant.actorId,
        targetInstanceId: participant.instanceId,
        fragmentKeys: [fragmentKey],
        confidence: 'confirmed',
        evidence: {
          basis: 'direct-participant',
          sourceEventId: endEvent.id,
          sourceActorId: null,
          sourceDeviceId: null,
          sourceAccountId: null,
          provenanceAuthority: 'tmrw-call-integration-closure',
          provenanceRecordId: `${session.callSessionId}:${index}:${participantIndex}`,
        },
      }));
      results.push(await this.#knowledge.disclose({
        scope,
        bundle: {
          claim: { claimType: 'calls.consequence.v1', subject: { kind: 'event', id: endEvent.id }, safeSummary: consequence.text, certainty: 'confirmed', currentness: 'current' },
          audience: { kind: AUDIENCE_KIND.PRIVATE_EXPLICIT, actorIds, instanceIds, accountIds },
          fragments: [{ key: fragmentKey, kind: 'claim-summary', safeText: consequence.text, sourceField: `call-consequence:${consequence.kind}`, sourceEventId: endEvent.id }],
          observations,
        },
        source: {
          authority: source?.authority || 'tmrw-call-integration-closure',
          kind: 'call-consequence',
          recordId: `${session.callSessionId}:${consequence.kind}:${index}`,
          version: source?.version || '1',
        },
        producer: 'phase18-integration-closure',
        idempotencyKey: `call-consequence:${session.callSessionId}:${index}`,
        sourceEventIds: [endEvent.id],
      }));
    }
    return Object.freeze(results);
  }

  buildBoundedRpHandoff({ scope, actorId, instanceId, limit = 30, maxCharacters = 6000 }) {
    return this.#phoneContext.build({ scope, actorId, instanceId, limit, maxCharacters });
  }

  async endCall({
    scope: inputScope,
    deviceId,
    playerActorId,
    playerInstanceId,
    callSessionId,
    measuredDurationMs = 0,
    consequences = [],
    latestVisibleRole,
    continueAfterThisCall = null,
    continuationDriver = null,
    releaseEphemeral = null,
    source,
    idempotencyKey,
  }) {
    const scope = requireEventScope(inputScope);
    const session = await this.#calls.getSession({ scope, callSessionId });
    if (!session || session.state !== CALL_STATE.ACTIVE) throw new Error('END_CALL requires one active canonical Call Session');

    const ended = await this.#callCoordinator.transition({ scope, deviceId, playerActorId, playerInstanceId, callSessionId, action: CALL_ACTION.END, measuredDurationMs, source, idempotencyKey });
    const committedConsequences = await this.#commitConsequences({ scope, session, endEvent: ended.event, consequences, source });

    const settings = await this.#settings.get({ scope, playerInstanceId });
    const enabled = continueAfterThisCall == null ? Boolean(settings.continueStoryAfterCalls) : Boolean(continueAfterThisCall);
    const route = decideCallContinuation({ enabled, latestVisibleRole });
    let continuationPromise = null;
    if (continuationDriver && route !== CALL_CONTINUATION_ROUTE.NONE) {
      continuationPromise = Promise.resolve().then(() => route === CALL_CONTINUATION_ROUTE.CONTINUE
        ? continuationDriver.continueStory?.({ scope, callSessionId })
        : continuationDriver.generateStory?.({ scope, callSessionId }));
    }
    if (typeof releaseEphemeral === 'function') await releaseEphemeral({ callSessionId, continuationScheduled: Boolean(continuationPromise) });
    return Object.freeze({ ...ended, callCanonCommitted: true, transcriptFinalizedByTerminalState: true, consequenceEvents: committedConsequences, continuationRoute: route, continuationScheduled: Boolean(continuationPromise), continuationPromise });
  }

  continueAfterEnded({ scope, callSessionId, latestVisibleRole, continuationDriver }) {
    const route = decideCallContinuation({ enabled: false, oneShot: true, latestVisibleRole });
    if (!continuationDriver || route === CALL_CONTINUATION_ROUTE.NONE) return Object.freeze({ route: CALL_CONTINUATION_ROUTE.NONE, scheduled: false, promise: null });
    const promise = Promise.resolve().then(() => route === CALL_CONTINUATION_ROUTE.CONTINUE
      ? continuationDriver.continueStory?.({ scope, callSessionId })
      : continuationDriver.generateStory?.({ scope, callSessionId }));
    return Object.freeze({ route, scheduled: true, promise });
  }
}
