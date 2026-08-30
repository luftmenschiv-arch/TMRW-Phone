import { requireEventScope } from '../../domain/events/event-validator.mjs';
import { requireText } from '../../domain/identity/identity-record.mjs';
import { ENGAGEMENT_KIND } from '../../domain/social/engagement.mjs';
import { SOCIAL_AUDIENCE, normalizeSocialAudience } from '../../domain/social/audience.mjs';
import { SOCIAL_EVENT_TYPES } from '../../domain/social/social-event-types.mjs';
import { LIVE_EVENT_TYPES } from '../../domain/live/live-event-types.mjs';
import { LIVE_STATUS } from '../../domain/live/live-session.mjs';
import { LIVE_REACTION_KIND } from '../../domain/live/reaction.mjs';

export const AUTONOMOUS_SOCIAL_ACTION = Object.freeze({
  NO_ACTION: 'NO_ACTION', FEED_POST: 'FEED_POST', FEED_COMMENT: 'FEED_COMMENT', FEED_REPLY: 'FEED_REPLY',
  FEED_REACTION: 'FEED_REACTION', FEED_REPOST: 'FEED_REPOST', FEED_QUOTE: 'FEED_QUOTE', START_LIVE: 'START_LIVE',
  LIVE_HOST_TURN: 'LIVE_HOST_TURN', LIVE_COMMENT: 'LIVE_COMMENT', LIVE_REACTION: 'LIVE_REACTION', END_LIVE: 'END_LIVE',
});

export const AUTONOMOUS_SOCIAL_BOUNDS = Object.freeze({ maxActionsPerResult: 1, postText: 2000, commentText: 1000, quoteText: 1000, liveTurnText: 1000, liveTitle: 160, liveTopic: 120, liveDescription: 1000, contextCharacters: 6000, contextGrants: 30, generationDepth: 2 });
const ACTIONS = new Set(Object.values(AUTONOMOUS_SOCIAL_ACTION).filter(value => value !== AUTONOMOUS_SOCIAL_ACTION.NO_ACTION));
const SOCIAL_COMMENT_ACTIONS = new Set([AUTONOMOUS_SOCIAL_ACTION.FEED_COMMENT, AUTONOMOUS_SOCIAL_ACTION.FEED_REPLY]);
const SOCIAL_ENGAGEMENT_ACTIONS = new Set([AUTONOMOUS_SOCIAL_ACTION.FEED_REACTION, AUTONOMOUS_SOCIAL_ACTION.FEED_REPOST, AUTONOMOUS_SOCIAL_ACTION.FEED_QUOTE]);
const LIVE_MESSAGE_ACTIONS = new Set([AUTONOMOUS_SOCIAL_ACTION.LIVE_HOST_TURN, AUTONOMOUS_SOCIAL_ACTION.LIVE_COMMENT]);
const EVENT_TYPE_BY_ACTION = Object.freeze({
  [AUTONOMOUS_SOCIAL_ACTION.FEED_POST]: SOCIAL_EVENT_TYPES.POST_CREATED,
  [AUTONOMOUS_SOCIAL_ACTION.FEED_COMMENT]: SOCIAL_EVENT_TYPES.COMMENT_CREATED,
  [AUTONOMOUS_SOCIAL_ACTION.FEED_REPLY]: SOCIAL_EVENT_TYPES.COMMENT_CREATED,
  [AUTONOMOUS_SOCIAL_ACTION.FEED_REACTION]: SOCIAL_EVENT_TYPES.ENGAGEMENT_STATE,
  [AUTONOMOUS_SOCIAL_ACTION.FEED_REPOST]: SOCIAL_EVENT_TYPES.ENGAGEMENT_STATE,
  [AUTONOMOUS_SOCIAL_ACTION.FEED_QUOTE]: SOCIAL_EVENT_TYPES.ENGAGEMENT_STATE,
  [AUTONOMOUS_SOCIAL_ACTION.START_LIVE]: LIVE_EVENT_TYPES.SESSION_STATE,
  [AUTONOMOUS_SOCIAL_ACTION.LIVE_HOST_TURN]: LIVE_EVENT_TYPES.MESSAGE_CREATED,
  [AUTONOMOUS_SOCIAL_ACTION.LIVE_COMMENT]: LIVE_EVENT_TYPES.MESSAGE_CREATED,
  [AUTONOMOUS_SOCIAL_ACTION.LIVE_REACTION]: LIVE_EVENT_TYPES.REACTION_STATE,
  [AUTONOMOUS_SOCIAL_ACTION.END_LIVE]: LIVE_EVENT_TYPES.SESSION_STATE,
});
const ALLOWED_OUTPUT_KEYS = Object.freeze({
  [AUTONOMOUS_SOCIAL_ACTION.FEED_POST]: new Set(['action', 'text']),
  [AUTONOMOUS_SOCIAL_ACTION.FEED_COMMENT]: new Set(['action', 'text']),
  [AUTONOMOUS_SOCIAL_ACTION.FEED_REPLY]: new Set(['action', 'text']),
  [AUTONOMOUS_SOCIAL_ACTION.FEED_REACTION]: new Set(['action', 'active']),
  [AUTONOMOUS_SOCIAL_ACTION.FEED_REPOST]: new Set(['action', 'active']),
  [AUTONOMOUS_SOCIAL_ACTION.FEED_QUOTE]: new Set(['action', 'text', 'active']),
  [AUTONOMOUS_SOCIAL_ACTION.START_LIVE]: new Set(['action', 'title', 'topic', 'description']),
  [AUTONOMOUS_SOCIAL_ACTION.LIVE_HOST_TURN]: new Set(['action', 'text']),
  [AUTONOMOUS_SOCIAL_ACTION.LIVE_COMMENT]: new Set(['action', 'text']),
  [AUTONOMOUS_SOCIAL_ACTION.LIVE_REACTION]: new Set(['action', 'active']),
  [AUTONOMOUS_SOCIAL_ACTION.END_LIVE]: new Set(['action']),
  [AUTONOMOUS_SOCIAL_ACTION.NO_ACTION]: new Set(['action', 'reason']),
});
const boundedText = (value, field, max) => { const text = String(value ?? '').trim(); if (!text || text.length > max) throw new Error(`${field} must contain 1-${max} characters`); return text; };

export class AutonomousSocialGateHarness {
  #events; #jobs; #knowledge; #social; #live; #shadowMode;
  constructor({ eventEngine, aiJobService, knowledgeService, socialService, liveService, shadowMode = false }) { if (!eventEngine || !aiJobService || !knowledgeService || !socialService || !liveService) throw new TypeError('Gate G harness requires canonical Events, the shared AI job service, Knowledge, Social, and Live'); if (!shadowMode) throw new Error('Gate G autonomous execution is shadow/test-only while production feature flags remain disabled'); this.#events = eventEngine; this.#jobs = aiJobService; this.#knowledge = knowledgeService; this.#social = socialService; this.#live = liveService; this.#shadowMode = true; }
  get productionEnabled() { return false; }
  get shadowMode() { return this.#shadowMode; }

  async schedule({ scope: inputScope, sourceEventId, actorId, instanceId, accountId, deviceId, actionType, actionEnvelope = {}, idempotencyKey, generationConfig = { version: 'gate-g-v1', provider: 'deterministic-shadow', model: 'adversarial-stub' }, explicitPlayerAuthorization = false }) {
    const scope = requireEventScope(inputScope); const action = requireText(actionType, 'actionType'); if (!ACTIONS.has(action)) throw new Error('Unknown autonomous social action type'); const source = await this.#events.getEvent(scope, sourceEventId); if (!source || source.status !== 'active') throw new Error('Autonomous social trigger must be a current canonical Event');
    if (/^(director|migration|notifications?)\./.test(source.eventType) || source.provenance?.authority === 'preview37' || source.provenance?.authority === 'pocket-phone') throw new Error('Correction, migration, notification, and quarantined legacy sources are not autonomous social triggers');
    const priorDepth = Number(source.payload?.aiJobCommit?.generationDepth ?? -1); const generationDepth = priorDepth + 1; if (priorDepth >= 0 && actionEnvelope.allowAiCascade !== true) throw new Error('AI-originated Events cannot cascade without an explicit bounded authorization'); if (generationDepth > AUTONOMOUS_SOCIAL_BOUNDS.generationDepth) throw new Error('Autonomous social causal depth exceeded');
    const envelope = await this.#validateEnvelope(scope, { action, actorId, accountId, actionEnvelope });
    return this.#jobs.schedule({ scope, sourceEventId, targetActorId: actorId, targetInstanceId: instanceId, targetAccountId: accountId, targetDeviceId: deviceId, jobType: `autonomous-social.${action.toLowerCase()}`, actionType: action, actionEnvelope: envelope, allowedEventTypes: [EVENT_TYPE_BY_ACTION[action]], purpose: 'model-generation', generationConfig, generationDepth, maxGenerationDepth: AUTONOMOUS_SOCIAL_BOUNDS.generationDepth, explicitPlayerAuthorization, idempotencyKey });
  }

  prepare({ scope, jobId }) { return this.#jobs.prepareInput({ scope, jobId, limit: AUTONOMOUS_SOCIAL_BOUNDS.contextGrants, maxCharacters: AUTONOMOUS_SOCIAL_BOUNDS.contextCharacters }); }

  async acceptResult({ scope: inputScope, jobId, attemptId, result }) {
    const scope = requireEventScope(inputScope); const job = await this.#jobs.get({ scope, jobId }); if (!job || job.attemptId !== attemptId || job.status !== 'running') throw new Error('AI job attempt is stale');
    try {
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('malformed-model-output'); const action = requireText(result.action, 'result.action');
      if (action === AUTONOMOUS_SOCIAL_ACTION.NO_ACTION) { this.#assertOutputShape(action, result); return this.#jobs.completeNoAction({ scope, jobId, attemptId, reason: String(result.reason || 'model-selected-silence').slice(0, 256) }); }
      if (action !== job.actionType) throw new Error('action-outside-authorization-envelope'); this.#assertOutputShape(action, result); const proposal = await this.#normalizeProposal(scope, job, result); await this.#assertCurrentEligibility(scope, job, proposal); const validated = await this.#jobs.validateStructuredOutput({ scope, jobId, attemptId, output: proposal, validator: value => value.action === job.actionType }); return Object.freeze({ job: validated, proposal, noAction: false });
    } catch (error) { const current = await this.#jobs.get({ scope, jobId }); if (current?.status === 'running') await this.#jobs.fail({ scope, jobId, reason: String(error.message || 'proposal-rejected').slice(0, 256) }); throw new Error(`Autonomous social proposal rejected: ${error.message}`); }
  }

  async commit({ scope: inputScope, jobId }) {
    const scope = requireEventScope(inputScope); const job = await this.#jobs.get({ scope, jobId }); if (!job) throw new Error('Unknown AI job'); if (job.status === 'no-action') return Object.freeze({ job, event: null, replayed: true, noAction: true }); const proposal = job.validatedOutput;
    try { await this.#assertCurrentEligibility(scope, job, proposal); return await this.#jobs.commit({ scope, jobId, commitCanonical: values => this.#commitCanonical(scope, job, values) }); } catch (error) { const current = await this.#jobs.get({ scope, jobId }); if (current?.status === 'validated') await this.#jobs.supersede({ scope, jobId, reason: String(error.message || 'commit-eligibility-changed').slice(0, 256) }); throw error; }
  }

  async providerFailure({ scope, jobId, kind }) { const safeKinds = new Set(['timeout', 'network-error', 'malformed-response', 'empty-response', 'provider-refusal', 'rate-limit', 'cancelled-request', 'partial-stream']); const reason = safeKinds.has(kind) ? kind : 'provider-failure'; return this.#jobs.fail({ scope, jobId, reason }); }
  cancel(input) { return this.#jobs.cancel(input); }
  reconcileSource(input) { return this.#jobs.reconcileSource(input); }

  #assertOutputShape(action, result) { const allowed = ALLOWED_OUTPUT_KEYS[action]; if (!allowed) throw new Error('Unknown autonomous social result action'); for (const key of Object.keys(result)) if (!allowed.has(key)) throw new Error(`Model output may not control ${key}`); }
  async #validateEnvelope(scope, { action, actorId, accountId, actionEnvelope }) {
    const input = structuredClone(actionEnvelope || {}); delete input.allowAiCascade; const output = { ...input };
    if (action === AUTONOMOUS_SOCIAL_ACTION.FEED_POST || action === AUTONOMOUS_SOCIAL_ACTION.START_LIVE) output.audience = await this.#social.resolveAudience({ scope, authorAccountId: accountId, audience: normalizeSocialAudience(input.audience || { kind: SOCIAL_AUDIENCE.PUBLIC }) });
    if (SOCIAL_COMMENT_ACTIONS.has(action) || SOCIAL_ENGAGEMENT_ACTIONS.has(action)) output.postId = requireText(input.postId, 'actionEnvelope.postId');
    if (action === AUTONOMOUS_SOCIAL_ACTION.FEED_REPLY) output.parentCommentId = requireText(input.parentCommentId, 'actionEnvelope.parentCommentId');
    if (LIVE_MESSAGE_ACTIONS.has(action) || action === AUTONOMOUS_SOCIAL_ACTION.LIVE_REACTION || action === AUTONOMOUS_SOCIAL_ACTION.END_LIVE) output.sessionId = requireText(input.sessionId, 'actionEnvelope.sessionId');
    if (action === AUTONOMOUS_SOCIAL_ACTION.LIVE_REACTION) { output.reactionKind = input.reactionKind || LIVE_REACTION_KIND.HEART; if (!Object.values(LIVE_REACTION_KIND).includes(output.reactionKind)) throw new Error('Unsupported bounded Live reaction'); }
    output.actorId = requireText(actorId, 'actorId'); output.accountId = requireText(accountId, 'accountId'); return Object.freeze(output);
  }
  async #normalizeProposal(scope, job, result) {
    const action = result.action; const proposal = { action };
    if (action === AUTONOMOUS_SOCIAL_ACTION.FEED_POST) proposal.text = boundedText(result.text, 'post text', AUTONOMOUS_SOCIAL_BOUNDS.postText);
    if (SOCIAL_COMMENT_ACTIONS.has(action)) proposal.text = boundedText(result.text, 'comment text', AUTONOMOUS_SOCIAL_BOUNDS.commentText);
    if (action === AUTONOMOUS_SOCIAL_ACTION.FEED_QUOTE) proposal.text = boundedText(result.text, 'quote text', AUTONOMOUS_SOCIAL_BOUNDS.quoteText);
    if (SOCIAL_ENGAGEMENT_ACTIONS.has(action) || action === AUTONOMOUS_SOCIAL_ACTION.LIVE_REACTION) proposal.active = result.active !== false;
    if (action === AUTONOMOUS_SOCIAL_ACTION.START_LIVE) { proposal.title = boundedText(result.title, 'Live title', AUTONOMOUS_SOCIAL_BOUNDS.liveTitle); proposal.topic = boundedText(result.topic, 'Live topic', AUTONOMOUS_SOCIAL_BOUNDS.liveTopic); proposal.description = String(result.description ?? '').trim(); if (proposal.description.length > AUTONOMOUS_SOCIAL_BOUNDS.liveDescription) throw new Error('Live description exceeds its bounded output limit'); }
    if (LIVE_MESSAGE_ACTIONS.has(action)) proposal.text = boundedText(result.text, 'Live turn text', AUTONOMOUS_SOCIAL_BOUNDS.liveTurnText);
    return Object.freeze(proposal);
  }
  async #assertCurrentEligibility(scope, job, proposal) {
    if (!proposal) throw new Error('AI job has no validated proposal'); const envelope = job.actionEnvelope;
    if (proposal.action === AUTONOMOUS_SOCIAL_ACTION.FEED_POST || proposal.action === AUTONOMOUS_SOCIAL_ACTION.START_LIVE) { const current = await this.#social.resolveAudience({ scope, authorAccountId: job.targetAccountId, audience: envelope.audience }); if (JSON.stringify(current) !== JSON.stringify(envelope.audience)) throw new Error('Autonomous social Audience envelope became stale'); return; }
    if (SOCIAL_COMMENT_ACTIONS.has(proposal.action) || SOCIAL_ENGAGEMENT_ACTIONS.has(proposal.action)) { const post = await this.#social.getPost({ scope, postId: envelope.postId }); if (!post) throw new Error('Autonomous social target post is unavailable or retracted'); await this.#assertKnown(scope, job, envelope.postId); if (proposal.action === AUTONOMOUS_SOCIAL_ACTION.FEED_REPLY) { const parent = await this.#social.getComment({ scope, commentId: envelope.parentCommentId }); if (!parent || parent.postId !== post.postId) throw new Error('Autonomous reply parent is unavailable or invalid'); await this.#assertKnown(scope, job, envelope.parentCommentId); } return; }
    const session = await this.#live.getSession({ scope, sessionId: envelope.sessionId }); if (!session) throw new Error('Autonomous Live target is unavailable or retracted'); if (proposal.action === AUTONOMOUS_SOCIAL_ACTION.END_LIVE) { if (session.status !== LIVE_STATUS.ACTIVE || session.hostAccountId !== job.targetAccountId) throw new Error('Only the authorized host may end an active Live'); return; } if (session.status !== LIVE_STATUS.ACTIVE) throw new Error('Autonomous Live action requires an active session'); if (proposal.action === AUTONOMOUS_SOCIAL_ACTION.LIVE_HOST_TURN && session.hostAccountId !== job.targetAccountId) throw new Error('Live host turn Account mismatch'); await this.#assertKnown(scope, job, session.sessionId);
  }
  async #assertKnown(scope, job, subjectId) { const result = await this.#knowledge.queryAuthorizedKnowledge({ scope, actorId: job.targetActorId, instanceId: job.targetInstanceId, purpose: 'model-generation', limit: 200 }); if (!result.items.some(item => item.subject?.id === subjectId)) throw new Error('Autonomous Actor lacks canonical Knowledge of the target'); }
  async #commitCanonical(scope, job, values) {
    const envelope = job.actionEnvelope; const proposal = values.output; const common = { scope, source: { authority: 'tmrw-v3-autonomous-social', kind: 'ai-generated-social', recordId: job.id, version: job.generationConfig.version }, producer: 'autonomous-social-gate-shadow', idempotencyKey: values.idempotencyKey, aiJobCommit: values.aiJobCommit, causeEventIds: values.causeEventIds };
    if (proposal.action === AUTONOMOUS_SOCIAL_ACTION.FEED_POST) return this.#social.createPost({ ...common, authorAccountId: job.targetAccountId, actualAuthorActorId: job.targetActorId, actualAuthorInstanceId: job.targetInstanceId, deviceId: job.targetDeviceId, text: proposal.text, audience: envelope.audience, audienceSnapshot: envelope.audience });
    if (SOCIAL_COMMENT_ACTIONS.has(proposal.action)) return this.#social.createComment({ ...common, postId: envelope.postId, parentCommentId: proposal.action === AUTONOMOUS_SOCIAL_ACTION.FEED_REPLY ? envelope.parentCommentId : null, authorAccountId: job.targetAccountId, actualAuthorActorId: job.targetActorId, actualAuthorInstanceId: job.targetInstanceId, deviceId: job.targetDeviceId, text: proposal.text });
    if (SOCIAL_ENGAGEMENT_ACTIONS.has(proposal.action)) return this.#social.setEngagement({ ...common, targetId: envelope.postId, targetKind: 'post', kind: proposal.action === AUTONOMOUS_SOCIAL_ACTION.FEED_REACTION ? ENGAGEMENT_KIND.LIKE : proposal.action === AUTONOMOUS_SOCIAL_ACTION.FEED_REPOST ? ENGAGEMENT_KIND.REPOST : ENGAGEMENT_KIND.QUOTE_REPOST, actorAccountId: job.targetAccountId, actualActorId: job.targetActorId, actualInstanceId: job.targetInstanceId, active: proposal.active, quoteText: proposal.text || null });
    if (proposal.action === AUTONOMOUS_SOCIAL_ACTION.START_LIVE) return this.#live.createSession({ ...common, hostAccountId: job.targetAccountId, actualActorId: job.targetActorId, actualAuthorId: job.targetActorId, actualInstanceId: job.targetInstanceId, deviceId: job.targetDeviceId, title: proposal.title, topic: proposal.topic, description: proposal.description, audience: envelope.audience, audienceSnapshot: envelope.audience, startImmediately: true });
    if (LIVE_MESSAGE_ACTIONS.has(proposal.action)) return this.#live.createMessage({ ...common, sessionId: envelope.sessionId, authorAccountId: job.targetAccountId, actualAuthorActorId: job.targetActorId, actualAuthorInstanceId: job.targetInstanceId, deviceId: job.targetDeviceId, text: proposal.text });
    if (proposal.action === AUTONOMOUS_SOCIAL_ACTION.LIVE_REACTION) return this.#live.setReaction({ ...common, sessionId: envelope.sessionId, kind: envelope.reactionKind, actorAccountId: job.targetAccountId, actualActorId: job.targetActorId, actualInstanceId: job.targetInstanceId, active: proposal.active });
    if (proposal.action === AUTONOMOUS_SOCIAL_ACTION.END_LIVE) return this.#live.endSession({ ...common, sessionId: envelope.sessionId });
    throw new Error('Autonomous social action has no canonical commit adapter');
  }
}
