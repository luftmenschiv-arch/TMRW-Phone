import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { isPlayerControlled } from '../domain/identity/control-authority.mjs';
import { CallCoordinator } from '../application/call-coordinator.mjs';
import { VoiceProfileService } from '../application/voice-profile-service.mjs';
import { VoiceAudioHistoryService } from '../application/voice-audio-history-service.mjs';
import { createPhase19VoiceCapabilityState } from '../domain/voice/voice-capability.mjs';
import { GuideStateService } from './guide.mjs';
import { PHONE_NUMBER_DISCOVERY } from './experience-presets.mjs';
import { callDetailsViewModel } from './calls/details.mjs';

const emptyCallUi = () => Object.freeze({ sessions: Object.freeze([]), history: Object.freeze([]), transcript: Object.freeze([]), selectedCallSessionId: null, island: Object.freeze({ kind: 'empty', title: 'No calls yet', callSessionId: null, actions: Object.freeze([]) }), dialTargets: Object.freeze([]), owner: Object.freeze({ available: false, canAct: false, inspectionOnly: true, reason: 'unavailable' }), metrics: Object.freeze({ eventHistoryScans: 0, callsLoaded: 0, transcriptLoaded: 0, timers: 0, pollers: 0 }) });

const GENERIC_PRESENTATION_NAME = /^(?:character(?:\s+card)?|contact|owner|unknown|ไม่ทราบชื่อ|คุณ|ผู้เล่น)$/i;

function presentationDisplayName(...candidates) {
  let generic = null;
  for (const candidate of candidates) {
    const value = String(candidate || '').replace(/\s+Phone Account$/iu, '').trim();
    if (!value || /\{\{[^{}]+\}\}/.test(value)) continue;
    if (GENERIC_PRESENTATION_NAME.test(value)) { generic ||= value; continue; }
    return value;
  }
  return generic || 'เจ้าของเครื่อง';
}

function identityNameKey(value) { return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
function identityNameCollides(value, protectedNames = []) {
  const current = identityNameKey(value); if (current.length < 3) return false;
  return protectedNames.some(name => { const expected = identityNameKey(name); return expected.length >= 3 && (current === expected || current.startsWith(expected) || expected.startsWith(current)); });
}
const isLegacyPhoneFallback = messages => messages.length === 2
  && messages.some(row => String(row?.text || '').startsWith('ช่วงนี้คนแถวนี้กำลังพูดถึงเรื่องนี้กันเยอะ:'))
  && messages.some(row => String(row?.text || '') === 'ไว้ฉันจะลองดูสถานการณ์อีกที');
const isLegacyFeedFallback = post => String(post?.text || '').includes('— คนในพื้นที่มองเรื่องนี้กันอย่างไรบ้าง?');

export class PhoneShellViewModels {
  #unitOfWork; #phones; #contacts; #settings; #playableBootstrap; #worldPulse; #imageProvider; #guide; #messaging; #calls; #callCoordinator; #social; #insungram; #live; #notifications; #phoneWorldUtilities; #calendar; #commerce; #voiceProfiles; #voiceAudio; #voiceCapability; #voiceAdapter; #callTimingDiagnostics;
  constructor({ database, phoneStateService, contactService, settingsService, playableBootstrapService = null, adaptiveWorldPulseService = null, imageProviderService = null, guideService = null, messageService = null, callService = null, callCoordinator = null, socialService = null, insungramService = null, liveService = null, notificationService = null, phoneWorldService = null, calendarService = null, commerceService = null, voiceProfileService = null, voiceAudioHistoryService = null, voiceCapability = null, voiceAdapter = null, callTimingDiagnostics = null }) {
    this.#unitOfWork = new V3UnitOfWork(database); this.#phones = phoneStateService; this.#contacts = contactService; this.#settings = settingsService; this.#playableBootstrap = playableBootstrapService; this.#worldPulse = adaptiveWorldPulseService; this.#imageProvider = imageProviderService; this.#guide = guideService || new GuideStateService({ database }); this.#messaging = messageService; this.#calls = callService; this.#callCoordinator = callCoordinator || (callService ? new CallCoordinator({ database, callService, phoneStateService }) : null); this.#social = socialService; this.#insungram = insungramService; this.#live = liveService; this.#notifications = notificationService; this.#phoneWorldUtilities = phoneWorldService; this.#calendar = calendarService; this.#commerce = commerceService; this.#voiceProfiles = voiceProfileService || new VoiceProfileService({ database }); this.#voiceAudio = voiceAudioHistoryService || new VoiceAudioHistoryService({ database }); this.#voiceCapability = voiceCapability || createPhase19VoiceCapabilityState(); this.#voiceAdapter = voiceAdapter; this.#callTimingDiagnostics = callTimingDiagnostics;
  }
  get messagingEnabled() { return Boolean(this.#messaging); }
  get callsEnabled() { return Boolean(this.#callCoordinator); }
  get callCoordinator() { return this.#callCoordinator; }
  get playableBootstrapAvailable() { return Boolean(this.#playableBootstrap); }
  get phoneActivityRefreshAvailable() { return Boolean(this.#worldPulse?.refreshPhoneActivity); }
  get botSavedNameAvailable() { return Boolean(this.#worldPulse?.generateBotSavedName); }
  get voiceProfiles() { return this.#voiceProfiles; }
  get voiceAudioHistory() { return this.#voiceAudio; }
  get voiceCapability() { return this.#voiceCapability; }
  get imageCapability() { return this.#imageProvider?.capability?.() || Object.freeze({ providerId: 'pixabay', configured: false, available: false, search: true, safeSearch: true }); }
  get callTimingDiagnostics() { return this.#callTimingDiagnostics; }
  async #accountPresentations(scope, accountIds = []) {
    const ids = [...new Set(accountIds.filter(Boolean))]; if (!ids.length) return Object.freeze({});
    return this.#unitOfWork.readonly({ stores: ['accounts', 'instances', 'actors', 'socialPersonas'], scope }, async repositories => {
      const entries = [];
      for (const accountId of ids) {
        const account = await repositories.accounts.get(accountId); if (!account) continue;
        const instance = await repositories.instances.get(account.ownerInstanceId); const actor = instance && await repositories.actors.get(instance.actorId);
        const persona = await repositories.socialPersonas.getByIndex('by_scope_account', [scope.storyId, scope.branchId, accountId]);
        entries.push([accountId, Object.freeze({ accountId, actorId: actor?.id || null, instanceId: instance?.id || null, sourceAuthority: actor?.sourceAuthority || null, label: presentationDisplayName(persona?.displayName, instance?.displayNameOverride, actor?.displayName, ...(actor?.aliases || []), account.label, 'บัญชี'), avatarUrl: persona?.avatarUrl || null, bio: persona?.bio || '', note: persona?.note || '' })]);
      }
      return Object.freeze(Object.fromEntries(entries));
    });
  }
  setPreset({ scope, playerInstanceId, preset }) { return this.#settings.setPreset({ scope, playerInstanceId, preset }); }
  setPhoneNumberDiscovery({ scope, playerInstanceId, value }) { return this.#settings.setPhoneNumberDiscovery({ scope, playerInstanceId, value }); }
  setDeveloperDiagnostics({ scope, playerInstanceId, enabled }) { return this.#settings.setDeveloperDiagnostics({ scope, playerInstanceId, enabled }); }
  resetGuideTips({ scope, playerInstanceId }) { return this.#guide.resetTips({ scope, playerInstanceId }); }
  replayGuideTutorial({ scope, playerInstanceId }) { return this.#guide.replayTutorial({ scope, playerInstanceId }); }
  setContinueStoryAfterCalls({ scope, playerInstanceId, enabled }) { return this.#settings.setContinueStoryAfterCalls({ scope, playerInstanceId, enabled }); }
  getPlayableBootstrapStatus({ scope, playerInstanceId }) { return this.#playableBootstrap ? this.#playableBootstrap.status({ scope, playerInstanceId }) : this.#settings.get({ scope, playerInstanceId }).then(row => row.playableBootstrap); }
  previewPlayableCast() { if (!this.#playableBootstrap) throw new Error('Playable Phone setup is unavailable'); return this.#playableBootstrap.preview(); }
  runPlayableBootstrap(input) { if (!this.#playableBootstrap) throw new Error('Playable Phone setup is unavailable'); return this.#playableBootstrap.run(input); }
  refreshFeed({ scope, count = 3, playerInstanceId = null }) { if (!this.#worldPulse) throw new Error('Adaptive Feed is unavailable'); return this.#worldPulse.refresh({ scope, count, playerInstanceId }); }
  refreshPhoneActivity(input) { if (!this.#worldPulse?.refreshPhoneActivity) throw new Error('Phone conversation refresh is unavailable'); return this.#worldPulse.refreshPhoneActivity(input); }
  generateBotSavedName(input) { if (!this.#worldPulse?.generateBotSavedName) throw new Error('Bot-saved name generation is unavailable'); return this.#worldPulse.generateBotSavedName(input); }
  respondToPlayerSocial(input) { if (!this.#worldPulse) throw new Error('Adaptive Feed replies are unavailable'); return this.#worldPulse.respondToPlayerAction(input); }
  respondToDirectMessage(input) { if (!this.#worldPulse) throw new Error('Adaptive Message replies are unavailable'); return this.#worldPulse.respondToDirectMessage(input); }
  async setImageApiKey({ scope, playerInstanceId, apiKey }) { const settings = await this.#settings.setImageApiKey({ scope, playerInstanceId, apiKey }); this.#imageProvider?.configureApiKey?.(settings.imageApiKey); return settings; }
  setVoiceCalls({ scope, playerInstanceId, enabled }) { return this.#settings.setVoiceCalls({ scope, playerInstanceId, enabled }); }
  setBotCallsWithVoice({ scope, playerInstanceId, enabled }) { return this.#settings.setBotCallsWithVoice({ scope, playerInstanceId, enabled }); }
  setVoiceCaptions({ scope, playerInstanceId, enabled }) { return this.#settings.setVoiceCaptions({ scope, playerInstanceId, enabled }); }
  setVoiceLanguagePreference({ scope, playerInstanceId, language }) { return this.#settings.setVoiceLanguagePreference({ scope, playerInstanceId, language }); }
  setVoiceDefaultDelivery({ scope, playerInstanceId, delivery }) { return this.#settings.setVoiceDefaultDelivery({ scope, playerInstanceId, delivery }); }
  setVoiceRuntimeBaseUrl({ scope, playerInstanceId, baseUrl }) { return this.#settings.setVoiceRuntimeBaseUrl({ scope, playerInstanceId, baseUrl }); }
  getSettings({ scope, playerInstanceId }) { return this.#settings.get({ scope, playerInstanceId }); }
  setCallAudioKept({ scope, callSessionId, kept }) { return this.#voiceAudio.setCallKept({ scope, callSessionId, kept }); }
  deleteTemporaryCallAudio({ scope }) { return this.#voiceAudio.deleteTemporary({ scope }); }
  async testVoiceRuntime({ scope, playerInstanceId }) { const settings = await this.#settings.get({ scope, playerInstanceId }); if (!this.#voiceAdapter?.health) return Object.freeze({ ok: false, ready: false, endpoint: settings.voiceRuntimeBaseUrl, reason: 'voice-adapter-unavailable' }); return this.#voiceAdapter.health({ baseUrl: settings.voiceRuntimeBaseUrl }); }
  activateDetectedVoice({ scope, playerInstanceId, language = 'en' }) { return this.#settings.activateDetectedVoice({ scope, playerInstanceId, language }); }
  setTheme({ scope, playerInstanceId, themeId }) { return this.#settings.setTheme({ scope, playerInstanceId, themeId }); }
  get socialEnabled() { return Boolean(this.#social); }
  get liveEnabled() { return Boolean(this.#live); }
  get notificationsEnabled() { return Boolean(this.#notifications); }
  get phoneWorldUtilitiesEnabled() { return Boolean(this.#phoneWorldUtilities); }
  get calendarEnabled() { return Boolean(this.#calendar); }
  createCalendarReminder(input) { if (!this.#calendar) throw new Error('Calendar service is unavailable'); return this.#calendar.createReminder(input); }
  createCalendarInvitation(input) { if (!this.#calendar) throw new Error('Calendar service is unavailable'); return this.#calendar.createInvitation(input); }
  acceptCalendarInvitation(input) { if (!this.#calendar) throw new Error('Calendar service is unavailable'); return this.#calendar.acceptInvitation(input); }
  declineCalendarInvitation(input) { if (!this.#calendar) throw new Error('Calendar service is unavailable'); return this.#calendar.declineInvitation(input); }
  get commerceEnabled() { return Boolean(this.#commerce); }
  checkoutShopItem(input) { if (!this.#commerce) throw new Error('Shop service is unavailable'); return this.#commerce.checkout(input); }
  removeGalleryAsset(input) { if (!this.#phoneWorldUtilities) throw new Error('Gallery service is unavailable'); return this.#phoneWorldUtilities.removeGalleryAsset(input); }
  removeFile(input) { if (!this.#phoneWorldUtilities) throw new Error('Files service is unavailable'); return this.#phoneWorldUtilities.removeFile(input); }
  saveNote(input) { if (!this.#phoneWorldUtilities) throw new Error('Notes service is unavailable'); return this.#phoneWorldUtilities.saveNote(input); }
  deleteNote(input) { if (!this.#phoneWorldUtilities) throw new Error('Notes service is unavailable'); return this.#phoneWorldUtilities.deleteNote(input); }
  recordSearch(input) { if (!this.#phoneWorldUtilities) throw new Error('Search service is unavailable'); return this.#phoneWorldUtilities.recordSearch(input); }
  clearSearchEntry(input) { if (!this.#phoneWorldUtilities) throw new Error('Search service is unavailable'); return this.#phoneWorldUtilities.clearSearchEntry(input); }
  setLocation(input) { if (!this.#phoneWorldUtilities) throw new Error('Maps service is unavailable'); return this.#phoneWorldUtilities.setLocation(input); }
  endLocation(input) { if (!this.#phoneWorldUtilities) throw new Error('Maps service is unavailable'); return this.#phoneWorldUtilities.endLocation(input); }
  async deviceRoster(scopeInput, { playerActorId = null, playerDisplayName = null, activeCharacterDisplayName = null } = {}) {
    const scope = requireEventScope(scopeInput);
    return this.#unitOfWork.readonly({ stores: ['phoneStates', 'instances', 'actors', 'accounts', 'socialPersonas', 'stories', 'characterCardActors'], scope }, async repositories => {
      const states = await repositories.phoneStates.list(); const roster = [];
      const story = await repositories.stories.get(scope.storyId); const memberships = story ? await repositories.characterCardActors.listByIndex('by_card_status', [story.characterCardId, 'active']) : []; const activeActorIds = new Set(memberships.map(row => row.actorId));
      const nonPlayerCount = states.length - 1;
      for (const state of states) {
        const instance = await repositories.instances.get(state.deviceOwnerInstanceId); const actor = instance && await repositories.actors.get(instance.actorId); if (!instance || !actor) continue;
        const playerOwned = isPlayerControlled(actor); if (!playerOwned && !activeActorIds.has(actor.id)) continue;
        const liveCharacterName = !playerOwned && nonPlayerCount === 1 ? activeCharacterDisplayName : null;
        const label = presentationDisplayName(instance.displayNameOverride, playerOwned && actor.id === playerActorId ? playerDisplayName : null, liveCharacterName, actor.displayName, ...(actor.aliases || []), playerOwned ? 'เจ้าของเครื่อง' : 'ไม่ทราบชื่อ');
        const accounts = await repositories.accounts.listByIndex('by_owner_scope', [scope.storyId, scope.branchId, instance.id]);
        const account = accounts.find(row => row.isPrimary && row.deviceIds?.includes(state.deviceId)) || accounts.find(row => row.deviceIds?.includes(state.deviceId)) || accounts[0] || null;
        const persona = account ? await repositories.socialPersonas.getByIndex('by_scope_account', [scope.storyId, scope.branchId, account.id]) : null;
        roster.push(Object.freeze({ deviceId: state.deviceId, actorId: actor.id, instanceId: instance.id, label: presentationDisplayName(persona?.displayName, label), avatarUrl: persona?.avatarUrl || null, kind: playerOwned ? 'my-phone' : 'their-phone', lockState: state.lockState }));
      }
      return Object.freeze(roster.sort((left, right) => (left.kind === 'my-phone' ? -1 : right.kind === 'my-phone' ? 1 : left.label.localeCompare(right.label) || left.deviceId.localeCompare(right.deviceId))));
    });
  }
  async #instantCommunicationTargets(scope, settings, viewerAccountId, activeCharacterDisplayName = null) {
    if (settings.phoneNumberDiscovery !== PHONE_NUMBER_DISCOVERY.ON || !viewerAccountId) return Object.freeze([]);
    return this.#unitOfWork.readonly({ stores: ['instances', 'actors', 'accounts', 'stories', 'characterCardActors'], scope }, async repositories => {
      const story = await repositories.stories.get(scope.storyId);
      const memberships = story ? await repositories.characterCardActors.listByIndex('by_card_status', [story.characterCardId, 'active']) : [];
      const activeActorIds = new Set(memberships.map(row => row.actorId));
      const instances = await repositories.instances.listByIndex('by_story_branch', [scope.storyId, scope.branchId]);
      const candidates = [];
      for (const instance of instances) {
        const actor = await repositories.actors.get(instance.actorId);
        if (!actor || (!isPlayerControlled(actor) && !activeActorIds.has(actor.id))) continue;
        const accounts = await repositories.accounts.listByIndex('by_owner_scope', [scope.storyId, scope.branchId, instance.id]);
        const phoneAccounts = accounts.filter(account => account.kind === 'phone');
        const preferred = phoneAccounts.length ? phoneAccounts : accounts;
        const account = preferred.find(row => row.isPrimary) || (preferred.length === 1 ? preferred[0] : null);
        if (!account || account.id === viewerAccountId) continue;
        candidates.push({ instance, actor, account });
      }
      const useLiveName = candidates.length === 1 ? activeCharacterDisplayName : null;
      return Object.freeze(candidates.map(({ instance, actor, account }) => Object.freeze({
        accountId: account.id,
        actorId: actor.id,
        instanceId: instance.id,
        label: presentationDisplayName(instance.displayNameOverride, useLiveName, actor.displayName, ...(actor.aliases || []), account.label, 'Contact'),
        aliases: Object.freeze([...new Set([...(actor.aliases || []), ...(instance.aliases || [])])]),
        availability: 'instant',
        numberRequired: false,
        autoAnswerEligible: candidates.length === 1 && Boolean(useLiveName),
      })).sort((left, right) => left.label.localeCompare(right.label) || left.accountId.localeCompare(right.accountId)));
    });
  }
  async previewOverview({ scope: inputScope, deviceId, playerActorId, playerInstanceId, controller }) {
    const scope = requireEventScope(inputScope);
    const settings = await this.#settings.get({ scope, playerInstanceId });
    this.#imageProvider?.configureApiKey?.(settings.imageApiKey);
    const opened = await controller.open({ scope, deviceId, playerActorId, playerInstanceId, settings, appId: 'launcher' });
    const locked = !opened.authorization.granted || !opened.perspective.accountId;
    if (locked) return Object.freeze({ opened, themeId: settings.themeId, status: 'โทรศัพท์ถูกล็อก', badges: Object.freeze({}), unreadTotal: 0, noteText: null, steps: null, lockNotifications: Object.freeze([]) });

    const accountId = opened.perspective.accountId;
    const selectedDeviceId = opened.perspective.deviceId;
    let phoneWorld = Object.freeze({ badges: Object.freeze({}), recent: Object.freeze([]), unreadTotal: 0 });
    let notes = Object.freeze([]);
    let health = Object.freeze([]);
    let threads = Object.freeze([]);
    let callUi = emptyCallUi();
    let calendar = Object.freeze({ items: Object.freeze([]) });

    if (this.#notifications) { try { phoneWorld = await this.#notifications.phoneWorld({ scope, accountId, deviceId: selectedDeviceId, recentLimit: 8 }); } catch {} }
    if (this.#phoneWorldUtilities) {
      try { notes = await this.#phoneWorldUtilities.listNotes({ scope, deviceId: selectedDeviceId, limit: 20 }); } catch {}
      try { health = await this.#phoneWorldUtilities.listHealth({ scope, deviceId: selectedDeviceId, limit: 50 }); } catch {}
    }
    if (this.#messaging) { try { threads = await this.#messaging.listThreads({ scope, viewerAccountId: accountId }); } catch {} }
    if (this.#callCoordinator) {
      try {
        const contacts = await this.#contacts.listContacts({ scope, ownerAccountId: accountId });
        callUi = await this.#callCoordinator.view({ scope, deviceId: selectedDeviceId, playerActorId, playerInstanceId, selectedCallSessionId: null, contacts });
      } catch {}
    }
    if (this.#calendar) { try { calendar = await this.#calendar.list({ scope, deviceId: selectedDeviceId }); } catch {} }

    const notificationLabels = Object.freeze({ messages: 'INSUNGRAM', calls: 'Calls', feed: 'Insungram', live: 'Live' });
    const notificationIcons = Object.freeze({ messages: 'message', calls: 'phone', feed: 'heart', live: 'live' });
    const notificationTargets = Object.freeze({ messages: 'messages', calls: 'calls', feed: 'feed', live: 'live' });
    const lockNotifications = Object.freeze((phoneWorld.recent || []).slice(0, 3).map(item => Object.freeze({
      icon: notificationIcons[item.appId] || 'notifications',
      app: notificationLabels[item.appId] || 'TMRW Phone',
      time: typeof item.storyTimeRef === 'string' ? item.storyTimeRef : 'ล่าสุด',
      title: item.display?.title || 'การแจ้งเตือน',
      body: item.display?.preview || '',
      target: notificationTargets[item.appId] || 'notifications',
    })));
    const note = notes.find(row => row.pinned) || notes[0] || null;
    const step = health.find(row => row.metric === 'steps') || null;
    return Object.freeze({ opened, themeId: settings.themeId, status: Number(phoneWorld.unreadTotal || 0) > 0 ? `${phoneWorld.unreadTotal} การแจ้งเตือน` : 'พร้อมใช้งาน', badges: phoneWorld.badges || Object.freeze({}), unreadTotal: Number(phoneWorld.unreadTotal || 0), noteText: note ? (note.title || note.text || null) : null, steps: step ? Number(step.value) : null, lockNotifications });
  }
  async selected({ scope: inputScope, deviceId, playerActorId, playerInstanceId, playerDisplayName = null, route, controller, selectedThreadId = null, selectedCallSessionId = null, selectedLiveSessionId = null, activeCharacterDisplayName = null }) {
    const scope = requireEventScope(inputScope); const settings = await this.#settings.get({ scope, playerInstanceId }); this.#imageProvider?.configureApiKey?.(settings.imageApiKey); const opened = await controller.open({ scope, deviceId, playerActorId, playerInstanceId, settings, appId: route === 'diagnostics' ? 'diagnostics' : route });
    let guideState = null; let guideError = null;
    if (route === 'guide') { try { guideState = await this.#guide.get({ scope, playerInstanceId }); } catch (error) { guideError = error instanceof Error ? error.message : String(error); } }
    const contacts = (route === 'contacts' || route === 'calls' || route === 'messages' || route === 'maps' || route === 'calendar' || route === 'search') && opened.authorization.granted && opened.perspective.accountId ? await this.#contacts.listContacts({ scope, ownerAccountId: opened.perspective.accountId }) : Object.freeze([]);
    const instantEligible = opened.perspective.accountOwnerInstanceId === playerInstanceId;
    const botSavedName = instantEligible ? null : settings.botSavedNames?.[opened.perspective.accountOwnerInstanceId] || null;
    const communicationTargets = ['contacts', 'calls', 'messages'].includes(route) && opened.authorization.granted && opened.perspective.accountId && instantEligible ? await this.#instantCommunicationTargets(scope, settings, opened.perspective.accountId, activeCharacterDisplayName) : Object.freeze([]);
    const needsSocialThreads = ['messages', 'feed', 'insungram'].includes(route);
    let threads = needsSocialThreads && this.#messaging && opened.authorization.granted && opened.perspective.accountId ? await this.#messaging.listThreads({ scope, viewerAccountId: opened.perspective.accountId }) : Object.freeze([]);
    if (threads.length) {
      threads = await this.#unitOfWork.readonly({ stores: ['stories', 'characterCardActors', 'instances', 'actors'], scope }, async repositories => {
        const story = await repositories.stories.get(scope.storyId);
        const memberships = story ? await repositories.characterCardActors.listByIndex('by_card_status', [story.characterCardId, 'active']) : [];
        const activeActorIds = new Set(memberships.map(row => row.actorId));
        const playerInstance = await repositories.instances.get(playerInstanceId); const playerActor = playerInstance && await repositories.actors.get(playerInstance.actorId); const protectedPlayerNames = [playerDisplayName, playerInstance?.displayNameOverride, playerActor?.displayName, ...(playerActor?.aliases || []), ...(playerInstance?.aliases || [])].filter(Boolean);
        const visibleInstanceIds = new Set([opened.perspective.accountOwnerInstanceId, playerInstanceId]);
        for (const instance of await repositories.instances.listByIndex('by_story_branch', [scope.storyId, scope.branchId])) { const actor=await repositories.actors.get(instance.actorId); const playerAlias=actor?.id!==playerActorId&&identityNameCollides(actor?.displayName,protectedPlayerNames); const safeWorldIdentity=actor?.sourceAuthority==='tmrw-world-social'&&!playerAlias; if (!playerAlias && (activeActorIds.has(instance.actorId)||safeWorldIdentity)) visibleInstanceIds.add(instance.id); }
        return Object.freeze(threads.filter(thread => (thread.participantInstanceIds || []).every(instanceId => visibleInstanceIds.has(instanceId))));
      });
    }
    let accountPresentations = await this.#accountPresentations(scope, threads.flatMap(thread => thread.participantAccountIds || []));
    accountPresentations = Object.freeze(Object.fromEntries(Object.entries(accountPresentations).map(([id, presentation]) => [id, presentation.actorId === playerActorId || presentation.instanceId === playerInstanceId ? Object.freeze({ ...presentation, label: instantEligible ? presentationDisplayName(playerDisplayName, presentation.label) : botSavedName || 'ผู้เล่น' }) : presentation])));
    let threadRows = needsSocialThreads && this.#messaging && opened.authorization.granted && opened.perspective.accountId ? await Promise.all(threads.map(async thread => {
      const matchingContacts = contacts.filter(contact => contact.targetInstanceId && thread.participantInstanceIds.includes(contact.targetInstanceId));
      const matchingInstant = communicationTargets.filter(target => thread.participantInstanceIds.includes(target.instanceId));
      const otherAccountIds = (thread.participantAccountIds || []).filter(accountId => accountId !== opened.perspective.accountId);
      const participantLabels = [...new Set([...matchingContacts.map(contact => contact.savedName || contact.number), ...matchingInstant.map(target => target.label), ...otherAccountIds.map(accountId => accountPresentations[accountId]?.label)].filter(Boolean))];
      const playerCounterpart = !instantEligible && otherAccountIds.some(accountId => accountPresentations[accountId]?.actorId === playerActorId || accountPresentations[accountId]?.instanceId === playerInstanceId);
      const label = thread.kind === 'dm' ? (playerCounterpart ? botSavedName || 'ผู้เล่น' : participantLabels[0] || 'ข้อความส่วนตัว') : (participantLabels.length ? participantLabels.join(', ') : `กลุ่ม ${thread.participantInstanceIds.length} คน`);
      const primaryContact = thread.kind === 'dm' ? matchingContacts[0] || null : null;
      const secondary = primaryContact?.savedName ? primaryContact.number : (thread.kind === 'group' ? `${thread.participantAccountIds.length} คน` : '');
      const recentMessages = await this.#messaging.listMessages({ scope, viewerAccountId: opened.perspective.accountId, threadId: thread.threadId, limit: 8 });
      if (otherAccountIds.some(accountId => accountPresentations[accountId]?.sourceAuthority === 'tmrw-world-social') && isLegacyPhoneFallback(recentMessages)) return null;
      const latest = recentMessages.at(-1) || null;
      return Object.freeze({ threadId: thread.threadId, kind: thread.kind, label, secondary, avatarUrl: accountPresentations[otherAccountIds[0]]?.avatarUrl || null, counterpartAccountId: otherAccountIds[0] || null, counterpartInstanceId: accountPresentations[otherAccountIds[0]]?.instanceId || null, preview: latest?.text || 'ยังไม่มีข้อความ', lastActivitySequence: Number(latest?.sourceEventSequence || thread.sourceEventSequence || 0), participantCount: thread.participantAccountIds.length, participantAccountIds: Object.freeze([...(thread.participantAccountIds || [])]), participantInstanceIds: Object.freeze([...(thread.participantInstanceIds || [])]) });
    })) : [];
    threadRows = threadRows.filter(Boolean);
    threadRows = Object.freeze(threadRows.sort((left, right) => right.lastActivitySequence - left.lastActivitySequence || left.label.localeCompare(right.label) || left.threadId.localeCompare(right.threadId)));
    const activeThreadId = threadRows.some(thread => thread.threadId === selectedThreadId) ? selectedThreadId : (threadRows[0]?.threadId || null);
    const messages = route === 'messages' && this.#messaging && activeThreadId && opened.authorization.granted && opened.perspective.accountId ? await this.#messaging.listMessages({ scope, viewerAccountId: opened.perspective.accountId, threadId: activeThreadId }) : Object.freeze([]);
    let callUi = route === 'calls' && this.#callCoordinator && opened.authorization.granted && opened.perspective.accountId ? await this.#callCoordinator.view({ scope, deviceId: opened.perspective.deviceId, playerActorId, playerInstanceId, selectedCallSessionId, contacts, directTargets: communicationTargets }) : emptyCallUi();
    const calls = callUi.sessions;
    const activeCallSessionId = callUi.selectedCallSessionId;
    const transcripts = callUi.transcript;
    const selectedCall = selectedCallSessionId ? calls.find(row => row.callSessionId === selectedCallSessionId) || null : null;
    const selectedHistoryItem = selectedCall ? callUi.history.find(row => row.callSessionId === selectedCall.callSessionId) || null : null;
    let selectedCallAudio = Object.freeze([]);
    let selectedCallAudioStorage = null;
    if (selectedCall && ['ended', 'declined', 'cancelled', 'missed'].includes(selectedCall.state)) { try { [selectedCallAudio, selectedCallAudioStorage] = await Promise.all([this.#voiceAudio.listByCall({ scope, callSessionId: selectedCall.callSessionId }), this.#voiceAudio.storageSummary({ scope })]); } catch {} }
    const callbackTarget = selectedHistoryItem ? callUi.dialTargets.find(row => row.accountId === selectedHistoryItem.counterpartAccountId) || null : null;
    const callDetails = callDetailsViewModel({ session: selectedCall, historyItem: selectedHistoryItem, transcript: transcripts, audioArtifacts: selectedCallAudio, audioStorage: selectedCallAudioStorage, viewerAccountId: opened.perspective.accountId, callbackTarget });
    callUi = Object.freeze({ ...callUi, details: callDetails });
    let feed = Object.freeze({ items: Object.freeze([]), nextCursor: null }); let feedAccountLabels = Object.freeze({}); let insungramThreads = Object.freeze([]); let socialProfile = null; let socialError = null;
    if (['feed', 'insungram', 'messages'].includes(route) && opened.authorization.granted && opened.perspective.accountId) {
      if (!this.#social) socialError = 'Feed service is unavailable.';
      else { try {
        feed = await this.#social.listFeed({ scope, viewerAccountId: opened.perspective.accountId, limit: 20 });
        const enrichedItems = await Promise.all((feed.items || []).filter(post => !isLegacyFeedFallback(post)).map(async post => {
          const [comments, likes] = await Promise.all([this.#social.listComments({ scope, viewerAccountId: opened.perspective.accountId, postId: post.postId, limit: 30 }), this.#social.listEngagements({ scope, targetId: post.postId, limit: 100 })]);
          const roots=comments.items||[];const children=await Promise.all(roots.map(comment=>this.#social.listComments({scope,viewerAccountId:opened.perspective.accountId,postId:post.postId,parentCommentId:comment.commentId,limit:30})));const discussion=roots.flatMap((comment,index)=>[comment,...(children[index]?.items||[])]).slice(0,60);
          return Object.freeze({ ...post, commentPreview: Object.freeze(discussion), commentCount: discussion.length, likeCount: likes.filter(row => row.activeState === 'active').length, likedByViewer: likes.some(row => row.actorAccountId === opened.perspective.accountId && row.kind === 'like' && row.activeState === 'active') });
        }));
        feed = Object.freeze({ ...feed, items: Object.freeze(enrichedItems) });
        const authorAccountIds = [...new Set((feed.items || []).flatMap(row => [row.authorAccountId, ...(row.commentPreview || []).map(comment => comment.authorAccountId)]).filter(Boolean))];
        const feedPresentations = await this.#accountPresentations(scope, authorAccountIds); accountPresentations = Object.freeze({ ...accountPresentations, ...feedPresentations });
        feedAccountLabels = Object.freeze(Object.fromEntries(authorAccountIds.map(accountId => [accountId, feedPresentations[accountId]?.label]).filter(([, label]) => label)));
      } catch (error) { socialError = error instanceof Error ? error.message : String(error); } }
    }
    if (['feed', 'insungram', 'messages'].includes(route) && opened.authorization.granted && opened.perspective.accountId) {
      if (!this.#insungram) { if (route === 'insungram') socialError = 'Insungram service is unavailable.'; }
      else { try {
        socialProfile = await this.#insungram.profile({ scope, accountId: opened.perspective.accountId });
        if (route === 'insungram') insungramThreads = await this.#insungram.conversations({ scope, viewerAccountId: opened.perspective.accountId, limit: 20 });
      } catch (error) { socialError = error instanceof Error ? error.message : String(error); } }
    }
    let liveSessions = Object.freeze({ items: Object.freeze([]), nextCursor: null }); let selectedLive = null; let liveViewers = Object.freeze({ items: Object.freeze([]), count: 0 }); let liveMessages = Object.freeze({ items: Object.freeze([]), nextCursor: null }); let liveAccountLabels = Object.freeze({}); let liveError = null;
    if (route === 'live' && opened.authorization.granted && opened.perspective.accountId) {
      if (!this.#live) liveError = 'Live service is unavailable.';
      else {
        try {
          liveSessions = await this.#live.listSessions({ scope, viewerAccountId: opened.perspective.accountId, limit: 20 }); selectedLive = liveSessions.items.find(row => row.sessionId === selectedLiveSessionId) || liveSessions.items.find(row => row.status === 'active') || liveSessions.items[0] || null;
          if (selectedLive) {
            [liveViewers, liveMessages] = await Promise.all([this.#live.listViewers({ scope, sessionId: selectedLive.sessionId, limit: 20 }), this.#live.listMessages({ scope, viewerAccountId: opened.perspective.accountId, sessionId: selectedLive.sessionId, limit: 30 })]);
            const accountIds = [...new Set([...(liveSessions.items || []).map(row => row.hostAccountId), ...(liveViewers.items || []).map(row => row.viewerAccountId), ...(liveMessages.items || []).map(row => row.authorAccountId)].filter(Boolean))];
            const livePresentations = await this.#accountPresentations(scope, accountIds); accountPresentations = Object.freeze({ ...accountPresentations, ...livePresentations });
            liveAccountLabels = Object.freeze(Object.fromEntries(accountIds.map(accountId => [accountId, livePresentations[accountId]?.label]).filter(([, label]) => label)));
          }
        } catch (error) { liveError = error instanceof Error ? error.message : String(error); }
      }
    }
    let galleryItems = Object.freeze([]); let fileItems = Object.freeze([]); let utilityError = null;
    if (['gallery', 'files'].includes(route) && opened.authorization.granted) {
      if (!this.#phoneWorldUtilities) utilityError = 'แอปนี้ยังไม่พร้อมใช้งาน';
      else {
        try {
          if (route === 'gallery') galleryItems = await this.#phoneWorldUtilities.listGallery({ scope, deviceId: opened.perspective.deviceId, limit: 100 });
          if (route === 'files') fileItems = await this.#phoneWorldUtilities.listFiles({ scope, deviceId: opened.perspective.deviceId, limit: 100 });
        } catch (error) { utilityError = error instanceof Error ? error.message : String(error); }
      }
    }
    let locationItems = Object.freeze([]); let locationAudienceChoices = Object.freeze([]);
    if (route === 'maps' && opened.authorization.granted && opened.perspective.accountId) {
      if (!this.#phoneWorldUtilities) utilityError = 'Maps service is unavailable.';
      else {
        try {
          locationItems = await this.#phoneWorldUtilities.listVisibleLocations({ scope, viewerAccountId: opened.perspective.accountId, limit: 100 });
          locationAudienceChoices = await this.#unitOfWork.readonly({ stores: ['accounts'], scope }, async repositories => {
            const rows = [];
            for (const contact of contacts) {
              if (!contact.targetInstanceId) continue;
              const accounts = await repositories.accounts.listByIndex('by_owner_scope', [scope.storyId, scope.branchId, contact.targetInstanceId]);
              const account = accounts.find(row => row.isPrimary) || accounts[0] || null;
              if (account && account.id !== opened.perspective.accountId) rows.push(Object.freeze({ accountId: account.id, label: contact.savedName || contact.number, targetInstanceId: contact.targetInstanceId }));
            }
            return Object.freeze(rows.sort((a, b) => a.label.localeCompare(b.label) || a.accountId.localeCompare(b.accountId)));
          });
        } catch (error) { utilityError = error instanceof Error ? error.message : String(error); }
      }
    }
    let calendarView = Object.freeze({ clock: null, items: Object.freeze([]) }); let calendarError = null; let calendarRecipients = Object.freeze([]);
    if (route === 'calendar' && opened.authorization.granted && opened.perspective.accountId) {
      if (!this.#calendar) calendarError = 'Calendar service is unavailable.';
      else {
        try {
          calendarView = await this.#calendar.list({ scope, deviceId: opened.perspective.deviceId });
          calendarRecipients = Object.freeze(contacts.filter(row => row.targetInstanceId && row.targetInstanceId !== opened.perspective.accountOwnerInstanceId).map(row => Object.freeze({ instanceId: row.targetInstanceId, actorId: row.targetActorId, label: row.savedName || row.number })).sort((a, b) => a.label.localeCompare(b.label) || a.instanceId.localeCompare(b.instanceId)));
        } catch (error) { calendarError = error instanceof Error ? error.message : String(error); }
      }
    }
    let walletView = Object.freeze({ entries: Object.freeze([]), knownBalances: Object.freeze({}) }); let shopView = Object.freeze({ items: Object.freeze([]), orders: Object.freeze([]) }); let commerceError = null;
    if (['wallet', 'shop'].includes(route) && opened.authorization.granted && opened.perspective.accountId) {
      if (!this.#commerce) commerceError = 'Commerce service is unavailable.';
      else {
        try {
          if (route === 'wallet') walletView = await this.#commerce.walletState({ scope, deviceId: opened.perspective.deviceId, accountId: opened.perspective.accountId });
          else [shopView, walletView] = await Promise.all([this.#commerce.shopState({ scope, deviceId: opened.perspective.deviceId, accountId: opened.perspective.accountId }), this.#commerce.walletState({ scope, deviceId: opened.perspective.deviceId, accountId: opened.perspective.accountId })]);
        } catch (error) { commerceError = error instanceof Error ? error.message : String(error); }
      }
    }
    let weatherItems = Object.freeze([]); let healthItems = Object.freeze([]);
    if (['weather', 'health'].includes(route) && opened.authorization.granted) {
      if (!this.#phoneWorldUtilities) utilityError = 'Observation service is unavailable.';
      else {
        try {
          if (route === 'weather') weatherItems = await this.#phoneWorldUtilities.listWeather({ scope, deviceId: opened.perspective.deviceId, limit: 50 });
          else healthItems = await this.#phoneWorldUtilities.listHealth({ scope, deviceId: opened.perspective.deviceId, limit: 100 });
        } catch (error) { utilityError = error instanceof Error ? error.message : String(error); }
      }
    }
    let noteItems = Object.freeze([]); let searchHistory = Object.freeze([]); let searchSources = Object.freeze([]);
    if (['notes', 'search'].includes(route) && opened.authorization.granted && opened.perspective.accountId) {
      if (!this.#phoneWorldUtilities) utilityError = route === 'notes' ? 'Notes service is unavailable.' : 'Search service is unavailable.';
      else {
        try {
          if (route === 'notes') noteItems = await this.#phoneWorldUtilities.listNotes({ scope, deviceId: opened.perspective.deviceId, limit: 200 });
          else {
            const [notes, files, gallery, calendar, shopItems, history] = await Promise.all([
              this.#phoneWorldUtilities.listNotes({ scope, deviceId: opened.perspective.deviceId, limit: 200 }),
              this.#phoneWorldUtilities.listFiles({ scope, deviceId: opened.perspective.deviceId, limit: 200 }),
              this.#phoneWorldUtilities.listGallery({ scope, deviceId: opened.perspective.deviceId, limit: 200 }),
              this.#phoneWorldUtilities.listCalendar({ scope, deviceId: opened.perspective.deviceId, limit: 200 }),
              this.#phoneWorldUtilities.listShopItems({ scope, deviceId: opened.perspective.deviceId, limit: 200 }),
              this.#phoneWorldUtilities.listSearch({ scope, deviceId: opened.perspective.deviceId, limit: 100 }),
            ]);
            searchHistory = history;
            searchSources = Object.freeze([
              ...notes.map(row => Object.freeze({ kind: 'Note', recordId: row.recordId, title: row.title, text: row.text || '' })),
              ...files.map(row => Object.freeze({ kind: 'File', recordId: row.recordId, title: row.name, text: row.fileKind === 'text' ? (row.contentText || '') : (row.assetRef || '') })),
              ...gallery.map(row => Object.freeze({ kind: 'Gallery', recordId: row.recordId, title: row.label || 'Saved asset', text: [row.assetRef, row.provenance?.locationLabel, row.provenance?.source].filter(Boolean).join(' ') })),
              ...calendar.map(row => Object.freeze({ kind: 'Calendar', recordId: row.recordId, title: row.title, text: row.itemKind || '' })),
              ...shopItems.filter(row => row.active !== false).map(row => Object.freeze({ kind: 'Shop', recordId: row.recordId, title: row.name, text: row.description || '' })),
              ...contacts.map(row => Object.freeze({ kind: 'Contact', recordId: row.id || row.contactId || row.number, title: row.savedName || row.number, text: row.number || '' })),
            ]);
          }
        } catch (error) { utilityError = error instanceof Error ? error.message : String(error); }
      }
    }
    const phoneWorld = this.#notifications && opened.authorization.granted && opened.perspective.accountId ? await this.#notifications.phoneWorld({ scope, accountId: opened.perspective.accountId, deviceId: opened.perspective.deviceId, recentLimit: route === 'notifications' ? 100 : 5 }) : Object.freeze({ badges: Object.freeze({}), recent: Object.freeze([]), unreadTotal: 0, activeLiveAlerts: 0 });
    if (route === 'notifications') {
      const socialSources = [...new Set(phoneWorld.recent.filter(item => ['feed', 'live'].includes(item.appId)).map(item => item.sourceAccountId).filter(Boolean))];
      accountPresentations = Object.freeze({ ...accountPresentations, ...await this.#accountPresentations(scope, socialSources) });
    }
    accountPresentations = Object.freeze(Object.fromEntries(Object.entries(accountPresentations).map(([id, presentation]) => [id, presentation.actorId === playerActorId || presentation.instanceId === playerInstanceId ? Object.freeze({ ...presentation, label: instantEligible ? presentationDisplayName(playerDisplayName, presentation.label) : botSavedName || 'ผู้เล่น' }) : presentation])));
    return Object.freeze({ settings, botSavedName, guideState, guideError, opened, contacts, communicationTargets, instantEligible, threads, threadRows, messages, activeThreadId, calls, transcripts, activeCallSessionId, callUi, feed, feedAccountLabels, accountPresentations, insungramThreads, socialProfile, socialError, liveSessions, selectedLive, liveViewers, liveMessages, liveAccountLabels, liveError, galleryItems, fileItems, locationItems, locationAudienceChoices, calendarView, calendarRecipients, calendarError, walletView, shopView, commerceError, weatherItems, healthItems, noteItems, searchHistory, searchSources, utilityError, phoneWorld, messagingEnabled: Boolean(this.#messaging), callsEnabled: Boolean(this.#callCoordinator), socialEnabled: Boolean(this.#social), liveEnabled: Boolean(this.#live), notificationsEnabled: Boolean(this.#notifications), phoneWorldUtilitiesEnabled: Boolean(this.#phoneWorldUtilities), calendarEnabled: Boolean(this.#calendar), commerceEnabled: Boolean(this.#commerce), renderMetrics: Object.freeze({ canonicalEventHistoryScans: callUi.metrics.eventHistoryScans || 0, selectedPhoneReads: 1, contactsLoaded: contacts.length, threadsLoaded: threads.length, messagesLoaded: messages.length, callsLoaded: calls.length, transcriptsLoaded: transcripts.length, callTimers: callUi.metrics.timers || 0, callPollers: callUi.metrics.pollers || 0, feedPostsLoaded: feed.items.length, insungramThreadsLoaded: insungramThreads.length, liveSessionsLoaded: liveSessions.items.length, liveViewersLoaded: liveViewers.items.length, liveMessagesLoaded: liveMessages.items.length, galleryItemsLoaded: galleryItems.length, filesLoaded: fileItems.length, locationsLoaded: locationItems.length, calendarItemsLoaded: calendarView.items.length, walletEntriesLoaded: walletView.entries.length, shopItemsLoaded: shopView.items.length, shopOrdersLoaded: shopView.orders.length, weatherItemsLoaded: weatherItems.length, healthItemsLoaded: healthItems.length, notesLoaded: noteItems.length, searchHistoryLoaded: searchHistory.length, searchSourcesLoaded: searchSources.length, notificationsLoaded: phoneWorld.recent.length, notificationFullScans: 0 }) });
  }
}
