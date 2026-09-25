import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { requireEventScope } from '../../domain/events/event-validator.mjs';
import { isPlayerControlled } from '../../domain/identity/control-authority.mjs';
import { extractPlayableCastManifest } from './cast-manifest.mjs';
import { readPlayableHistory, recentHistoryWindow } from './history-reader.mjs';
import { PLAYABLE_BOOTSTRAP_STATUS } from '../../ui/settings-beta.mjs';

async function digest(value) { const bytes = new TextEncoder().encode(String(value)); const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 24); }
const emit = (listener, value) => { try { listener?.(Object.freeze({ ...value })); } catch {} };

export class PlayableBootstrapService {
  #unit; #identity; #phones; #settings; #runtime; #initialSeed; #worldPulse; #getContext; #now; #running = null;
  constructor({ database, identityKernel, phoneStateService, settingsService, runtimeIntegration = null, initialPhoneSeedService = null, adaptiveWorldPulseService = null, getContext, now = () => new Date().toISOString() }) {
    if (!database || !identityKernel || !phoneStateService || !settingsService || typeof getContext !== 'function') throw new TypeError('PlayableBootstrapService requires database, identity, phone, settings, and SillyTavern context');
    this.#unit = new V3UnitOfWork(database); this.#identity = identityKernel; this.#phones = phoneStateService; this.#settings = settingsService; this.#runtime = runtimeIntegration; this.#initialSeed = initialPhoneSeedService; this.#worldPulse = adaptiveWorldPulseService; this.#getContext = getContext; this.#now = now;
  }

  async status({ scope, playerInstanceId }) { return (await this.#settings.get({ scope, playerInstanceId })).playableBootstrap; }

  async preview() { return extractPlayableCastManifest(this.#getContext() || {}); }

  async #set(scope, playerInstanceId, patch) { const current = await this.status({ scope, playerInstanceId }); const next = { ...current, ...patch }; await this.#settings.setPlayableBootstrapState({ scope, playerInstanceId, state: next }); return next; }

  async #identitySeed(scope, playerInstanceId, manifest, headFingerprint) {
    return this.#unit.readonly({ stores: ['stories', 'branches', 'characterCards', 'instances', 'actors', 'accounts', 'characterCardActors'], scope }, async repositories => {
      const story = await repositories.stories.get(scope.storyId); const branch = await repositories.branches.get(scope.branchId); const card = story && await repositories.characterCards.get(story.characterCardId); const playerInstance = await repositories.instances.get(playerInstanceId); const playerActor = playerInstance && await repositories.actors.get(playerInstance.actorId);
      if (!story || !branch || !card || !playerInstance || !playerActor || !isPlayerControlled(playerActor)) throw new Error('Playable bootstrap cannot resolve the current canonical Story/Branch/player identity');
      const playerAccounts = await repositories.accounts.listByIndex('by_owner_scope', [scope.storyId, scope.branchId, playerInstance.id]);
      const activeMemberships = await repositories.characterCardActors.listByIndex('by_card_status', [card.id, 'active']); const existingActors = [];
      for (const membership of activeMemberships) { const actor = await repositories.actors.get(membership.actorId); if (actor) existingActors.push(actor); }
      const byName = new Map(existingActors.map(actor => [String(actor.displayName || '').normalize('NFKC').toLocaleLowerCase(), actor]));
      const cast = manifest.approvedCast.map(row => { const existing = byName.get(row.displayName.normalize('NFKC').toLocaleLowerCase()); return { sourceActorId: existing?.sourceActorId || row.sourceActorId, displayName: row.displayName, aliases: [...new Set([...(existing?.aliases || []), ...(row.aliases || [])])] }; });
      const manifestId = `playable-bootstrap:v1:${await digest(JSON.stringify([scope.storyId, scope.branchId, headFingerprint, cast.map(row => row.sourceActorId)]))}`;
      return Object.freeze({ manifestId, sourceAuthority: story.sourceAuthority, card: { sourceCardId: card.sourceCardId, displayName: card.displayName, aliases: card.aliases }, story: { sourceStoryId: story.sourceStoryId, title: story.title }, branch: { sourceRouteId: branch.sourceRouteId, label: branch.label, parentBranchId: branch.parentBranchId }, user: { displayName: playerActor.displayName, aliases: playerActor.aliases, displayNameOverride: playerInstance.displayNameOverride, instanceAliases: playerInstance.aliases, accounts: playerAccounts.map(account => ({ key: account.accountKey, kind: account.kind, label: account.label, isPrimary: account.isPrimary })) }, cast });
    });
  }

  run(input) {
    if (this.#running) return this.#running;
    this.#running = this.#run(input).finally(() => { this.#running = null; });
    return this.#running;
  }

  async #run({ scope: inputScope, playerInstanceId, approvedSourceActorIds = null, selectionConfirmed = false, onProgress = null, recentMessages = 48, deepBackfill = true } = {}) {
    const scope = requireEventScope(inputScope); const context = this.#getContext() || {}; const totalMessages = Array.isArray(context.chat) ? context.chat.length : 0; const runId = `bootstrap:${await digest(`${scope.storyId}:${scope.branchId}:${totalMessages}:${this.#now()}`)}`;
    let activeStage = 'starting'; const enrichmentWarnings = [];
    const progress = async (stage, patch = {}) => { activeStage = stage; const state = await this.#set(scope, playerInstanceId, { status: PLAYABLE_BOOTSTRAP_STATUS.RUNNING, stage, runId, totalMessages, lastError: null, ...patch }); emit(onProgress, state); return state; };
    const baseline = await this.status({ scope, playerInstanceId });
    try {
      const discovered = await extractPlayableCastManifest(context); const approvedIds = Array.isArray(approvedSourceActorIds) ? new Set(approvedSourceActorIds.map(String)) : new Set(discovered.approvedCast.map(row => row.sourceActorId));
      const selectedCast = discovered.cast.filter(row => approvedIds.has(row.sourceActorId)); const manifest = Object.freeze({ ...discovered, approvedCast: Object.freeze(selectedCast), candidates: Object.freeze(discovered.cast.filter(row => !approvedIds.has(row.sourceActorId))) });
      if (!manifest.approvedCast.length) throw new Error('No important character selected; กรุณาเลือกตัวละครอย่างน้อยหนึ่งคนก่อนสร้างมือถือ');
      const fullHistory = await readPlayableHistory(context, { chunkMessages: 24, chunkCharacters: 12_000 }); const castFingerprint = await digest(JSON.stringify(manifest.approvedCast.map(row => row.sourceActorId).sort()));
      const previous = baseline; const seed = await this.#identitySeed(scope, playerInstanceId, manifest, fullHistory.headFingerprint);
      const sameHead = previous.status === PLAYABLE_BOOTSTRAP_STATUS.READY && previous.headFingerprint === fullHistory.headFingerprint;
      const sameCast = previous.castFingerprint === castFingerprint || (!previous.castFingerprint && previous.castCount === manifest.approvedCast.length);
      const replayed = sameHead && sameCast;
      await progress('discovering-cast'); const identity = await this.#identity.seedIdentityGraph(seed); await this.#phones.initializeScope(scope, { deviceIds: identity.deviceIds, accountIds: identity.accountIds });
      const quick = recentHistoryWindow(totalMessages, recentMessages); await progress('quick-start', { castCount: manifest.approvedCast.length, candidateCount: manifest.candidates.length, headFingerprint: fullHistory.headFingerprint, processedOrdinal: quick.startOrdinal });
      if (!replayed && this.#runtime?.reconcileHistory) await this.#runtime.reconcileHistory({ ...quick, onProgress: value => emit(onProgress, { status: PLAYABLE_BOOTSTRAP_STATUS.RUNNING, stage: 'quick-start', totalMessages, processedOrdinal: value.ordinal, castCount: manifest.approvedCast.length, candidateCount: manifest.candidates.length }) });
      if (this.#initialSeed) {
        await progress('initial-seed', { castCount: manifest.approvedCast.length, candidateCount: manifest.candidates.length, headFingerprint: fullHistory.headFingerprint, processedOrdinal: totalMessages });
        try { await this.#initialSeed.seed({ scope, context, fingerprint: fullHistory.headFingerprint, deviceIds: identity.deviceIds }); }
        catch (error) { enrichmentWarnings.push(Object.freeze({ stage: 'initial-seed', message: error instanceof Error ? error.message : String(error) })); }
      }
      if (this.#worldPulse) {
        await progress('world-pulse', { castCount: manifest.approvedCast.length, candidateCount: manifest.candidates.length, headFingerprint: fullHistory.headFingerprint, processedOrdinal: totalMessages });
        try { await this.#worldPulse.prepareWorld({ scope, playerInstanceId, force: !replayed }); await this.#worldPulse.prime({ scope, minimum: 6, playerInstanceId }); await this.#worldPulse.primePhoneActivity?.({ scope, playerInstanceId, deviceIds: identity.deviceIds, fingerprint: fullHistory.headFingerprint }); }
        catch (error) { enrichmentWarnings.push(Object.freeze({ stage: 'world-pulse', message: error instanceof Error ? error.message : String(error) })); }
        if (this.#worldPulse.primeBotSavedNames) {
          await progress('bot-saved-names', { castCount: manifest.approvedCast.length, candidateCount: manifest.candidates.length, headFingerprint: fullHistory.headFingerprint, processedOrdinal: totalMessages });
          try {
            const names = await this.#worldPulse.primeBotSavedNames({ scope, playerInstanceId, deviceIds: identity.deviceIds });
            for (const failure of names.failures || []) enrichmentWarnings.push(Object.freeze({ stage: 'bot-saved-names', message: failure.message, ownerInstanceId: failure.ownerInstanceId }));
          } catch (error) { enrichmentWarnings.push(Object.freeze({ stage: 'bot-saved-names', message: error instanceof Error ? error.message : String(error) })); }
        }
      }
      let state = await this.#set(scope, playerInstanceId, { status: PLAYABLE_BOOTSTRAP_STATUS.QUICK_READY, stage: 'quick-ready', runId, totalMessages, processedOrdinal: totalMessages, headFingerprint: fullHistory.headFingerprint, castFingerprint, castCount: manifest.approvedCast.length, candidateCount: manifest.candidates.length, lastError: null }); emit(onProgress, state);
      if (!replayed && deepBackfill && quick.startOrdinal > 0) {
        const chunks = fullHistory.chunks.filter(chunk => chunk.startOrdinal < quick.startOrdinal);
        for (const chunk of chunks) { const endOrdinal = Math.min(chunk.endOrdinal, quick.startOrdinal); if (this.#runtime?.reconcileHistory) await this.#runtime.reconcileHistory({ startOrdinal: chunk.startOrdinal, endOrdinal }); state = await this.#set(scope, playerInstanceId, { ...state, status: PLAYABLE_BOOTSTRAP_STATUS.RUNNING, stage: 'deep-backfill', processedOrdinal: endOrdinal }); emit(onProgress, state); }
      }
      state = await this.#set(scope, playerInstanceId, { status: PLAYABLE_BOOTSTRAP_STATUS.READY, stage: 'ready', runId, totalMessages, processedOrdinal: totalMessages, headFingerprint: fullHistory.headFingerprint, castFingerprint, castCount: manifest.approvedCast.length, candidateCount: manifest.candidates.length, selectionConfirmed: selectionConfirmed === true || baseline.selectionConfirmed === true, selectedSourceActorIds: manifest.approvedCast.map(row => row.sourceActorId), completedAt: this.#now(), lastError: null }); emit(onProgress, state);
      return Object.freeze({ state: Object.freeze(state), manifest, identityManifestId: seed.manifestId, replayed, quickWindow: quick, history: fullHistory, enrichmentWarnings: Object.freeze(enrichmentWarnings) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error); const failed = await this.#set(scope, playerInstanceId, { status: PLAYABLE_BOOTSTRAP_STATUS.FAILED, stage: `failed:${activeStage}`, runId, totalMessages, lastError: message }); emit(onProgress, failed); throw error;
    }
  }
}
