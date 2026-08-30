import { PhoneRouter } from './router.mjs';
import { deviceSwitcherViewModel } from './device-switcher.mjs';
import { contactsViewModel } from './contacts-minimal.mjs';
import { homeViewModel } from './home.mjs';
import { developerDiagnostics } from './dev-diagnostics.mjs';
import { blockedAccessTip } from './contextual-tips.mjs';
import { KeyedRegion } from './keyed-renderer.mjs';
import { feedViewModel } from './feed.mjs';
import { liveViewModel } from './live.mjs';
import { notificationCenterViewModel } from './notifications.mjs';
import { renderApprovedCallSurface } from './calls/approved-call-surface.mjs';
import { renderVoiceSetup } from './voice-setup.mjs';

const element = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };

export class TmrwPhoneShell {
  #document; #models; #controller; #messaging; #calls; #callCoordinator; #callStoryIntegration; #storyContinuation; #social; #notifications; #scope; #player; #selectedDeviceId; #selectedThreadId = null; #selectedCallSessionId = null; #closedCallSurfaceId = null; #selectedVoiceActorId = null; #messageSequence = 0; #callSequence = 0; #socialSequence = 0; #lastCallError = null; #router; #root; #deviceRegion; #navRegion; #content; #metrics = { shellMounts: 0, appRegionUpdates: 0, wholeShellReplacements: 0, layoutReads: 0, eventHistoryScans: 0 };
  constructor({ document, viewModels, controller, messageService = null, callService = null, callCoordinator = null, callStoryIntegration = null, storyContinuation = null, socialService = null, notificationService = null, scope, playerActorId, playerInstanceId, selectedDeviceId }) {
    if (!document || !viewModels || !controller) throw new TypeError('TmrwPhoneShell requires a DOM document and Phase 7 services');
    this.#document = document; this.#models = viewModels; this.#controller = controller; this.#messaging = messageService; this.#calls = callService; this.#callCoordinator = callCoordinator || viewModels.callCoordinator || null; this.#callStoryIntegration = callStoryIntegration; this.#storyContinuation = storyContinuation; this.#social = socialService; this.#notifications = notificationService; this.#scope = scope; this.#player = { actorId: playerActorId, instanceId: playerInstanceId }; this.#selectedDeviceId = selectedDeviceId; this.#router = new PhoneRouter({ onChange: () => { void this.renderActive(); } });
  }
  get metrics() { return Object.freeze({ ...this.#metrics, router: this.#router.route }); }
  get root() { return this.#root; }
  async mount(target) {
    if (this.#root) return this.#root;
    const root = element(this.#document, 'section'); root.className = 'tmrw-v3-shell'; root.setAttribute('aria-label', 'TMRW Phone v3 beta');
    const header = element(this.#document, 'header'); const title = element(this.#document, 'h1', 'TMRW Phone'); title.className = 'tmrw-v3-title'; header.append(title);
    const switcher = element(this.#document, 'nav'); switcher.className = 'tmrw-v3-device-switcher'; switcher.setAttribute('aria-label', 'Phone perspectives');
    const navigation = element(this.#document, 'nav'); navigation.className = 'tmrw-v3-nav'; navigation.setAttribute('aria-label', 'Phone apps');
    const content = element(this.#document, 'main'); content.className = 'tmrw-v3-content'; content.setAttribute('aria-live', 'polite');
    root.append(header, switcher, navigation, content); target.append(root); this.#root = root; this.#deviceRegion = new KeyedRegion(switcher); this.#navRegion = new KeyedRegion(navigation); this.#content = content; this.#metrics.shellMounts += 1;
    await this.render(); return root;
  }
  async render() {
    const roster = await this.#models.deviceRoster(this.#scope); const devices = deviceSwitcherViewModel(roster, this.#selectedDeviceId);
    this.#deviceRegion.patch(devices, { key: row => row.deviceId, create: row => { const button = element(this.#document, 'button', row.label); button.type = 'button'; button.dataset.deviceId = row.deviceId; button.addEventListener('click', () => { void this.selectDevice(row.deviceId); }); return button; }, update: (button, row) => { button.textContent = row.label; button.setAttribute('aria-pressed', String(row.selected)); button.dataset.kind = row.kind; } });
    const view = await this.#models.selected({ scope: this.#scope, deviceId: this.#selectedDeviceId, playerActorId: this.#player.actorId, playerInstanceId: this.#player.instanceId, route: this.#router.route, controller: this.#controller, selectedThreadId: this.#selectedThreadId, selectedCallSessionId: this.#selectedCallSessionId });
    this.#selectedThreadId = view.activeThreadId || this.#selectedThreadId;
    this.#selectedCallSessionId = view.activeCallSessionId || this.#selectedCallSessionId;
    this.#metrics.eventHistoryScans += view.renderMetrics.canonicalEventHistoryScans;
    const apps = homeViewModel({ developerMode: view.settings.developerDiagnosticsEnabled, messagingEnabled: view.messagingEnabled, callsEnabled: view.callsEnabled, socialEnabled: view.socialEnabled, liveEnabled: view.liveEnabled, notificationsEnabled: view.notificationsEnabled, badges: view.phoneWorld.badges }); this.#navRegion.patch(apps, { key: app => app.id, create: app => { const button = element(this.#document, 'button', app.label); button.type = 'button'; button.dataset.route = app.id; button.addEventListener('click', () => this.#router.navigate(app.id)); return button; }, update: (button, app) => { button.textContent = app.badge > 0 ? `${app.label} (${app.badge})` : app.label; button.dataset.badge = String(app.badge); button.disabled = !app.available; button.setAttribute('aria-current', String(this.#router.route === app.id)); } });
    await this.#renderContent(view); return view;
  }
  async selectDevice(deviceId) { if (deviceId === this.#selectedDeviceId) return; this.#controller.close({ scope: this.#scope, deviceId: this.#selectedDeviceId }); this.#selectedDeviceId = deviceId; await this.render(); }
  async renderActive() { if (this.#root) await this.render(); }
  async #renderContent(view) {
    const route = this.#router.route; const panel = element(this.#document, 'section'); panel.className = 'tmrw-v3-panel'; panel.dataset.route = route;
    if (route === 'contacts') { panel.append(element(this.#document, 'h2', 'Contacts')); const list = element(this.#document, 'ul'); for (const contact of contactsViewModel(view.contacts)) { const item = element(this.#document, 'li'); item.append(element(this.#document, 'strong', contact.primary), element(this.#document, 'span', contact.secondary)); list.append(item); } if (!view.opened.authorization.granted) panel.append(element(this.#document, 'p', 'Contacts are unavailable until access is granted.')); else panel.append(list); }
    else if (route === 'messages') {
      panel.append(element(this.#document, 'h2', 'Messages'));
      if (!view.opened.authorization.granted) panel.append(element(this.#document, 'p', 'Messages are unavailable until access is granted.'));
      else if (view.threads.length === 0) panel.append(element(this.#document, 'p', 'No conversations on this phone yet.'));
      else {
        const threads = element(this.#document, 'ul');
        for (const thread of view.threads) { const item = element(this.#document, 'li'); const button = element(this.#document, 'button', thread.kind === 'dm' ? 'Private conversation' : 'Group conversation'); button.type = 'button'; button.dataset.threadId = thread.threadId; button.setAttribute('aria-current', String(thread.threadId === view.activeThreadId)); button.addEventListener('click', () => { this.#selectedThreadId = thread.threadId; void this.renderActive(); }); item.append(button); threads.append(item); }
        panel.append(threads);
        const messages = element(this.#document, 'ol');
        for (const message of view.messages) { const item = element(this.#document, 'li'); item.dataset.messageId = message.messageId; item.append(element(this.#document, 'p', message.text)); messages.append(item); }
        panel.append(messages);
        const input = element(this.#document, 'textarea'); input.setAttribute('aria-label', 'Message text'); const send = element(this.#document, 'button', 'Send'); send.type = 'button'; send.addEventListener('click', () => { void this.#sendMessage(view, input); }); panel.append(input, send);
      }
    }
    else if (route === 'calls') {
      panel.append(element(this.#document, 'h2', 'Calls'));
      if (!view.opened.authorization.granted) panel.append(element(this.#document, 'p', 'Calls are unavailable until access is granted.'));
      else {
        const callUi = view.callUi;
        if (this.#lastCallError) { const error = element(this.#document, 'p', this.#lastCallError); error.className = 'tmrw-v3-call-error'; error.setAttribute('role', 'alert'); panel.append(error); }
        if (callUi.dialTargets.length > 0) {
          const dial = element(this.#document, 'section'); dial.className = 'tmrw-v3-call-dial'; dial.append(element(this.#document, 'h3', 'New call'));
          const targets = element(this.#document, 'div'); targets.className = 'tmrw-v3-call-targets';
          for (const target of callUi.dialTargets) {
            const button = element(this.#document, 'button', 'Call ' + target.label); button.type = 'button'; button.dataset.callTargetAccountId = target.accountId; button.disabled = !callUi.owner.canAct; button.setAttribute('aria-label', 'Call ' + target.label);
            let busy = false; button.addEventListener('click', () => { if (busy || !callUi.owner.canAct) return; busy = true; button.disabled = true; this.#closedCallSurfaceId = null; void this.#startOutgoing(view, target).finally(() => { busy = false; }); }); targets.append(button);
          }
          dial.append(targets); panel.append(dial);
        }
        const historyHeading = element(this.#document, 'h3', 'Call history'); historyHeading.className = 'tmrw-v3-call-history-heading'; panel.append(historyHeading);
        if (callUi.history.length === 0) panel.append(element(this.#document, 'p', 'No canonical calls on this phone yet.'));
        else {
          const list = element(this.#document, 'ul'); list.className = 'tmrw-v3-call-history';
          for (const row of callUi.history) {
            const item = element(this.#document, 'li'); const prefix = row.direction === 'outgoing' ? '↗ ' : '↙ '; const button = element(this.#document, 'button', prefix + row.displayLabel + ' · ' + row.statusLabel); button.type = 'button'; button.dataset.callSessionId = row.callSessionId; button.setAttribute('aria-current', String(row.callSessionId === callUi.selectedCallSessionId)); button.setAttribute('aria-label', (row.direction === 'outgoing' ? 'Outgoing call to ' : 'Incoming call from ') + row.displayLabel + ', ' + row.statusLabel); button.addEventListener('click', () => { this.#selectedCallSessionId = row.callSessionId; this.#closedCallSurfaceId = null; void this.renderActive(); }); item.append(button); list.append(item);
          }
          panel.append(list);
        }
        const island = callUi.island;
        if (island.kind !== 'empty' && island.callSessionId !== this.#closedCallSurfaceId) {
          const call = view.calls.find(row => row.callSessionId === island.callSessionId);
          const surface = renderApprovedCallSurface({
            document: this.#document,
            island,
            inspectionOnly: callUi.owner.inspectionOnly,
            onAction: action => { if (!call) return; void this.#transitionCall(view, call, action); },
            onSend: input => { if (!call) return; void this.#sendCallText(view, call, input); },
            onClose: () => { this.#closedCallSurfaceId = island.callSessionId; void this.renderActive(); },
            onContinueOnce: island.kind === 'ended' && this.#callStoryIntegration && this.#storyContinuation ? () => { void this.#continueAfterEnded(island.callSessionId); } : null,
          });
          panel.append(surface);
        }
      }
    }
    else if (route === 'feed') { panel.append(element(this.#document, 'h2', 'Feed')); const posts = element(this.#document, 'ol'); for (const post of feedViewModel(view.feed)) { const item = element(this.#document, 'li'); item.dataset.postId = post.postId; item.append(element(this.#document, 'p', post.text), element(this.#document, 'small', post.audience)); posts.append(item); } panel.append(posts); if (view.feed.items.length === 0) panel.append(element(this.#document, 'p', 'No canonical posts yet.')); if (this.#social && view.opened.perspective.accountId) { const input = element(this.#document, 'textarea'); input.setAttribute('aria-label', 'Post text'); const send = element(this.#document, 'button', 'Post'); send.type = 'button'; send.addEventListener('click', () => { void this.#createPost(view, input); }); panel.append(input, send); } }
    else if (route === 'insungram') { panel.append(element(this.#document, 'h2', 'Insungram')); if (view.socialProfile) panel.append(element(this.#document, 'p', view.socialProfile.captionStyle || 'Profile')); const list = element(this.#document, 'ul'); for (const thread of view.insungramThreads) { const item = element(this.#document, 'li', thread.kind === 'dm' ? 'Private conversation' : 'Group conversation'); item.dataset.threadId = thread.threadId; list.append(item); } panel.append(list); if (view.insungramThreads.length === 0) panel.append(element(this.#document, 'p', 'No conversations.')); }
    else if (route === 'live') { const live = liveViewModel({ session: view.selectedLive, viewers: view.liveViewers, messages: view.liveMessages }); panel.append(element(this.#document, 'h2', 'Live')); if (live.empty) panel.append(element(this.#document, 'p', 'No canonical Live sessions.')); else { panel.append(element(this.#document, 'h3', live.session.title), element(this.#document, 'p', `${live.session.status} · ${live.viewerCount} viewers`)); const chat = element(this.#document, 'ol'); for (const message of live.messages) { const item = element(this.#document, 'li', message.text); item.dataset.liveMessageId = message.messageId; chat.append(item); } panel.append(chat); if (live.messages.length === 0) panel.append(element(this.#document, 'p', 'No canonical Live comments.')); } }
    else if (route === 'notifications') { panel.append(element(this.#document, 'h2', 'Notifications')); const items = notificationCenterViewModel({ items: view.phoneWorld.recent }); if (!view.opened.authorization.granted) panel.append(element(this.#document, 'p', 'Notifications are unavailable until access is granted.')); else if (items.length === 0) panel.append(element(this.#document, 'p', 'No canonical notifications.')); else { const list = element(this.#document, 'ol'); for (const notification of items) { const item = element(this.#document, 'li'); item.dataset.notificationId = notification.notificationId; const open = element(this.#document, 'button', `${notification.title}${notification.groupCount > 1 ? ` (${notification.groupCount})` : ''}`); open.type = 'button'; open.addEventListener('click', () => { void this.#openNotification(view, notification); }); item.append(open); if (notification.preview) item.append(element(this.#document, 'p', notification.preview)); const dismiss = element(this.#document, 'button', 'Dismiss'); dismiss.type = 'button'; dismiss.addEventListener('click', () => { void this.#dismissNotification(view, notification.notificationId); }); item.append(dismiss); list.append(item); } panel.append(list); } }
    else if (route === 'guide') { panel.append(element(this.#document, 'h2', 'Guide'), element(this.#document, 'p', 'My Phone and Their Phones are separate perspectives. Player-only access does not become story knowledge.')); }
    else if (route === 'settings') {
      panel.append(element(this.#document, 'h2', 'Beta settings'), element(this.#document, 'p', `Experience: ${view.settings.preset}. Number discovery: ${view.settings.phoneNumberDiscovery}.`));
      const calls = element(this.#document, 'section'); calls.className = 'tmrw-v3-settings-calls'; calls.append(element(this.#document, 'h3', 'Calls'));
      const toggle = element(this.#document, 'button', `Continue story after calls: ${view.settings.continueStoryAfterCalls ? 'On' : 'Off'}`); toggle.type = 'button'; toggle.dataset.setting = 'continue-story-after-calls'; toggle.setAttribute('aria-pressed', String(Boolean(view.settings.continueStoryAfterCalls))); toggle.addEventListener('click', () => { void this.#setContinueStoryAfterCalls(!view.settings.continueStoryAfterCalls); });
      calls.append(toggle, element(this.#document, 'p', 'When enabled, Call canon commits first, then TMRW may request one additional text generation using Generate after a USER turn or Continue after a BOT turn. Turning this off never discards Call canon.'));
      panel.append(calls);

      const voiceRoster = (await this.#models.deviceRoster(this.#scope)).filter(row => row.kind === 'their-phone');
      if (!voiceRoster.some(row => row.actorId === this.#selectedVoiceActorId)) this.#selectedVoiceActorId = voiceRoster[0]?.actorId || null;
      const selectedIdentity = voiceRoster.find(row => row.actorId === this.#selectedVoiceActorId) || null;
      let baseProfile = null; let instanceOverride = null; let resolvedProfile = null;
      if (selectedIdentity) {
        baseProfile = await this.#models.voiceProfiles.getActorBase({ actorId: selectedIdentity.actorId });
        instanceOverride = await this.#models.voiceProfiles.getInstanceOverride({ scope: this.#scope, instanceId: selectedIdentity.instanceId });
        resolvedProfile = await this.#models.voiceProfiles.resolve({ scope: this.#scope, actorId: selectedIdentity.actorId, instanceId: selectedIdentity.instanceId });
      }
      panel.append(renderVoiceSetup({
        document: this.#document,
        settings: view.settings,
        capability: this.#models.voiceCapability,
        roster: voiceRoster,
        selectedActorId: this.#selectedVoiceActorId,
        selectedIdentity,
        baseProfile,
        instanceOverride,
        resolvedProfile,
        onToggleVoiceCalls: enabled => { void this.#setVoiceCalls(enabled); },
        onToggleBotVoice: enabled => { void this.#setBotCallsWithVoice(enabled); },
        onSetDefaultLanguage: language => { void this.#setVoiceLanguagePreference(language); },
        onSetDefaultDelivery: delivery => { void this.#setVoiceDefaultDelivery(delivery); },
        onSelectActor: identity => { this.#selectedVoiceActorId = identity.actorId; void this.renderActive(); },
        onSaveBaseName: profileName => { if (selectedIdentity) void this.#setActorBaseVoice(selectedIdentity, { profileName }); },
        onSetBaseLanguage: language => { if (selectedIdentity) void this.#setActorBaseVoice(selectedIdentity, { language }); },
        onToggleBaseLock: lockedByUser => { if (selectedIdentity) void this.#setActorBaseVoice(selectedIdentity, { lockedByUser }); },
        onToggleOverride: enabled => { if (selectedIdentity) void this.#setInstanceVoiceOverride(selectedIdentity, { enabled }); },
        onSaveOverrideName: profileName => { if (selectedIdentity) void this.#setInstanceVoiceOverride(selectedIdentity, { profileName }); },
        onSetOverrideLanguage: language => { if (selectedIdentity) void this.#setInstanceVoiceOverride(selectedIdentity, { language }); },
      }));
    }
    else if (route === 'diagnostics') { const diagnostic = developerDiagnostics({ enabled: view.settings.developerDiagnosticsEnabled, scope: this.#scope, perspective: view.opened.perspective, lifecycle: view.opened.lifecycle, renderMetrics: view.renderMetrics }); panel.append(element(this.#document, 'h2', 'Diagnostics'), element(this.#document, 'pre', diagnostic ? JSON.stringify(diagnostic, null, 2) : 'Developer diagnostics are disabled.')); }
    else { panel.append(element(this.#document, 'h2', view.opened.perspective.kind === 'my-phone' ? 'My Phone' : 'Their Phone'), element(this.#document, 'p', `Device status: ${view.opened.perspective.lockState}.`), element(this.#document, 'p', `${view.phoneWorld.unreadTotal} unread notifications.`)); }
    const tip = blockedAccessTip(view.opened.authorization); if (tip) panel.append(element(this.#document, 'aside', `${tip.title}: ${tip.text}`)); this.#content.replaceChildren(panel); this.#metrics.appRegionUpdates += 1;
  }
  async #sendMessage(view, input) {
    const text = String(input.value || '').trim(); if (!text || !this.#messaging || !view.activeThreadId || !view.opened.perspective.accountId) return;
    const perspective = view.opened.perspective; const actualAuthorActorId = perspective.actualAuthorActorId || perspective.accountOwnerActorId; const actualAuthorInstanceId = perspective.actualAuthorInstanceId || perspective.accountOwnerInstanceId;
    await this.#messaging.sendMessage({ scope: this.#scope, threadId: view.activeThreadId, senderAccountId: perspective.accountId, actualAuthorActorId, actualAuthorInstanceId, deviceId: perspective.deviceId, text, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: `compose:${perspective.deviceId}:${++this.#messageSequence}`, version: '1' }, producer: 'phase8-shell', idempotencyKey: `compose:${perspective.deviceId}:${this.#messageSequence}` });
    await this.renderActive();
  }
  async #createPost(view, input) { const text = String(input.value || '').trim(); if (!text || !this.#social) return; const perspective = view.opened.perspective; await this.#social.createPost({ scope: this.#scope, authorAccountId: perspective.accountId, actualAuthorActorId: perspective.actualAuthorActorId || perspective.accountOwnerActorId, actualAuthorInstanceId: perspective.actualAuthorInstanceId || perspective.accountOwnerInstanceId, deviceId: perspective.deviceId, text, audience: { kind: 'public' }, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: `social-post:${perspective.deviceId}:${++this.#socialSequence}`, version: '1' }, producer: 'phase15-shell', idempotencyKey: `social-post:${perspective.deviceId}:${this.#socialSequence}` }); await this.renderActive(); }
  async #startOutgoing(view, target) {
    if (!this.#callCoordinator || !target) return; const perspective = view.opened.perspective; const sequence = ++this.#callSequence;
    try { this.#lastCallError = null; const result = await this.#callCoordinator.startOutgoing({ scope: this.#scope, deviceId: perspective.deviceId, playerActorId: this.#player.actorId, playerInstanceId: this.#player.instanceId, targetAccountId: target.accountId, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: 'phase18-call-start:' + perspective.deviceId + ':' + sequence, version: '1' }, idempotencyKey: 'phase18-call-start:' + perspective.deviceId + ':' + sequence }); this.#selectedCallSessionId = result.session.callSessionId; }
    catch (error) { this.#lastCallError = error instanceof Error ? error.message : String(error); }
    await this.renderActive();
  }
  async #transitionCall(view, call, action) {
    if (!call) return; const perspective = view.opened.perspective; const sequence = ++this.#callSequence;
    try {
      this.#lastCallError = null;
      if (action === 'end' && this.#callStoryIntegration) {
        await this.#callStoryIntegration.endCall({
          scope: this.#scope,
          deviceId: perspective.deviceId,
          playerActorId: this.#player.actorId,
          playerInstanceId: this.#player.instanceId,
          callSessionId: call.callSessionId,
          measuredDurationMs: 0,
          consequences: [],
          latestVisibleRole: this.#storyContinuation?.latestVisibleRole?.() || null,
          continuationDriver: this.#storyContinuation,
          source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: 'phase18-closure-call-end:' + perspective.deviceId + ':' + sequence, version: '1' },
          idempotencyKey: 'phase18-closure-call-end:' + perspective.deviceId + ':' + sequence,
        });
      } else if (this.#callCoordinator) await this.#callCoordinator.transition({ scope: this.#scope, deviceId: perspective.deviceId, playerActorId: this.#player.actorId, playerInstanceId: this.#player.instanceId, callSessionId: call.callSessionId, action, measuredDurationMs: action === 'end' ? 0 : null, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: 'phase18-call-transition:' + perspective.deviceId + ':' + sequence, version: '1' }, idempotencyKey: 'phase18-call-transition:' + perspective.deviceId + ':' + sequence });
      else if (this.#calls && perspective.accountId) await this.#calls.transition({ scope: this.#scope, callSessionId: call.callSessionId, action, actualActorId: perspective.actualAuthorActorId || perspective.accountOwnerActorId, actualInstanceId: perspective.actualAuthorInstanceId || perspective.accountOwnerInstanceId, deviceId: perspective.deviceId, measuredDurationMs: action === 'end' ? 0 : null, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: 'call-transition:' + perspective.deviceId + ':' + sequence, version: '1' }, producer: 'phase9-shell', idempotencyKey: 'call-transition:' + perspective.deviceId + ':' + sequence });
    } catch (error) { this.#lastCallError = error instanceof Error ? error.message : String(error); }
    await this.renderActive();
  }
  async #sendCallText(view, call, input) {
    const text = String(input.value || '').trim(); if (!text || !call) return; const perspective = view.opened.perspective; const sequence = ++this.#callSequence;
    try {
      this.#lastCallError = null;
      if (this.#callCoordinator) await this.#callCoordinator.sendText({ scope: this.#scope, deviceId: perspective.deviceId, playerActorId: this.#player.actorId, playerInstanceId: this.#player.instanceId, callSessionId: call.callSessionId, text, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: 'phase18-call-text:' + perspective.deviceId + ':' + sequence, version: '1' }, idempotencyKey: 'phase18-call-text:' + perspective.deviceId + ':' + sequence });
      else if (this.#calls && perspective.accountId) await this.#calls.addTranscript({ scope: this.#scope, callSessionId: call.callSessionId, speakerAccountId: perspective.accountId, actualAuthorActorId: perspective.actualAuthorActorId || perspective.accountOwnerActorId, actualAuthorInstanceId: perspective.actualAuthorInstanceId || perspective.accountOwnerInstanceId, deviceId: perspective.deviceId, text, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: 'call-text:' + perspective.deviceId + ':' + sequence, version: '1' }, producer: 'phase9-shell', idempotencyKey: 'call-text:' + perspective.deviceId + ':' + sequence });
    } catch (error) { this.#lastCallError = error instanceof Error ? error.message : String(error); }
    await this.renderActive();
  }
  async #setContinueStoryAfterCalls(enabled) {
    await this.#models.setContinueStoryAfterCalls({ scope: this.#scope, playerInstanceId: this.#player.instanceId, enabled });
    await this.renderActive();
  }
  async #setVoiceCalls(enabled) {
    await this.#models.setVoiceCalls({ scope: this.#scope, playerInstanceId: this.#player.instanceId, enabled });
    await this.renderActive();
  }
  async #setBotCallsWithVoice(enabled) {
    await this.#models.setBotCallsWithVoice({ scope: this.#scope, playerInstanceId: this.#player.instanceId, enabled });
    await this.renderActive();
  }
  async #setVoiceLanguagePreference(language) {
    await this.#models.setVoiceLanguagePreference({ scope: this.#scope, playerInstanceId: this.#player.instanceId, language });
    await this.renderActive();
  }
  async #setVoiceDefaultDelivery(delivery) {
    await this.#models.setVoiceDefaultDelivery({ scope: this.#scope, playerInstanceId: this.#player.instanceId, delivery });
    await this.renderActive();
  }
  async #setActorBaseVoice(identity, patch) {
    const current = await this.#models.voiceProfiles.getActorBase({ actorId: identity.actorId });
    await this.#models.voiceProfiles.setActorBase({ actorId: identity.actorId, profile: { ...(current || {}), ...patch }, userInitiated: true, provenance: { authority: 'tmrw-v3-ui', recordId: `voice-base:${identity.actorId}`, version: '1' } });
    await this.renderActive();
  }
  async #setInstanceVoiceOverride(identity, patch) {
    const current = await this.#models.voiceProfiles.getInstanceOverride({ scope: this.#scope, instanceId: identity.instanceId });
    const fields = { ...(current?.fields || {}) };
    if (Object.prototype.hasOwnProperty.call(patch, 'profileName')) fields.profileName = patch.profileName;
    if (Object.prototype.hasOwnProperty.call(patch, 'language')) fields.language = patch.language;
    await this.#models.voiceProfiles.setInstanceOverride({ scope: this.#scope, instanceId: identity.instanceId, actorId: identity.actorId, enabled: Object.prototype.hasOwnProperty.call(patch, 'enabled') ? patch.enabled : Boolean(current?.enabled), fields, lockedByUser: Boolean(current?.lockedByUser), userInitiated: true, provenance: { authority: 'tmrw-v3-ui', recordId: `voice-override:${identity.instanceId}`, version: '1' } });
    await this.renderActive();
  }
  async #continueAfterEnded(callSessionId) {
    if (!this.#callStoryIntegration || !this.#storyContinuation) return;
    try {
      this.#lastCallError = null;
      const result = this.#callStoryIntegration.continueAfterEnded({ scope: this.#scope, callSessionId, latestVisibleRole: this.#storyContinuation.latestVisibleRole?.() || null, continuationDriver: this.#storyContinuation });
      if (result.promise) void result.promise.catch(error => { this.#lastCallError = error instanceof Error ? error.message : String(error); void this.renderActive(); });
    } catch (error) { this.#lastCallError = error instanceof Error ? error.message : String(error); }
  }
  async #openNotification(view, notification) { if (!this.#notifications || !view.opened.perspective.accountId) return; const perspective = view.opened.perspective; await this.#notifications.markRead({ scope: this.#scope, notificationId: notification.notificationId, accountId: perspective.accountId, deviceId: perspective.deviceId }); const resolved = await this.#notifications.resolveSource({ scope: this.#scope, notificationId: notification.notificationId, accountId: perspective.accountId, deviceId: perspective.deviceId }); if (resolved.available) { if (resolved.source.kind === 'thread') this.#selectedThreadId = resolved.source.id; if (resolved.source.kind === 'call') this.#selectedCallSessionId = resolved.source.id; this.#router.navigate(resolved.route); } else await this.renderActive(); }
  async #dismissNotification(view, notificationId) { if (!this.#notifications || !view.opened.perspective.accountId) return; const perspective = view.opened.perspective; await this.#notifications.dismiss({ scope: this.#scope, notificationId, accountId: perspective.accountId, deviceId: perspective.deviceId }); await this.renderActive(); }
  dispose() { if (!this.#root) return; this.#controller.close({ scope: this.#scope, deviceId: this.#selectedDeviceId }); this.#root.remove(); this.#root = null; }
}
