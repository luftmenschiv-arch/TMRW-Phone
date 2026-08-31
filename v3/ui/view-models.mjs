import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { isPlayerControlled } from '../domain/identity/control-authority.mjs';
import { CallCoordinator } from '../application/call-coordinator.mjs';
import { VoiceProfileService } from '../application/voice-profile-service.mjs';
import { VoiceAudioHistoryService } from '../application/voice-audio-history-service.mjs';
import { createPhase19VoiceCapabilityState } from '../domain/voice/voice-capability.mjs';
import { GuideStateService } from './guide.mjs';

const emptyCallUi = () => Object.freeze({ sessions: Object.freeze([]), history: Object.freeze([]), transcript: Object.freeze([]), selectedCallSessionId: null, island: Object.freeze({ kind: 'empty', title: 'No calls yet', callSessionId: null, actions: Object.freeze([]) }), dialTargets: Object.freeze([]), owner: Object.freeze({ available: false, canAct: false, inspectionOnly: true, reason: 'unavailable' }), metrics: Object.freeze({ eventHistoryScans: 0, callsLoaded: 0, transcriptLoaded: 0, timers: 0, pollers: 0 }) });

export class PhoneShellViewModels {
  #unitOfWork; #phones; #contacts; #settings; #guide; #messaging; #calls; #callCoordinator; #social; #insungram; #live; #notifications; #phoneWorldUtilities; #calendar; #commerce; #voiceProfiles; #voiceAudio; #voiceCapability;
  constructor({ database, phoneStateService, contactService, settingsService, guideService = null, messageService = null, callService = null, callCoordinator = null, socialService = null, insungramService = null, liveService = null, notificationService = null, phoneWorldService = null, calendarService = null, commerceService = null, voiceProfileService = null, voiceAudioHistoryService = null, voiceCapability = null }) {
    this.#unitOfWork = new V3UnitOfWork(database); this.#phones = phoneStateService; this.#contacts = contactService; this.#settings = settingsService; this.#guide = guideService || new GuideStateService({ database }); this.#messaging = messageService; this.#calls = callService; this.#callCoordinator = callCoordinator || (callService ? new CallCoordinator({ database, callService, phoneStateService }) : null); this.#social = socialService; this.#insungram = insungramService; this.#live = liveService; this.#notifications = notificationService; this.#phoneWorldUtilities = phoneWorldService; this.#calendar = calendarService; this.#commerce = commerceService; this.#voiceProfiles = voiceProfileService || new VoiceProfileService({ database }); this.#voiceAudio = voiceAudioHistoryService || new VoiceAudioHistoryService({ database }); this.#voiceCapability = voiceCapability || createPhase19VoiceCapabilityState();
  }
  get messagingEnabled() { return Boolean(this.#messaging); }
  get callsEnabled() { return Boolean(this.#callCoordinator); }
  get callCoordinator() { return this.#callCoordinator; }
  get voiceProfiles() { return this.#voiceProfiles; }
  get voiceAudioHistory() { return this.#voiceAudio; }
  get voiceCapability() { return this.#voiceCapability; }
  setPreset({ scope, playerInstanceId, preset }) { return this.#settings.setPreset({ scope, playerInstanceId, preset }); }
  setPhoneNumberDiscovery({ scope, playerInstanceId, value }) { return this.#settings.setPhoneNumberDiscovery({ scope, playerInstanceId, value }); }
  setDeveloperDiagnostics({ scope, playerInstanceId, enabled }) { return this.#settings.setDeveloperDiagnostics({ scope, playerInstanceId, enabled }); }
  resetGuideTips({ scope, playerInstanceId }) { return this.#guide.resetTips({ scope, playerInstanceId }); }
  replayGuideTutorial({ scope, playerInstanceId }) { return this.#guide.replayTutorial({ scope, playerInstanceId }); }
  setContinueStoryAfterCalls({ scope, playerInstanceId, enabled }) { return this.#settings.setContinueStoryAfterCalls({ scope, playerInstanceId, enabled }); }
  setVoiceCalls({ scope, playerInstanceId, enabled }) { return this.#settings.setVoiceCalls({ scope, playerInstanceId, enabled }); }
  setBotCallsWithVoice({ scope, playerInstanceId, enabled }) { return this.#settings.setBotCallsWithVoice({ scope, playerInstanceId, enabled }); }
  setVoiceLanguagePreference({ scope, playerInstanceId, language }) { return this.#settings.setVoiceLanguagePreference({ scope, playerInstanceId, language }); }
  setVoiceDefaultDelivery({ scope, playerInstanceId, delivery }) { return this.#settings.setVoiceDefaultDelivery({ scope, playerInstanceId, delivery }); }
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
  async deviceRoster(scopeInput) {
    const scope = requireEventScope(scopeInput);
    return this.#unitOfWork.readonly({ stores: ['phoneStates', 'instances', 'actors'], scope }, async repositories => {
      const states = await repositories.phoneStates.list(); const roster = [];
      for (const state of states) { const instance = await repositories.instances.get(state.deviceOwnerInstanceId); const actor = instance && await repositories.actors.get(instance.actorId); if (!instance || !actor) continue; roster.push(Object.freeze({ deviceId: state.deviceId, actorId: actor.id, instanceId: instance.id, label: actor.displayName, kind: isPlayerControlled(actor) ? 'my-phone' : 'their-phone', lockState: state.lockState })); }
      return Object.freeze(roster.sort((left, right) => (left.kind === 'my-phone' ? -1 : right.kind === 'my-phone' ? 1 : left.label.localeCompare(right.label) || left.deviceId.localeCompare(right.deviceId))));
    });
  }
  async selected({ scope: inputScope, deviceId, playerActorId, playerInstanceId, route, controller, selectedThreadId = null, selectedCallSessionId = null }) {
    const scope = requireEventScope(inputScope); const settings = await this.#settings.get({ scope, playerInstanceId }); const opened = await controller.open({ scope, deviceId, playerActorId, playerInstanceId, settings, appId: route === 'diagnostics' ? 'diagnostics' : route });
    let guideState = null; let guideError = null;
    if (route === 'guide') { try { guideState = await this.#guide.get({ scope, playerInstanceId }); } catch (error) { guideError = error instanceof Error ? error.message : String(error); } }
    const contacts = (route === 'contacts' || route === 'calls' || route === 'maps' || route === 'calendar' || route === 'search') && opened.authorization.granted && opened.perspective.accountId ? await this.#contacts.listContacts({ scope, ownerAccountId: opened.perspective.accountId }) : Object.freeze([]);
    const threads = route === 'messages' && this.#messaging && opened.authorization.granted && opened.perspective.accountId ? await this.#messaging.listThreads({ scope, viewerAccountId: opened.perspective.accountId }) : Object.freeze([]);
    const activeThreadId = threads.some(thread => thread.threadId === selectedThreadId) ? selectedThreadId : (threads[0]?.threadId || null);
    const messages = route === 'messages' && this.#messaging && activeThreadId && opened.authorization.granted && opened.perspective.accountId ? await this.#messaging.listMessages({ scope, viewerAccountId: opened.perspective.accountId, threadId: activeThreadId }) : Object.freeze([]);
    const callUi = route === 'calls' && this.#callCoordinator && opened.authorization.granted && opened.perspective.accountId ? await this.#callCoordinator.view({ scope, deviceId: opened.perspective.deviceId, playerActorId, playerInstanceId, selectedCallSessionId, contacts }) : emptyCallUi();
    const calls = callUi.sessions;
    const activeCallSessionId = callUi.selectedCallSessionId;
    const transcripts = callUi.transcript;
    let feed = Object.freeze({ items: Object.freeze([]), nextCursor: null }); let insungramThreads = Object.freeze([]); let socialProfile = null; let socialError = null;
    if (route === 'feed' && opened.authorization.granted && opened.perspective.accountId) {
      if (!this.#social) socialError = 'Feed service is unavailable.';
      else { try { feed = await this.#social.listFeed({ scope, viewerAccountId: opened.perspective.accountId, limit: 20 }); } catch (error) { socialError = error instanceof Error ? error.message : String(error); } }
    }
    if (route === 'insungram' && opened.authorization.granted && opened.perspective.accountId) {
      if (!this.#insungram) socialError = 'Insungram service is unavailable.';
      else { try { [insungramThreads, socialProfile] = await Promise.all([this.#insungram.conversations({ scope, viewerAccountId: opened.perspective.accountId, limit: 20 }), this.#insungram.profile({ scope, accountId: opened.perspective.accountId })]); } catch (error) { socialError = error instanceof Error ? error.message : String(error); } }
    }
    let liveSessions = Object.freeze({ items: Object.freeze([]), nextCursor: null }); let selectedLive = null; let liveViewers = Object.freeze({ items: Object.freeze([]), count: 0 }); let liveMessages = Object.freeze({ items: Object.freeze([]), nextCursor: null }); let liveError = null;
    if (route === 'live' && opened.authorization.granted && opened.perspective.accountId) {
      if (!this.#live) liveError = 'Live service is unavailable.';
      else {
        try {
          liveSessions = await this.#live.listSessions({ scope, viewerAccountId: opened.perspective.accountId, limit: 20 }); selectedLive = liveSessions.items.find(row => row.status === 'active') || liveSessions.items[0] || null;
          if (selectedLive) [liveViewers, liveMessages] = await Promise.all([this.#live.listViewers({ scope, sessionId: selectedLive.sessionId, limit: 20 }), this.#live.listMessages({ scope, viewerAccountId: opened.perspective.accountId, sessionId: selectedLive.sessionId, limit: 30 })]);
        } catch (error) { liveError = error instanceof Error ? error.message : String(error); }
      }
    }
    let galleryItems = Object.freeze([]); let fileItems = Object.freeze([]); let utilityError = null;
    if (['gallery', 'files'].includes(route) && opened.authorization.granted) {
      if (!this.#phoneWorldUtilities) utilityError = 'Phone-world utility service is unavailable.';
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
    const phoneWorld = this.#notifications && opened.authorization.granted && opened.perspective.accountId ? await this.#notifications.phoneWorld({ scope, accountId: opened.perspective.accountId, deviceId: opened.perspective.deviceId, recentLimit: route === 'notifications' ? 25 : 5 }) : Object.freeze({ badges: Object.freeze({}), recent: Object.freeze([]), unreadTotal: 0, activeLiveAlerts: 0 });
    return Object.freeze({ settings, guideState, guideError, opened, contacts, threads, messages, activeThreadId, calls, transcripts, activeCallSessionId, callUi, feed, insungramThreads, socialProfile, socialError, liveSessions, selectedLive, liveViewers, liveMessages, liveError, galleryItems, fileItems, locationItems, locationAudienceChoices, calendarView, calendarRecipients, calendarError, walletView, shopView, commerceError, weatherItems, healthItems, noteItems, searchHistory, searchSources, utilityError, phoneWorld, messagingEnabled: Boolean(this.#messaging), callsEnabled: Boolean(this.#callCoordinator), socialEnabled: Boolean(this.#social), liveEnabled: Boolean(this.#live), notificationsEnabled: Boolean(this.#notifications), phoneWorldUtilitiesEnabled: Boolean(this.#phoneWorldUtilities), calendarEnabled: Boolean(this.#calendar), commerceEnabled: Boolean(this.#commerce), renderMetrics: Object.freeze({ canonicalEventHistoryScans: callUi.metrics.eventHistoryScans || 0, selectedPhoneReads: 1, contactsLoaded: contacts.length, threadsLoaded: threads.length, messagesLoaded: messages.length, callsLoaded: calls.length, transcriptsLoaded: transcripts.length, callTimers: callUi.metrics.timers || 0, callPollers: callUi.metrics.pollers || 0, feedPostsLoaded: feed.items.length, insungramThreadsLoaded: insungramThreads.length, liveSessionsLoaded: liveSessions.items.length, liveViewersLoaded: liveViewers.items.length, liveMessagesLoaded: liveMessages.items.length, galleryItemsLoaded: galleryItems.length, filesLoaded: fileItems.length, locationsLoaded: locationItems.length, calendarItemsLoaded: calendarView.items.length, walletEntriesLoaded: walletView.entries.length, shopItemsLoaded: shopView.items.length, shopOrdersLoaded: shopView.orders.length, weatherItemsLoaded: weatherItems.length, healthItemsLoaded: healthItems.length, notesLoaded: noteItems.length, searchHistoryLoaded: searchHistory.length, searchSourcesLoaded: searchSources.length, notificationsLoaded: phoneWorld.recent.length, notificationFullScans: 0 }) });
  }
}
