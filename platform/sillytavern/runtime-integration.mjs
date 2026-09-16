import { normalizeMainRpSource } from './message-events.mjs';

const REGISTRATIONS = new WeakMap();
const QUIET_TYPES = /quiet/i;
const IMPERSONATE_TYPES = /impersonate/i;
const requireFn = (value, name) => { if (typeof value !== 'function') throw new TypeError(`${name} is required`); return value; };
const digest = async text => { const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text || ''))); return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16); };

export class SillyTavernV3RuntimeIntegration {
  #eventSource;
  #types;
  #getContext;
  #scopeResolver;
  #bindingResolver;
  #handoff;
  #phoneContext;
  #callStoryIntegration;
  #smartContactDiscovery;
  #walletRpEvidence;
  #discardPartialAssistant;
  #authoringEnabled;
  #listeners = [];
  #registered = false;
  #metrics = { processed: 0, skipped: 0, duplicateRegistrations: 0, abortCalls: 0, roleCallsIntercepted: 0, activeCallGenerationBlocks: 0, smartContactEvaluations: 0, smartContactDiscoveries: 0, smartContactErrors: 0, lastSmartContactError: null };

  constructor({ eventSource, eventTypes, getContext, scopeResolver, bindingResolver, handoffCoordinator, phoneContextBuilder, callStoryIntegration = null, smartContactDiscovery = null, walletRpEvidence = null, discardPartialAssistant = null, authoringEnabled = () => false }) {
    if (!eventSource?.on || !eventSource?.removeListener) throw new TypeError('Real SillyTavern eventSource API is required');
    this.#eventSource = eventSource;
    this.#types = eventTypes || {};
    this.#getContext = requireFn(getContext, 'getContext');
    this.#scopeResolver = requireFn(scopeResolver, 'scopeResolver');
    this.#bindingResolver = requireFn(bindingResolver, 'bindingResolver');
    this.#handoff = handoffCoordinator;
    this.#phoneContext = phoneContextBuilder;
    this.#callStoryIntegration = callStoryIntegration;
    this.#smartContactDiscovery = smartContactDiscovery;
    this.#walletRpEvidence = walletRpEvidence;
    if (smartContactDiscovery && (typeof smartContactDiscovery.evaluate !== 'function' || typeof smartContactDiscovery.couldContainEvidence !== 'function')) throw new TypeError('Smart Contact discovery integration requires evaluate/couldContainEvidence');
    this.#discardPartialAssistant = typeof discardPartialAssistant === 'function' ? discardPartialAssistant : async ({ afterSourceOrdinal } = {}) => {
      const chat = this.#getContext()?.chat;
      if (!Array.isArray(chat) || !Number.isInteger(afterSourceOrdinal)) return 0;
      let removed = 0;
      for (let index = chat.length - 1; index > afterSourceOrdinal; index -= 1) {
        if (chat[index]?.is_user) continue;
        chat.splice(index, 1); removed += 1;
      }
      return removed;
    };
    this.#authoringEnabled = requireFn(authoringEnabled, 'authoringEnabled');
    if (!handoffCoordinator?.processSource || !handoffCoordinator?.retractSource) throw new TypeError('Phase 10 handoff coordinator is required');
  }

  get metrics() { return structuredClone(this.#metrics); }

  register() {
    if (this.#registered) return false;
    const owner = REGISTRATIONS.get(this.#eventSource);
    if (owner && owner !== this) { this.#metrics.duplicateRegistrations += 1; return false; }
    const on = (key, handler) => {
      const type = this.#types[key];
      if (!type) throw new Error(`Installed SillyTavern lacks event type ${key}`);
      this.#eventSource.on(type, handler);
      this.#listeners.push([type, handler]);
    };
    on('MESSAGE_SENT', index => this.#processIndex(index, { changeKind: 'new', role: 'user', mode: 'normal' }));
    on('MESSAGE_RECEIVED', (index, generationType) => this.#processIndex(index, { changeKind: 'new', role: 'assistant', mode: this.#mode(generationType) }));
    on('MESSAGE_SWIPED', index => this.#processIndex(index, { changeKind: 'swipe', role: 'assistant', mode: 'normal' }));
    on('MESSAGE_EDITED', index => this.#processIndex(index, { changeKind: 'revision', mode: 'normal' }));
    on('MESSAGE_DELETED', index => this.#retractIndex(index));
    on('IMPERSONATE_READY', () => { this.#metrics.skipped += 1; });
    this.#registered = true;
    REGISTRATIONS.set(this.#eventSource, this);
    return true;
  }

  unregister() {
    if (!this.#registered) return false;
    for (const [type, handler] of this.#listeners.splice(0)) this.#eventSource.removeListener(type, handler);
    this.#registered = false;
    if (REGISTRATIONS.get(this.#eventSource) === this) REGISTRATIONS.delete(this.#eventSource);
    return true;
  }

  #mode(type) {
    const value = String(type || '');
    if (QUIET_TYPES.test(value)) return 'quiet';
    if (IMPERSONATE_TYPES.test(value)) return 'impersonate';
    return 'normal';
  }

  async #source(index, options) {
    const context = this.#getContext();
    const message = context?.chat?.[index];
    if (!message) return null;
    const scope = await this.#scopeResolver(context);
    const binding = await this.#bindingResolver({ context, scope, message, index, role: options.role || (message.is_user ? 'user' : 'assistant') });
    if (!binding?.actorBinding) return null;
    const chatKey = String(context.chatId ?? context.getCurrentChatId?.() ?? context.groupId ?? 'unscoped');
    const version = `${Number(message.swipe_id || 0)}:${await digest(message.mes)}`;
    return {
      scope,
      source: normalizeMainRpSource({
        sourceAuthority: 'sillytavern-main-rp',
        sourceMessageId: `${chatKey}:${index}`,
        sourceVersionId: version,
        sourceOrdinal: Number(index),
        role: options.role || (message.is_user ? 'user' : 'assistant'),
        mode: options.mode,
        origin: 'main-rp',
        text: String(message.mes || ''),
        changeKind: options.changeKind,
        actorBinding: binding.actorBinding,
        mentionBindings: binding.mentionBindings || {},
        explicitPhoneActions: binding.explicitPhoneActions || message.extra?.tmrwPhoneActions || [],
      }),
    };
  }

  async #latestUserSource() {
    const context = this.#getContext();
    const chat = context?.chat || [];
    for (let index = chat.length - 1; index >= 0; index -= 1) {
      if (chat[index]?.is_user) return this.#source(index, { changeKind: 'new', role: 'user', mode: 'normal' });
    }
    return null;
  }

  async #observeSmartContact(input) {
    if (!this.#smartContactDiscovery) return null;
    try {
      const result = await this.#smartContactDiscovery.evaluate(input);
      this.#metrics.smartContactEvaluations += result?.evaluated === true ? 1 : 0;
      this.#metrics.smartContactDiscoveries += result?.discovered === true && result?.replayed !== true ? 1 : 0;
      this.#metrics.lastSmartContactError = null;
      return result;
    } catch (error) {
      this.#metrics.smartContactErrors += 1;
      this.#metrics.lastSmartContactError = String(error?.message || error || 'smart-contact-discovery-error');
      return Object.freeze({ evaluated: true, discovered: false, reason: 'evaluation-error', error: this.#metrics.lastSmartContactError });
    }
  }

  async reconcileSmartContactDiscovery({ maxMessages = 1000 } = {}) {
    if (!this.#smartContactDiscovery) return Object.freeze({ available: false, evaluated: 0, discovered: 0, replayed: 0, eligibleWithoutValue: 0, errors: 0, candidates: 0, scanned: 0 });
    if (!this.#authoringEnabled()) return Object.freeze({ available: true, skipped: 'authoring-disabled', evaluated: 0, discovered: 0, replayed: 0, eligibleWithoutValue: 0, errors: 0, candidates: 0, scanned: 0 });
    const limit = Math.max(1, Math.min(5000, Number(maxMessages) || 1000));
    const chat = this.#getContext()?.chat || [];
    const start = Math.max(0, chat.length - limit);
    let evaluated = 0; let discovered = 0; let replayed = 0; let eligibleWithoutValue = 0; let errors = 0; let candidates = 0;
    for (let index = start; index < chat.length; index += 1) {
      const message = chat[index];
      if (!message || !this.#smartContactDiscovery.couldContainEvidence(message.mes)) continue;
      candidates += 1;
      try {
        const input = await this.#source(index, { changeKind: 'reprocess', role: message.is_user ? 'user' : 'assistant', mode: 'normal' });
        if (!input) continue;
        const result = await this.#observeSmartContact(input);
        if (result?.evaluated) evaluated += 1;
        if (result?.discovered) discovered += 1;
        if (result?.replayed) replayed += 1;
        if (result?.reason === 'eligible-number-value-unavailable') eligibleWithoutValue += 1;
        if (result?.reason === 'evaluation-error') errors += 1;
      } catch (error) {
        errors += 1;
        this.#metrics.smartContactErrors += 1;
        this.#metrics.lastSmartContactError = String(error?.message || error || 'smart-contact-reconciliation-error');
      }
    }
    return Object.freeze({ available: true, evaluated, discovered, replayed, eligibleWithoutValue, errors, candidates, scanned: chat.length - start, truncated: start > 0 });
  }

  async reconcileHistory({ startOrdinal = 0, endOrdinal = null, onProgress = null } = {}) {
    if (!this.#authoringEnabled()) return Object.freeze({ skipped: 'authoring-disabled', processed: 0, unresolved: 0, failed: 0 });
    const chat = this.#getContext()?.chat || []; const start = Math.max(0, Math.trunc(Number(startOrdinal) || 0)); const end = Math.max(start, Math.min(chat.length, endOrdinal == null ? chat.length : Math.trunc(Number(endOrdinal) || 0)));
    let processed = 0; let unresolved = 0; let failed = 0;
    for (let index = start; index < end; index += 1) {
      const message = chat[index]; if (!message) continue;
      try { const result = await this.#processIndex(index, { changeKind: 'reprocess', role: message.is_user ? 'user' : 'assistant', mode: 'normal' }); if (result?.skipped) unresolved += 1; else processed += 1; }
      catch { failed += 1; }
      onProgress?.(Object.freeze({ ordinal: index + 1, endOrdinal: end, processed, unresolved, failed }));
    }
    return Object.freeze({ startOrdinal: start, endOrdinal: end, processed, unresolved, failed });
  }

  async #processIndex(index, options) {
    if (!this.#authoringEnabled()) { this.#metrics.skipped += 1; return { skipped: 'authoring-disabled' }; }
    if (options.mode !== 'normal') { this.#metrics.skipped += 1; return { skipped: options.mode }; }
    const input = await this.#source(Number(index), options);
    if (!input) { this.#metrics.skipped += 1; return { skipped: 'unresolved' }; }
    await this.#observeSmartContact(input);

    if (options.role === 'user' && this.#callStoryIntegration?.interceptRoleTriggeredCall) {
      const intercepted = await this.#callStoryIntegration.interceptRoleTriggeredCall({ scope: input.scope, source: input.source });
      if (intercepted.intercepted) {
        this.#metrics.processed += 1;
        this.#metrics.roleCallsIntercepted += 1;
        return intercepted;
      }
    }

    const result = await this.#handoff.processSource(input);
    try { await this.#walletRpEvidence?.evaluate?.(input); } catch {}
    this.#metrics.processed += 1;
    return result;
  }

  async #retractIndex(index) {
    if (!this.#authoringEnabled()) { this.#metrics.skipped += 1; return []; }
    const context = this.#getContext();
    const scope = await this.#scopeResolver(context);
    const chatKey = String(context.chatId ?? context.getCurrentChatId?.() ?? context.groupId ?? 'unscoped');
    const result = await this.#handoff.retractSource({ scope, sourceAuthority: 'sillytavern-main-rp', sourceMessageId: `${chatKey}:${Number(index)}`, reason: 'SillyTavern source message deleted' });
    try { await this.#walletRpEvidence?.retractSource?.({ scope, sourceMessageId: `${chatKey}:${Number(index)}` }); } catch {}
    this.#metrics.processed += 1;
    return result;
  }

  async generateInterceptor(chat, contextSize, abort, type) {
    if (this.#mode(type) !== 'normal' || !this.#authoringEnabled()) { this.#metrics.skipped += 1; return; }
    const context = this.#getContext();
    const scope = await this.#scopeResolver(context);
    const userInput = await this.#latestUserSource();
    const abortGeneration = immediately => { this.#metrics.abortCalls += 1; abort(immediately); };

    if (this.#callStoryIntegration && userInput) {
      const guard = await this.#callStoryIntegration.guardMainRpGeneration({
        scope,
        accountId: userInput.source.actorBinding.accountId,
        abortGeneration,
        discardPartialAssistant: details => this.#discardPartialAssistant?.({ ...details, afterSourceOrdinal: userInput.source.sourceOrdinal, sourceMessageId: userInput.source.sourceMessageId }),
      });
      if (guard.blocked) { this.#metrics.activeCallGenerationBlocks += 1; return; }

      const intercepted = await this.#callStoryIntegration.interceptRoleTriggeredCall({
        scope,
        source: userInput.source,
        abortGeneration,
        discardPartialAssistant: this.#discardPartialAssistant,
      });
      if (intercepted.intercepted) { this.#metrics.roleCallsIntercepted += 1; return; }
    }

    const target = await this.#bindingResolver({ context, scope, message: context?.chat?.at(-1), index: context?.chat?.length - 1, role: 'assistant-target', promptTarget: true });
    if (!target?.actorBinding || !this.#phoneContext?.build) return;
    const block = await this.#phoneContext.build({ scope, actorId: target.actorBinding.actorId, instanceId: target.actorBinding.instanceId });
    if (!block.text || chat.some(row => row?.tmrwV3Context === true)) return;
    chat.splice(0, 0, { role: 'system', name: 'TMRW—Phone v3', content: block.text, mes: block.text, is_system: true, is_user: false, tmrwV3Context: true });
  }
}

export function createSillyTavernV3RuntimeIntegration(options) { return new SillyTavernV3RuntimeIntegration(options); }
