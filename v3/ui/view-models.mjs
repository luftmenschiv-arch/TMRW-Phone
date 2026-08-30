import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { isPlayerControlled } from '../domain/identity/control-authority.mjs';
import { CallCoordinator } from '../application/call-coordinator.mjs';
import { VoiceProfileService } from '../application/voice-profile-service.mjs';
import { VoiceAudioHistoryService } from '../application/voice-audio-history-service.mjs';
import { createPhase19VoiceCapabilityState } from '../domain/voice/voice-capability.mjs';

const emptyCallUi = () => Object.freeze({ sessions: Object.freeze([]), history: Object.freeze([]), transcript: Object.freeze([]), selectedCallSessionId: null, island: Object.freeze({ kind: 'empty', title: 'No calls yet', callSessionId: null, actions: Object.freeze([]) }), dialTargets: Object.freeze([]), owner: Object.freeze({ available: false, canAct: false, inspectionOnly: true, reason: 'unavailable' }), metrics: Object.freeze({ eventHistoryScans: 0, callsLoaded: 0, transcriptLoaded: 0, timers: 0, pollers: 0 }) });

export class PhoneShellViewModels {
  #unitOfWork; #phones; #contacts; #settings; #messaging; #calls; #callCoordinator; #social; #insungram; #live; #notifications; #voiceProfiles; #voiceAudio; #voiceCapability;
  constructor({ database, phoneStateService, contactService, settingsService, messageService = null, callService = null, callCoordinator = null, socialService = null, insungramService = null, liveService = null, notificationService = null, voiceProfileService = null, voiceAudioHistoryService = null, voiceCapability = null }) {
    this.#unitOfWork = new V3UnitOfWork(database); this.#phones = phoneStateService; this.#contacts = contactService; this.#settings = settingsService; this.#messaging = messageService; this.#calls = callService; this.#callCoordinator = callCoordinator || (callService ? new CallCoordinator({ database, callService, phoneStateService }) : null); this.#social = socialService; this.#insungram = insungramService; this.#live = liveService; this.#notifications = notificationService; this.#voiceProfiles = voiceProfileService || new VoiceProfileService({ database }); this.#voiceAudio = voiceAudioHistoryService || new VoiceAudioHistoryService({ database }); this.#voiceCapability = voiceCapability || createPhase19VoiceCapabilityState();
  }
  get messagingEnabled() { return Boolean(this.#messaging); }
  get callsEnabled() { return Boolean(this.#callCoordinator); }
  get callCoordinator() { return this.#callCoordinator; }
  get voiceProfiles() { return this.#voiceProfiles; }
  get voiceAudioHistory() { return this.#voiceAudio; }
  get voiceCapability() { return this.#voiceCapability; }
  setContinueStoryAfterCalls({ scope, playerInstanceId, enabled }) { return this.#settings.setContinueStoryAfterCalls({ scope, playerInstanceId, enabled }); }
  setVoiceCalls({ scope, playerInstanceId, enabled }) { return this.#settings.setVoiceCalls({ scope, playerInstanceId, enabled }); }
  setBotCallsWithVoice({ scope, playerInstanceId, enabled }) { return this.#settings.setBotCallsWithVoice({ scope, playerInstanceId, enabled }); }
  setVoiceLanguagePreference({ scope, playerInstanceId, language }) { return this.#settings.setVoiceLanguagePreference({ scope, playerInstanceId, language }); }
  setVoiceDefaultDelivery({ scope, playerInstanceId, delivery }) { return this.#settings.setVoiceDefaultDelivery({ scope, playerInstanceId, delivery }); }
  get socialEnabled() { return Boolean(this.#social); }
  get liveEnabled() { return Boolean(this.#live); }
  get notificationsEnabled() { return Boolean(this.#notifications); }
  async deviceRoster(scopeInput) {
    const scope = requireEventScope(scopeInput);
    return this.#unitOfWork.readonly({ stores: ['phoneStates', 'instances', 'actors'], scope }, async repositories => {
      const states = await repositories.phoneStates.list(); const roster = [];
      for (const state of states) { const instance = await repositories.instances.get(state.deviceOwnerInstanceId); const actor = instance && await repositories.actors.get(instance.actorId); if (!instance || !actor) continue; roster.push(Object.freeze({ deviceId: state.deviceId, actorId: actor.id, instanceId: instance.id, label: actor.displayName, kind: isPlayerControlled(actor) ? 'my-phone' : 'their-phone', lockState: state.lockState })); }
      return Object.freeze(roster.sort((left, right) => (left.kind === 'my-phone' ? -1 : right.kind === 'my-phone' ? 1 : left.label.localeCompare(right.label) || left.deviceId.localeCompare(right.deviceId))));
    });
  }
  async selected({ scope: inputScope, deviceId, playerActorId, playerInstanceId, route, controller, selectedThreadId = null, selectedCallSessionId = null }) {
    const scope = requireEventScope(inputScope); const [settings, opened] = await Promise.all([this.#settings.get({ scope, playerInstanceId }), controller.open({ scope, deviceId, playerActorId, playerInstanceId, settings: await this.#settings.get({ scope, playerInstanceId }), appId: route === 'diagnostics' ? 'diagnostics' : route })]);
    const contacts = (route === 'contacts' || route === 'calls') && opened.authorization.granted && opened.perspective.accountId ? await this.#contacts.listContacts({ scope, ownerAccountId: opened.perspective.accountId }) : Object.freeze([]);
    const threads = route === 'messages' && this.#messaging && opened.authorization.granted && opened.perspective.accountId ? await this.#messaging.listThreads({ scope, viewerAccountId: opened.perspective.accountId }) : Object.freeze([]);
    const activeThreadId = threads.some(thread => thread.threadId === selectedThreadId) ? selectedThreadId : (threads[0]?.threadId || null);
    const messages = route === 'messages' && this.#messaging && activeThreadId && opened.authorization.granted && opened.perspective.accountId ? await this.#messaging.listMessages({ scope, viewerAccountId: opened.perspective.accountId, threadId: activeThreadId }) : Object.freeze([]);
    const callUi = route === 'calls' && this.#callCoordinator && opened.authorization.granted && opened.perspective.accountId ? await this.#callCoordinator.view({ scope, deviceId: opened.perspective.deviceId, playerActorId, playerInstanceId, selectedCallSessionId, contacts }) : emptyCallUi();
    const calls = callUi.sessions;
    const activeCallSessionId = callUi.selectedCallSessionId;
    const transcripts = callUi.transcript;
    const feed = route === 'feed' && this.#social && opened.authorization.granted && opened.perspective.accountId ? await this.#social.listFeed({ scope, viewerAccountId: opened.perspective.accountId, limit: 20 }) : Object.freeze({ items: Object.freeze([]), nextCursor: null });
    const insungramThreads = route === 'insungram' && this.#insungram && opened.authorization.granted && opened.perspective.accountId ? await this.#insungram.conversations({ scope, viewerAccountId: opened.perspective.accountId, limit: 20 }) : Object.freeze([]);
    const socialProfile = route === 'insungram' && this.#insungram && opened.perspective.accountId ? await this.#insungram.profile({ scope, accountId: opened.perspective.accountId }) : null;
    const liveSessions = route === 'live' && this.#live && opened.authorization.granted && opened.perspective.accountId ? await this.#live.listSessions({ scope, viewerAccountId: opened.perspective.accountId, limit: 20 }) : Object.freeze({ items: Object.freeze([]), nextCursor: null });
    const selectedLive = liveSessions.items.find(row => row.status === 'active') || liveSessions.items[0] || null;
    const liveViewers = selectedLive ? await this.#live.listViewers({ scope, sessionId: selectedLive.sessionId, limit: 20 }) : Object.freeze({ items: Object.freeze([]), count: 0 });
    const liveMessages = selectedLive ? await this.#live.listMessages({ scope, viewerAccountId: opened.perspective.accountId, sessionId: selectedLive.sessionId, limit: 30 }) : Object.freeze({ items: Object.freeze([]), nextCursor: null });
    const phoneWorld = this.#notifications && opened.authorization.granted && opened.perspective.accountId ? await this.#notifications.phoneWorld({ scope, accountId: opened.perspective.accountId, deviceId: opened.perspective.deviceId, recentLimit: route === 'notifications' ? 25 : 5 }) : Object.freeze({ badges: Object.freeze({}), recent: Object.freeze([]), unreadTotal: 0, activeLiveAlerts: 0 });
    return Object.freeze({ settings, opened, contacts, threads, messages, activeThreadId, calls, transcripts, activeCallSessionId, callUi, feed, insungramThreads, socialProfile, liveSessions, selectedLive, liveViewers, liveMessages, phoneWorld, messagingEnabled: Boolean(this.#messaging), callsEnabled: Boolean(this.#callCoordinator), socialEnabled: Boolean(this.#social), liveEnabled: Boolean(this.#live), notificationsEnabled: Boolean(this.#notifications), renderMetrics: Object.freeze({ canonicalEventHistoryScans: callUi.metrics.eventHistoryScans || 0, selectedPhoneReads: 1, contactsLoaded: contacts.length, threadsLoaded: threads.length, messagesLoaded: messages.length, callsLoaded: calls.length, transcriptsLoaded: transcripts.length, callTimers: callUi.metrics.timers || 0, callPollers: callUi.metrics.pollers || 0, feedPostsLoaded: feed.items.length, insungramThreadsLoaded: insungramThreads.length, liveSessionsLoaded: liveSessions.items.length, liveViewersLoaded: liveViewers.items.length, liveMessagesLoaded: liveMessages.items.length, notificationsLoaded: phoneWorld.recent.length, notificationFullScans: 0 }) });
  }
}
