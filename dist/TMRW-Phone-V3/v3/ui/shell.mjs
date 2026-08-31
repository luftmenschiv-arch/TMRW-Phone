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
import { createAppHeader } from './app-header.mjs';
import { createHomeAppIcon } from './app-icons.mjs';
import { renderGallery } from './gallery.mjs';
import { renderFiles } from './files.mjs';
import { renderTheme } from './themes.mjs';
import { renderMaps } from './maps.mjs';
import { renderCalendar } from './calendar.mjs';
import { renderWallet } from './wallet.mjs';
import { renderShop } from './shop.mjs';
import { renderWeather } from './weather.mjs';
import { renderHealth } from './health.mjs';
import { renderNotes } from './notes.mjs';
import { renderSearch } from './search.mjs';
import { GUIDE_TOPICS, GUIDE_TOPIC_CONTENT } from './guide.mjs';
import { EXPERIENCE_PRESET, PHONE_NUMBER_DISCOVERY } from './experience-presets.mjs';

const element = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const APP_TITLES = Object.freeze({ contacts: 'Contacts', messages: 'Messages', calls: 'Calls', feed: 'Feed', insungram: 'Insungram', live: 'Live', notifications: 'Notifications', gallery: 'Gallery', files: 'Files', theme: 'Theme', maps: 'Maps', calendar: 'Calendar', wallet: 'Wallet', shop: 'Shop', weather: 'Weather', health: 'Health', notes: 'Notes', search: 'Search', guide: 'Guide', settings: 'Settings', diagnostics: 'Diagnostics' });

export class TmrwPhoneShell {
  #document; #models; #controller; #messaging; #calls; #callCoordinator; #callStoryIntegration; #storyContinuation; #social; #notifications; #scope; #player; #selectedDeviceId; #selectedThreadId = null; #selectedCallSessionId = null; #selectedGalleryRecordId = null; #selectedFileRecordId = null; #locationDraftLabel = ''; #selectedLocationAudienceIds = new Set(); #calendarFormMode = null; #calendarSequence = 0; #lastCalendarError = null; #selectedWalletRecordId = null; #selectedShopRecordId = null; #checkoutConfirmationRecordId = null; #checkoutResult = null; #shopStaleRecordId = null; #checkoutBusy = false; #commerceSequence = 0; #lastCommerceError = null; #selectedNoteRecordId = null; #noteFormMode = null; #pendingNoteDeleteId = null; #noteSequence = 0; #searchQuery = ''; #submittedSearchQuery = ''; #searchSequence = 0; #searchClearBusy = false; #lastPersonalError = null; #pendingRemoval = null; #closedCallSurfaceId = null; #selectedVoiceActorId = null; #selectedPerspectiveLabel = 'My Phone'; #selectedGuideTopic = GUIDE_TOPICS[0]; #guideBusy = false; #lastGuideError = null; #settingsBusy = false; #lastSettingsError = null; #socialBusy = false; #lastSocialActionError = null; #messageSequence = 0; #callSequence = 0; #socialSequence = 0; #utilitySequence = 0; #lastMessageError = null; #lastCallError = null; #lastNotificationError = null; #lastUtilityError = null; #router; #root; #deviceRegion; #navRegion; #navigation; #content; #perspectiveSummary; #metrics = { shellMounts: 0, appRegionUpdates: 0, wholeShellReplacements: 0, layoutReads: 0, eventHistoryScans: 0 };
  constructor({ document, viewModels, controller, messageService = null, callService = null, callCoordinator = null, callStoryIntegration = null, storyContinuation = null, socialService = null, notificationService = null, scope, playerActorId, playerInstanceId, selectedDeviceId }) {
    if (!document || !viewModels || !controller) throw new TypeError('TmrwPhoneShell requires a DOM document and Phase 7 services');
    this.#document = document; this.#models = viewModels; this.#controller = controller; this.#messaging = messageService; this.#calls = callService; this.#callCoordinator = callCoordinator || viewModels.callCoordinator || null; this.#callStoryIntegration = callStoryIntegration; this.#storyContinuation = storyContinuation; this.#social = socialService; this.#notifications = notificationService; this.#scope = scope; this.#player = { actorId: playerActorId, instanceId: playerInstanceId }; this.#selectedDeviceId = selectedDeviceId; this.#router = new PhoneRouter({ onChange: () => { this.#lastUtilityError = null; this.#lastCalendarError = null; this.#calendarFormMode = null; this.#lastCommerceError = null; this.#selectedWalletRecordId = null; this.#selectedShopRecordId = null; this.#checkoutConfirmationRecordId = null; this.#checkoutResult = null; this.#shopStaleRecordId = null; this.#checkoutBusy = false; this.#selectedNoteRecordId = null; this.#noteFormMode = null; this.#pendingNoteDeleteId = null; this.#searchQuery = ''; this.#submittedSearchQuery = ''; this.#searchClearBusy = false; this.#lastPersonalError = null; this.#lastGuideError = null; this.#lastSettingsError = null; this.#lastSocialActionError = null; this.#pendingRemoval = null; void this.renderActive(); } });
  }
  get metrics() { return Object.freeze({ ...this.#metrics, router: this.#router.route }); }
  get root() { return this.#root; }
  async mount(target) {
    if (this.#root) return this.#root;
    const root = element(this.#document, 'section'); root.className = 'tmrw-v3-shell'; root.setAttribute('aria-label', 'TMRW Phone v3 beta');
    const header = element(this.#document, 'header'); header.className = 'tmrw-v3-shell-header'; const title = element(this.#document, 'h1', 'TMRW—Phone'); title.className = 'tmrw-v3-title'; const perspectiveSummary = element(this.#document, 'p', 'Viewing phone perspective'); perspectiveSummary.className = 'tmrw-v3-perspective-summary'; perspectiveSummary.setAttribute('aria-live', 'polite'); header.append(title, perspectiveSummary);
    const switcher = element(this.#document, 'nav'); switcher.className = 'tmrw-v3-device-switcher'; switcher.setAttribute('aria-label', 'My Phone and Their Phones');
    const navigation = element(this.#document, 'nav'); navigation.className = 'tmrw-v3-nav'; navigation.setAttribute('aria-label', 'Phone apps');
    const content = element(this.#document, 'main'); content.className = 'tmrw-v3-content'; content.setAttribute('aria-live', 'polite');
    root.append(header, switcher, navigation, content); target.append(root); this.#root = root; this.#deviceRegion = new KeyedRegion(switcher); this.#navRegion = new KeyedRegion(navigation); this.#navigation = navigation; this.#content = content; this.#perspectiveSummary = perspectiveSummary; this.#metrics.shellMounts += 1;
    await this.render(); return root;
  }
  async render() {
    const roster = await this.#models.deviceRoster(this.#scope); const myPhone = roster.find(row => row.kind === 'my-phone');
    if (!myPhone) throw new Error('Canonical My Phone device is unavailable for the current Story/Branch');
    if (!roster.some(row => row.deviceId === this.#selectedDeviceId)) this.#selectedDeviceId = myPhone.deviceId;
    const devices = deviceSwitcherViewModel(roster, this.#selectedDeviceId);
    this.#deviceRegion.patch(devices, { key: row => row.deviceId, create: row => { const button = element(this.#document, 'button', row.label); button.type = 'button'; button.dataset.deviceId = row.deviceId; button.addEventListener('click', () => { void this.selectDevice(row.deviceId); }); return button; }, update: (button, row) => { button.textContent = row.label; button.setAttribute('aria-pressed', String(row.selected)); button.setAttribute('aria-label', row.kind === 'my-phone' ? 'My Phone' : `Their Phone: ${row.label}`); button.title = row.kind === 'my-phone' ? 'Your canonical phone perspective' : `Character phone perspective: ${row.label}`; button.dataset.kind = row.kind; } });
    const selectedPerspective = devices.find(row => row.selected) || devices.find(row => row.kind === 'my-phone');
    this.#selectedPerspectiveLabel = selectedPerspective?.label || (selectedPerspective?.kind === 'my-phone' ? 'My Phone' : 'Their Phone');
    if (this.#root) this.#root.dataset.route = this.#router.route;
    if (this.#perspectiveSummary) this.#perspectiveSummary.textContent = selectedPerspective?.kind === 'my-phone' ? 'Viewing: My Phone' : `Viewing: ${selectedPerspective?.label || 'Their Phone'} · Their Phone`;
    const loadingRoutes = ['contacts', 'messages', 'calls', 'notifications', 'gallery', 'files', 'maps', 'calendar', 'wallet', 'shop', 'weather', 'health', 'notes', 'search', 'guide', 'settings', 'diagnostics', 'feed', 'insungram', 'live'];
    if (loadingRoutes.includes(this.#router.route) && this.#content) {
      if (this.#navigation) this.#navigation.hidden = true;
      const loading = element(this.#document, 'section'); loading.className = 'tmrw-v3-panel'; loading.dataset.route = this.#router.route;
      loading.append(createAppHeader({ document: this.#document, title: APP_TITLES[this.#router.route], onBack: () => this.#router.navigate('launcher') }));
      const status = element(this.#document, 'p', `Loading ${APP_TITLES[this.#router.route]}…`); status.setAttribute('role', 'status'); loading.append(status); this.#content.replaceChildren(loading);
    }
    let view;
    try {
      view = await this.#models.selected({ scope: this.#scope, deviceId: this.#selectedDeviceId, playerActorId: this.#player.actorId, playerInstanceId: this.#player.instanceId, route: this.#router.route, controller: this.#controller, selectedThreadId: this.#selectedThreadId, selectedCallSessionId: this.#selectedCallSessionId });
    } catch (error) {
      if (this.#router.route === 'launcher' || !this.#content) throw error;
      const failed = element(this.#document, 'section'); failed.className = 'tmrw-v3-panel'; failed.dataset.route = this.#router.route;
      failed.append(createAppHeader({ document: this.#document, title: APP_TITLES[this.#router.route], onBack: () => this.#router.navigate('launcher') }));
      const alert = element(this.#document, 'p', `${APP_TITLES[this.#router.route]} is unavailable: ${error instanceof Error ? error.message : String(error)}`); alert.setAttribute('role', 'alert');
      const retry = element(this.#document, 'button', 'Retry'); retry.type = 'button'; retry.dataset.action = 'retry-app'; retry.addEventListener('click', () => { retry.disabled = true; void this.renderActive(); });
      failed.append(alert, retry); this.#content.replaceChildren(failed); this.#metrics.appRegionUpdates += 1; return null;
    }
    if (this.#root) this.#root.dataset.theme = view.settings.themeId || 'light-blue';
    this.#selectedThreadId = view.activeThreadId || this.#selectedThreadId;
    this.#selectedCallSessionId = view.activeCallSessionId || this.#selectedCallSessionId;
    this.#metrics.eventHistoryScans += view.renderMetrics.canonicalEventHistoryScans;
    const apps = homeViewModel({ developerMode: view.settings.developerDiagnosticsEnabled, messagingEnabled: view.messagingEnabled, callsEnabled: view.callsEnabled, socialEnabled: view.socialEnabled, liveEnabled: view.liveEnabled, notificationsEnabled: view.notificationsEnabled, phoneWorldEnabled: view.phoneWorldUtilitiesEnabled, calendarEnabled: view.calendarEnabled, commerceEnabled: view.commerceEnabled, badges: view.phoneWorld.badges });
    this.#navRegion.patch(apps, {
      key: app => app.id,
      create: app => {
        const button = element(this.#document, 'button');
        button.type = 'button';
        button.className = 'tmrw-v3-home-app';
        button.dataset.route = app.id;
        const icon = createHomeAppIcon({ document: this.#document, appId: app.id });
        const label = element(this.#document, 'span', app.label); label.className = 'tmrw-v3-home-app-label';
        const badge = element(this.#document, 'span'); badge.className = 'tmrw-v3-home-app-badge'; badge.setAttribute('aria-hidden', 'true');
        button.append(icon, label, badge);
        button.addEventListener('click', () => this.#router.navigate(app.id));
        return button;
      },
      update: (button, app) => {
        const label = button.children?.[1]; const badge = button.children?.[2];
        if (label) label.textContent = app.label;
        if (badge) { badge.textContent = app.badge > 0 ? String(app.badge > 99 ? '99+' : app.badge) : ''; badge.hidden = app.badge <= 0; }
        button.dataset.badge = String(app.badge); button.dataset.disposition = app.disposition; button.disabled = !app.available;
        button.title = app.reason || app.title || app.label; button.setAttribute('aria-label', app.badge > 0 ? `${app.label}, ${app.badge} unread` : app.label);
        if (app.reason) button.setAttribute('aria-description', app.reason); else button.attributes?.delete?.('aria-description');
        button.setAttribute('aria-current', String(this.#router.route === app.id));
      },
    });
    if (this.#navigation) this.#navigation.hidden = this.#router.route !== 'launcher';
    await this.#renderContent(view); return view;
  }
  async selectDevice(deviceId) { if (deviceId === this.#selectedDeviceId) return; this.#controller.close({ scope: this.#scope, deviceId: this.#selectedDeviceId }); this.#selectedDeviceId = deviceId; this.#selectedGalleryRecordId = null; this.#selectedFileRecordId = null; this.#locationDraftLabel = ''; this.#selectedLocationAudienceIds.clear(); this.#calendarFormMode = null; this.#lastCalendarError = null; this.#selectedWalletRecordId = null; this.#selectedShopRecordId = null; this.#checkoutConfirmationRecordId = null; this.#checkoutResult = null; this.#shopStaleRecordId = null; this.#checkoutBusy = false; this.#lastCommerceError = null; this.#selectedNoteRecordId = null; this.#noteFormMode = null; this.#pendingNoteDeleteId = null; this.#searchQuery = ''; this.#submittedSearchQuery = ''; this.#searchClearBusy = false; this.#lastPersonalError = null; this.#lastSocialActionError = null; this.#socialBusy = false; this.#pendingRemoval = null; await this.render(); }
  async renderActive() { if (this.#root) await this.render(); }
  async #renderContent(view) {
    const route = this.#router.route; const panel = element(this.#document, 'section'); panel.className = 'tmrw-v3-panel'; panel.dataset.route = route;
    if (route !== 'launcher') panel.append(createAppHeader({ document: this.#document, title: APP_TITLES[route] || route, onBack: () => this.#router.navigate('launcher') }));
    if (route === 'contacts') { panel.append(element(this.#document, 'h2', 'Contacts')); const list = element(this.#document, 'ul'); for (const contact of contactsViewModel(view.contacts)) { const item = element(this.#document, 'li'); item.append(element(this.#document, 'strong', contact.primary), element(this.#document, 'span', contact.secondary)); list.append(item); } if (!view.opened.authorization.granted) panel.append(element(this.#document, 'p', 'Contacts are unavailable until access is granted.')); else if (view.contacts.length === 0) panel.append(element(this.#document, 'p', 'No contacts saved on this phone yet.')); else panel.append(list); }
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
        if (view.messages.length === 0) panel.append(element(this.#document, 'p', 'No messages in this conversation yet.'));
        if (this.#lastMessageError) { const error = element(this.#document, 'p', this.#lastMessageError); error.className = 'tmrw-v3-message-error'; error.setAttribute('role', 'alert'); panel.append(error); }
        const input = element(this.#document, 'textarea'); input.setAttribute('aria-label', 'Message text'); input.placeholder = 'Write a message…'; const send = element(this.#document, 'button', 'Send'); send.type = 'button'; send.disabled = true; const syncSend = () => { send.disabled = !String(input.value || '').trim(); }; input.addEventListener('input', syncSend); let busy = false; send.addEventListener('click', () => { if (busy || !String(input.value || '').trim()) return; busy = true; send.disabled = true; void this.#sendMessage(view, input).finally(() => { busy = false; }); }); panel.append(input, send);
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
            onAction: action => { if (!call) return null; return this.#transitionCall(view, call, action); },
            onSend: input => { if (!call) return null; return this.#sendCallText(view, call, input); },
            onClose: () => { this.#closedCallSurfaceId = island.callSessionId; return this.renderActive(); },
            onContinueOnce: island.kind === 'ended' && this.#callStoryIntegration && this.#storyContinuation ? () => this.#continueAfterEnded(island.callSessionId) : null,
          });
          panel.append(surface);
        }
      }
    }
    else if (route === 'feed') {
      panel.append(element(this.#document, 'h2', 'Feed'));
      if (!view.opened.authorization.granted) panel.append(element(this.#document, 'p', 'Feed is unavailable until access is granted.'));
      else if (view.socialError) {
        const error = element(this.#document, 'p', `Feed could not be loaded: ${view.socialError}`); error.setAttribute('role', 'alert');
        const retry = element(this.#document, 'button', 'Retry Feed'); retry.type = 'button'; retry.dataset.action = 'retry-feed'; retry.addEventListener('click', () => { retry.disabled = true; void this.renderActive(); }); panel.append(error, retry);
      } else {
        panel.append(element(this.#document, 'p', 'Manual canonical posts only. Autonomous Social generation is disabled.'));
        if (this.#lastSocialActionError) { const error = element(this.#document, 'p', this.#lastSocialActionError); error.setAttribute('role', 'alert'); panel.append(error); }
        const posts = element(this.#document, 'ol'); for (const post of feedViewModel(view.feed)) { const item = element(this.#document, 'li'); item.dataset.postId = post.postId; item.append(element(this.#document, 'p', post.text), element(this.#document, 'small', post.audience)); posts.append(item); }
        if (view.feed.items.length === 0) panel.append(element(this.#document, 'p', 'No canonical posts yet.')); else panel.append(posts);
        if (this.#social && view.opened.perspective.accountId) {
          const input = element(this.#document, 'textarea'); input.setAttribute('aria-label', 'Post text'); input.placeholder = 'Write a canonical post…';
          const send = element(this.#document, 'button', 'Post'); send.type = 'button'; send.disabled = true; send.dataset.action = 'create-feed-post';
          const sync = () => { send.disabled = this.#socialBusy || !String(input.value || '').trim(); }; input.addEventListener('input', sync);
          send.addEventListener('click', () => { if (this.#socialBusy || !String(input.value || '').trim()) return; this.#socialBusy = true; send.disabled = true; void this.#createPost(view, input).finally(() => { this.#socialBusy = false; }); });
          panel.append(input, send);
        }
      }
    }
    else if (route === 'insungram') {
      panel.append(element(this.#document, 'h2', 'Insungram'));
      if (!view.opened.authorization.granted) panel.append(element(this.#document, 'p', 'Insungram is unavailable until access is granted.'));
      else if (view.socialError) {
        const error = element(this.#document, 'p', `Insungram could not be loaded: ${view.socialError}`); error.setAttribute('role', 'alert');
        const retry = element(this.#document, 'button', 'Retry Insungram'); retry.type = 'button'; retry.dataset.action = 'retry-insungram'; retry.addEventListener('click', () => { retry.disabled = true; void this.renderActive(); }); panel.append(error, retry);
      } else {
        panel.append(element(this.#document, 'p', 'Read-only view of existing canonical conversations. Autonomous Social generation is disabled.'));
        if (view.socialProfile) panel.append(element(this.#document, 'p', view.socialProfile.captionStyle || 'Canonical profile'));
        const list = element(this.#document, 'ul'); for (const thread of view.insungramThreads) { const item = element(this.#document, 'li', thread.kind === 'dm' ? 'Private conversation' : 'Group conversation'); item.dataset.threadId = thread.threadId; list.append(item); }
        if (view.insungramThreads.length === 0) panel.append(element(this.#document, 'p', 'No canonical conversations.')); else panel.append(list);
      }
    }
    else if (route === 'live') {
      panel.append(element(this.#document, 'h2', 'Live'));
      if (!view.opened.authorization.granted) panel.append(element(this.#document, 'p', 'Live is unavailable until access is granted.'));
      else if (view.liveError) {
        const error = element(this.#document, 'p', `Live could not be loaded: ${view.liveError}`); error.setAttribute('role', 'alert');
        const retry = element(this.#document, 'button', 'Retry Live'); retry.type = 'button'; retry.dataset.action = 'retry-live'; retry.addEventListener('click', () => { retry.disabled = true; void this.renderActive(); }); panel.append(error, retry);
      } else {
        panel.append(element(this.#document, 'p', 'Read-only canonical Live state. Autonomous Live generation is disabled.'));
        const live = liveViewModel({ session: view.selectedLive, viewers: view.liveViewers, messages: view.liveMessages });
        if (live.empty) panel.append(element(this.#document, 'p', 'No canonical Live sessions.'));
        else { panel.append(element(this.#document, 'h3', live.session.title), element(this.#document, 'p', `${live.session.status} · ${live.viewerCount} viewers`)); const chat = element(this.#document, 'ol'); for (const message of live.messages) { const item = element(this.#document, 'li', message.text); item.dataset.liveMessageId = message.messageId; chat.append(item); } if (live.messages.length === 0) panel.append(element(this.#document, 'p', 'No canonical Live comments.')); else panel.append(chat); }
      }
    }
    else if (route === 'notifications') {
      panel.append(element(this.#document, 'h2', 'Notifications'));
      const items = notificationCenterViewModel({ items: view.phoneWorld.recent });
      if (this.#lastNotificationError) { const error = element(this.#document, 'p', this.#lastNotificationError); error.className = 'tmrw-v3-notification-error'; error.setAttribute('role', 'alert'); panel.append(error); }
      if (!view.opened.authorization.granted) panel.append(element(this.#document, 'p', 'Notifications are unavailable until access is granted.'));
      else if (items.length === 0) panel.append(element(this.#document, 'p', 'No canonical notifications.'));
      else {
        const list = element(this.#document, 'ol');
        for (const notification of items) {
          const item = element(this.#document, 'li'); item.dataset.notificationId = notification.notificationId;
          const open = element(this.#document, 'button', `${notification.title}${notification.groupCount > 1 ? ` (${notification.groupCount})` : ''}`); open.type = 'button'; open.setAttribute('aria-label', `Open ${notification.title}`); let openBusy = false; open.addEventListener('click', () => { if (openBusy || open.disabled) return; openBusy = true; open.disabled = true; void this.#openNotification(view, notification); }); item.append(open);
          if (notification.preview) item.append(element(this.#document, 'p', notification.preview));
          const dismiss = element(this.#document, 'button', 'Dismiss'); dismiss.type = 'button'; dismiss.setAttribute('aria-label', `Dismiss ${notification.title}`); let dismissBusy = false; dismiss.addEventListener('click', () => { if (dismissBusy || dismiss.disabled) return; dismissBusy = true; dismiss.disabled = true; void this.#dismissNotification(view, notification.notificationId); }); item.append(dismiss);
          list.append(item);
        }
        panel.append(list);
      }
    }
    else if (route === 'gallery') {
      panel.append(renderGallery({
        document: this.#document,
        items: view.galleryItems,
        authorizationGranted: view.opened.authorization.granted,
        error: view.utilityError || this.#lastUtilityError,
        selectedRecordId: this.#selectedGalleryRecordId,
        pendingRemovalRecordId: this.#pendingRemoval?.kind === 'gallery' ? this.#pendingRemoval.recordId : null,
        onOpen: recordId => { this.#selectedGalleryRecordId = recordId; this.#pendingRemoval = null; void this.renderActive(); },
        onRequestRemove: recordId => { this.#pendingRemoval = { kind: 'gallery', recordId }; void this.renderActive(); },
        onCancelRemove: () => { this.#pendingRemoval = null; void this.renderActive(); },
        onConfirmRemove: item => this.#removeGalleryItem(view, item),
      }));
    }
    else if (route === 'files') {
      panel.append(renderFiles({
        document: this.#document,
        items: view.fileItems,
        authorizationGranted: view.opened.authorization.granted,
        error: view.utilityError || this.#lastUtilityError,
        selectedRecordId: this.#selectedFileRecordId,
        pendingRemovalRecordId: this.#pendingRemoval?.kind === 'file' ? this.#pendingRemoval.recordId : null,
        onOpen: recordId => { this.#selectedFileRecordId = recordId; this.#pendingRemoval = null; void this.renderActive(); },
        onRequestRemove: recordId => { this.#pendingRemoval = { kind: 'file', recordId }; void this.renderActive(); },
        onCancelRemove: () => { this.#pendingRemoval = null; void this.renderActive(); },
        onConfirmRemove: item => this.#removeFileItem(view, item),
      }));
    }
    else if (route === 'maps') {
      panel.append(renderMaps({
        document: this.#document,
        authorizationGranted: view.opened.authorization.granted,
        error: view.utilityError || this.#lastUtilityError,
        items: view.locationItems,
        audiences: view.locationAudienceChoices,
        selectedAudienceIds: [...this.#selectedLocationAudienceIds],
        draftLabel: this.#locationDraftLabel,
        viewerAccountId: view.opened.perspective.accountId,
        viewerDeviceId: view.opened.perspective.deviceId,
        onDraft: value => { this.#locationDraftLabel = value; void this.renderActive(); },
        onToggleAudience: accountId => { if (this.#selectedLocationAudienceIds.has(accountId)) this.#selectedLocationAudienceIds.delete(accountId); else this.#selectedLocationAudienceIds.add(accountId); void this.renderActive(); },
        onCheckIn: () => this.#createLocation(view, 'check-in'),
        onShare: () => this.#createLocation(view, 'shared'),
        onStartLive: () => this.#createLocation(view, 'live'),
        onEndLive: item => this.#endLiveLocation(view, item),
      }));
    }
    else if (route === 'calendar') {
      panel.append(renderCalendar({
        document: this.#document,
        view: view.calendarView,
        recipients: view.calendarRecipients,
        authorizationGranted: view.opened.authorization.granted,
        error: view.calendarError || this.#lastCalendarError,
        formMode: this.#calendarFormMode,
        onStartForm: mode => { this.#calendarFormMode = mode; this.#lastCalendarError = null; void this.renderActive(); },
        onCancelForm: () => { this.#calendarFormMode = null; this.#lastCalendarError = null; void this.renderActive(); },
        onCreateReminder: input => this.#createCalendarItem(view, 'reminder', input),
        onCreateInvitation: input => this.#createCalendarItem(view, 'invitation', input),
        onAccept: item => this.#respondCalendarInvitation(view, item, 'accept'),
        onDecline: item => this.#respondCalendarInvitation(view, item, 'decline'),
      }));
    }
    else if (route === 'wallet') {
      panel.append(renderWallet({
        document: this.#document,
        view: view.walletView,
        authorizationGranted: view.opened.authorization.granted,
        error: view.commerceError || this.#lastCommerceError,
        selectedRecordId: this.#selectedWalletRecordId,
        onSelect: recordId => { this.#selectedWalletRecordId = recordId; this.#lastCommerceError = null; void this.renderActive(); },
      }));
    }
    else if (route === 'shop') {
      panel.append(renderShop({
        document: this.#document,
        view: view.shopView,
        walletView: view.walletView,
        authorizationGranted: view.opened.authorization.granted,
        error: view.commerceError || this.#lastCommerceError,
        selectedRecordId: this.#selectedShopRecordId,
        confirmationRecordId: this.#checkoutConfirmationRecordId,
        staleRecordId: this.#shopStaleRecordId,
        checkoutResult: this.#checkoutResult,
        checkoutBusy: this.#checkoutBusy,
        onSelect: recordId => { this.#selectedShopRecordId = recordId; this.#checkoutConfirmationRecordId = null; this.#checkoutResult = null; this.#shopStaleRecordId = null; this.#lastCommerceError = null; void this.renderActive(); },
        onRequestCheckout: recordId => { this.#checkoutConfirmationRecordId = recordId; this.#checkoutResult = null; this.#shopStaleRecordId = null; this.#lastCommerceError = null; void this.renderActive(); },
        onCancelCheckout: () => { this.#checkoutConfirmationRecordId = null; this.#lastCommerceError = null; void this.renderActive(); },
        onConfirmCheckout: item => this.#checkoutShopItem(view, item),
        onRefreshItem: recordId => { this.#selectedShopRecordId = recordId; this.#checkoutConfirmationRecordId = null; this.#checkoutResult = null; this.#shopStaleRecordId = null; this.#lastCommerceError = null; void this.renderActive(); },
      }));
    }
    else if (route === 'weather') { panel.append(renderWeather({ document: this.#document, items: view.weatherItems, authorizationGranted: view.opened.authorization.granted, error: view.utilityError || this.#lastUtilityError })); }
    else if (route === 'health') { panel.append(renderHealth({ document: this.#document, items: view.healthItems, authorizationGranted: view.opened.authorization.granted, error: view.utilityError || this.#lastUtilityError })); }
    else if (route === 'notes') {
      panel.append(renderNotes({ document: this.#document, items: view.noteItems, authorizationGranted: view.opened.authorization.granted, error: view.utilityError || this.#lastPersonalError, selectedRecordId: this.#selectedNoteRecordId, formMode: this.#noteFormMode, pendingDeleteRecordId: this.#pendingNoteDeleteId, onOpen: recordId => { this.#selectedNoteRecordId = recordId; this.#noteFormMode = null; this.#pendingNoteDeleteId = null; this.#lastPersonalError = null; void this.renderActive(); }, onStartCreate: () => { this.#selectedNoteRecordId = null; this.#noteFormMode = 'new'; this.#pendingNoteDeleteId = null; this.#lastPersonalError = null; void this.renderActive(); }, onStartEdit: () => { if (this.#selectedNoteRecordId) { this.#noteFormMode = 'edit'; this.#pendingNoteDeleteId = null; this.#lastPersonalError = null; void this.renderActive(); } }, onCancelForm: () => { this.#noteFormMode = null; this.#lastPersonalError = null; void this.renderActive(); }, onSave: input => this.#saveNote(view, input), onRequestDelete: recordId => { this.#pendingNoteDeleteId = recordId; this.#noteFormMode = null; void this.renderActive(); }, onCancelDelete: () => { this.#pendingNoteDeleteId = null; void this.renderActive(); }, onConfirmDelete: item => this.#deleteNote(view, item) }));
    }
    else if (route === 'search') {
      panel.append(renderSearch({ document: this.#document, history: view.searchHistory, sources: view.searchSources, authorizationGranted: view.opened.authorization.granted, error: view.utilityError || this.#lastPersonalError, query: this.#searchQuery, submittedQuery: this.#submittedSearchQuery, clearBusy: this.#searchClearBusy, onQuery: value => { this.#searchQuery = value; }, onSubmit: query => this.#submitSearch(view, query), onClearHistory: () => this.#clearSearchHistory(view) }));
    }
    else if (route === 'theme') { panel.append(renderTheme({ document: this.#document, selectedTheme: view.settings.themeId, onSelect: themeId => this.#setTheme(themeId) })); }
    else if (route === 'guide') {
      panel.append(element(this.#document, 'h2', 'Guide'));
      const guideError = view.guideError || this.#lastGuideError;
      if (guideError) {
        const error = element(this.#document, 'p', `Guide could not be loaded: ${guideError}`); error.setAttribute('role', 'alert');
        const retry = element(this.#document, 'button', 'Retry Guide'); retry.type = 'button'; retry.dataset.action = 'retry-guide'; retry.addEventListener('click', () => { this.#lastGuideError = null; retry.disabled = true; void this.renderActive(); }); panel.append(error, retry);
      } else if (view.guideState) {
        panel.append(element(this.#document, 'p', 'Guide state is player UI state, not story canon. Topics and actions below use the current built-in Guide contract.'));
        const topics = element(this.#document, 'section'); topics.className = 'tmrw-v3-guide-topics'; topics.append(element(this.#document, 'h3', 'Topics'));
        const topicList = element(this.#document, 'div'); topicList.className = 'tmrw-v3-guide-topic-list';
        for (const topic of GUIDE_TOPICS) { const button = element(this.#document, 'button', topic); button.type = 'button'; button.dataset.guideTopic = topic; button.setAttribute('aria-current', String(topic === this.#selectedGuideTopic)); button.addEventListener('click', () => { this.#selectedGuideTopic = topic; void this.renderActive(); }); topicList.append(button); }
        topics.append(topicList); panel.append(topics);
        const selected = GUIDE_TOPICS.includes(this.#selectedGuideTopic) ? this.#selectedGuideTopic : GUIDE_TOPICS[0];
        const article = element(this.#document, 'article'); article.className = 'tmrw-v3-guide-topic'; article.append(element(this.#document, 'h3', selected), element(this.#document, 'p', GUIDE_TOPIC_CONTENT[selected])); panel.append(article);
        panel.append(element(this.#document, 'p', `Tutorial replays: ${Number(view.guideState.tutorialReplayCount || 0)}. Dismissed tips: ${Array.isArray(view.guideState.dismissedTips) ? view.guideState.dismissedTips.length : 0}.`));
        const actions = element(this.#document, 'div'); actions.className = 'tmrw-v3-guide-actions';
        const reset = element(this.#document, 'button', 'Reset tips'); reset.type = 'button'; reset.dataset.action = 'reset-guide-tips'; reset.disabled = this.#guideBusy; reset.addEventListener('click', () => { if (this.#guideBusy) return; reset.disabled = true; void this.#resetGuideTips(); });
        const replay = element(this.#document, 'button', 'Replay tutorial'); replay.type = 'button'; replay.dataset.action = 'replay-guide-tutorial'; replay.disabled = this.#guideBusy; replay.addEventListener('click', () => { if (this.#guideBusy) return; replay.disabled = true; void this.#replayGuideTutorial(); });
        actions.append(reset, replay); panel.append(actions);
      }
    }
    else if (route === 'settings') {
      panel.append(element(this.#document, 'h2', 'Settings'));
      if (this.#lastSettingsError) { const error = element(this.#document, 'p', `Settings update failed: ${this.#lastSettingsError}`); error.setAttribute('role', 'alert'); panel.append(error); }
      const experience = element(this.#document, 'section'); experience.className = 'tmrw-v3-settings-group'; experience.append(element(this.#document, 'h3', 'Experience'));
      const presetControls = element(this.#document, 'div'); presetControls.className = 'tmrw-v3-settings-options';
      for (const preset of [EXPERIENCE_PRESET.SIMPLE, EXPERIENCE_PRESET.STORY, EXPERIENCE_PRESET.IMMERSIVE]) { const button = element(this.#document, 'button', `Experience: ${preset}`); button.type = 'button'; button.dataset.setting = `preset-${preset}`; button.setAttribute('aria-pressed', String(view.settings.preset === preset)); button.disabled = this.#settingsBusy; button.addEventListener('click', () => { if (this.#settingsBusy || view.settings.preset === preset) return; button.disabled = true; void this.#setExperiencePreset(preset); }); presetControls.append(button); }
      experience.append(presetControls, element(this.#document, 'p', `Current phone access mode: ${view.settings.phoneAccessMode}.`));
      const discovery = element(this.#document, 'div'); discovery.className = 'tmrw-v3-settings-options'; discovery.append(element(this.#document, 'h4', 'Phone number discovery'));
      for (const value of [PHONE_NUMBER_DISCOVERY.SMART, PHONE_NUMBER_DISCOVERY.ON, PHONE_NUMBER_DISCOVERY.OFF]) { const button = element(this.#document, 'button', `Number discovery: ${value}`); button.type = 'button'; button.dataset.setting = `number-discovery-${value}`; button.setAttribute('aria-pressed', String(view.settings.phoneNumberDiscovery === value)); button.disabled = this.#settingsBusy; button.addEventListener('click', () => { if (this.#settingsBusy || view.settings.phoneNumberDiscovery === value) return; button.disabled = true; void this.#setPhoneNumberDiscovery(value); }); discovery.append(button); }
      experience.append(discovery); panel.append(experience);

      const diagnostics = element(this.#document, 'section'); diagnostics.className = 'tmrw-v3-settings-group'; diagnostics.append(element(this.#document, 'h3', 'Developer Diagnostics'));
      const diagnosticsToggle = element(this.#document, 'button', `Developer Diagnostics: ${view.settings.developerDiagnosticsEnabled ? 'On' : 'Off'}`); diagnosticsToggle.type = 'button'; diagnosticsToggle.dataset.setting = 'developer-diagnostics'; diagnosticsToggle.setAttribute('aria-pressed', String(Boolean(view.settings.developerDiagnosticsEnabled))); diagnosticsToggle.disabled = this.#settingsBusy; diagnosticsToggle.addEventListener('click', () => { if (this.#settingsBusy) return; diagnosticsToggle.disabled = true; void this.#setDeveloperDiagnostics(!view.settings.developerDiagnosticsEnabled); }); diagnostics.append(diagnosticsToggle, element(this.#document, 'p', 'Diagnostics show bounded runtime and selected-phone health metadata. They do not expose provider credentials or API keys.'));
      if (view.settings.developerDiagnosticsEnabled) { const openDiagnostics = element(this.#document, 'button', 'Open Diagnostics'); openDiagnostics.type = 'button'; openDiagnostics.dataset.action = 'open-diagnostics'; openDiagnostics.addEventListener('click', () => this.#router.navigate('diagnostics')); diagnostics.append(openDiagnostics); }
      panel.append(diagnostics);

      const calls = element(this.#document, 'section'); calls.className = 'tmrw-v3-settings-calls'; calls.append(element(this.#document, 'h3', 'Calls'));
      const toggle = element(this.#document, 'button', `Continue story after calls: ${view.settings.continueStoryAfterCalls ? 'On' : 'Off'}`); toggle.type = 'button'; toggle.dataset.setting = 'continue-story-after-calls'; toggle.setAttribute('aria-pressed', String(Boolean(view.settings.continueStoryAfterCalls))); toggle.disabled = this.#settingsBusy; toggle.addEventListener('click', () => { if (this.#settingsBusy) return; toggle.disabled = true; void this.#setContinueStoryAfterCalls(!view.settings.continueStoryAfterCalls); });
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
    else if (route === 'diagnostics') {
      panel.append(element(this.#document, 'h2', 'Diagnostics'));
      if (!view.settings.developerDiagnosticsEnabled) panel.append(element(this.#document, 'p', 'Developer diagnostics are disabled. Enable them through Settings.'));
      else if (!view.opened.authorization.granted) panel.append(element(this.#document, 'p', 'Diagnostics are unavailable for this phone perspective until access is granted.'));
      else {
        const diagnostic = developerDiagnostics({ enabled: true, scope: this.#scope, perspective: view.opened.perspective, lifecycle: view.opened.lifecycle, renderMetrics: view.renderMetrics });
        panel.append(element(this.#document, 'p', 'Read-only bounded runtime diagnostics. No provider credentials or API keys are included.'));
        const pre = element(this.#document, 'pre', JSON.stringify(diagnostic, null, 2)); pre.className = 'tmrw-v3-diagnostics-output'; panel.append(pre);
      }
    }
    else {
      panel.className = 'tmrw-v3-panel tmrw-v3-home-overview';
      const hero = element(this.#document, 'section'); hero.className = 'tmrw-v3-home-hero';
      const eyebrow = element(this.#document, 'span', view.opened.perspective.kind === 'my-phone' ? 'MY PHONE' : 'THEIR PHONE'); eyebrow.className = 'tmrw-v3-home-eyebrow';
      const title = element(this.#document, 'h2', this.#selectedPerspectiveLabel); title.className = 'tmrw-v3-home-perspective-title';
      const meta = element(this.#document, 'div'); meta.className = 'tmrw-v3-home-meta';
      const lock = element(this.#document, 'span', `Status · ${view.opened.perspective.lockState}`);
      const unread = element(this.#document, 'span', view.phoneWorld.unreadTotal > 0 ? `${view.phoneWorld.unreadTotal} unread` : 'No unread notifications');
      meta.append(lock, unread); hero.append(eyebrow, title, meta); panel.append(hero);
    }
    const tip = blockedAccessTip(view.opened.authorization); if (tip) panel.append(element(this.#document, 'aside', `${tip.title}: ${tip.text}`)); this.#content.replaceChildren(panel); this.#metrics.appRegionUpdates += 1;
  }
  async #sendMessage(view, input) {
    const text = String(input.value || '').trim(); if (!text || !this.#messaging || !view.activeThreadId || !view.opened.perspective.accountId) return false;
    const perspective = view.opened.perspective; const actualAuthorActorId = perspective.actualAuthorActorId || perspective.accountOwnerActorId; const actualAuthorInstanceId = perspective.actualAuthorInstanceId || perspective.accountOwnerInstanceId;
    try {
      this.#lastMessageError = null;
      await this.#messaging.sendMessage({ scope: this.#scope, threadId: view.activeThreadId, senderAccountId: perspective.accountId, actualAuthorActorId, actualAuthorInstanceId, deviceId: perspective.deviceId, text, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: `compose:${perspective.deviceId}:${++this.#messageSequence}`, version: '1' }, producer: 'phase8-shell', idempotencyKey: `compose:${perspective.deviceId}:${this.#messageSequence}` });
      input.value = '';
      await this.renderActive();
      return true;
    } catch (error) {
      this.#lastMessageError = error instanceof Error ? error.message : String(error);
      await this.renderActive();
      return false;
    }
  }
  async #createPost(view, input) {
    const text = String(input.value || '').trim(); const perspective = view?.opened?.perspective;
    if (!text || !this.#social || !perspective?.accountId) { this.#socialBusy = false; return false; }
    const sequence = ++this.#socialSequence;
    try {
      this.#lastSocialActionError = null;
      await this.#social.createPost({ scope: this.#scope, authorAccountId: perspective.accountId, actualAuthorActorId: perspective.actualAuthorActorId || perspective.accountOwnerActorId, actualAuthorInstanceId: perspective.actualAuthorInstanceId || perspective.accountOwnerInstanceId, deviceId: perspective.deviceId, text, audience: { kind: 'public' }, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: `social-post:${perspective.deviceId}:${sequence}`, version: '1' }, producer: 'phase15-shell', idempotencyKey: `social-post:${perspective.deviceId}:${sequence}` });
      input.value = ''; await this.renderActive(); return true;
    } catch (error) {
      this.#lastSocialActionError = error instanceof Error ? error.message : String(error); await this.renderActive(); return false;
    } finally { this.#socialBusy = false; }
  }
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
  async #runGuideMutation(mutation) {
    if (this.#guideBusy) return false; this.#guideBusy = true; this.#lastGuideError = null;
    let success = true;
    try { await mutation(); } catch (error) { success = false; this.#lastGuideError = error instanceof Error ? error.message : String(error); }
    finally { this.#guideBusy = false; await this.renderActive(); }
    return success;
  }
  #resetGuideTips() { return this.#runGuideMutation(() => this.#models.resetGuideTips({ scope: this.#scope, playerInstanceId: this.#player.instanceId })); }
  #replayGuideTutorial() { return this.#runGuideMutation(() => this.#models.replayGuideTutorial({ scope: this.#scope, playerInstanceId: this.#player.instanceId })); }
  async #runSettingsMutation(mutation) {
    if (this.#settingsBusy) return false; this.#settingsBusy = true; this.#lastSettingsError = null;
    let success = true;
    try { await mutation(); } catch (error) { success = false; this.#lastSettingsError = error instanceof Error ? error.message : String(error); }
    finally { this.#settingsBusy = false; await this.renderActive(); }
    return success;
  }
  #setExperiencePreset(preset) { return this.#runSettingsMutation(() => this.#models.setPreset({ scope: this.#scope, playerInstanceId: this.#player.instanceId, preset })); }
  #setPhoneNumberDiscovery(value) { return this.#runSettingsMutation(() => this.#models.setPhoneNumberDiscovery({ scope: this.#scope, playerInstanceId: this.#player.instanceId, value })); }
  #setDeveloperDiagnostics(enabled) { return this.#runSettingsMutation(() => this.#models.setDeveloperDiagnostics({ scope: this.#scope, playerInstanceId: this.#player.instanceId, enabled })); }
  #setContinueStoryAfterCalls(enabled) { return this.#runSettingsMutation(() => this.#models.setContinueStoryAfterCalls({ scope: this.#scope, playerInstanceId: this.#player.instanceId, enabled })); }
  #setVoiceCalls(enabled) { return this.#runSettingsMutation(() => this.#models.setVoiceCalls({ scope: this.#scope, playerInstanceId: this.#player.instanceId, enabled })); }
  #setBotCallsWithVoice(enabled) { return this.#runSettingsMutation(() => this.#models.setBotCallsWithVoice({ scope: this.#scope, playerInstanceId: this.#player.instanceId, enabled })); }
  #setVoiceLanguagePreference(language) { return this.#runSettingsMutation(() => this.#models.setVoiceLanguagePreference({ scope: this.#scope, playerInstanceId: this.#player.instanceId, language })); }
  #setVoiceDefaultDelivery(delivery) { return this.#runSettingsMutation(() => this.#models.setVoiceDefaultDelivery({ scope: this.#scope, playerInstanceId: this.#player.instanceId, delivery })); }
  async #createLocation(view, mode) {
    const perspective = view?.opened?.perspective; const label = String(this.#locationDraftLabel || '').trim(); if (!perspective?.accountId || !label) return false;
    const audienceAccountIds = mode === 'check-in' ? [] : [...this.#selectedLocationAudienceIds]; if (mode !== 'check-in' && audienceAccountIds.length === 0) return false;
    const sequence = ++this.#utilitySequence; const key = `maps-${mode}:${perspective.deviceId}:${sequence}`;
    try {
      this.#lastUtilityError = null;
      await this.#models.setLocation({ scope: this.#scope, deviceId: perspective.deviceId, mode, label, audienceAccountIds, expiresAt: mode === 'live' ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null, sourceKind: 'explicit-user', source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: key, version: '1' }, producer: 'phase23-maps-shell', idempotencyKey: key });
      this.#locationDraftLabel = ''; this.#selectedLocationAudienceIds.clear(); await this.renderActive(); return true;
    } catch (error) { this.#lastUtilityError = error instanceof Error ? error.message : String(error); await this.renderActive(); return false; }
  }
  async #endLiveLocation(view, item) {
    const perspective = view?.opened?.perspective; if (!perspective?.accountId || !item || item.mode !== 'live' || item.status !== 'active') return false;
    if (item.ownerAccountId !== perspective.accountId || item.deviceId !== perspective.deviceId) { this.#lastUtilityError = 'Only the owning phone can end this Live Location.'; await this.renderActive(); return false; }
    const sequence = ++this.#utilitySequence; const key = `maps-end-live:${perspective.deviceId}:${item.recordId}:${sequence}`;
    try { this.#lastUtilityError = null; await this.#models.endLocation({ scope: this.#scope, recordId: item.recordId, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: key, version: '1' }, producer: 'phase23-maps-shell', idempotencyKey: key }); await this.renderActive(); return true; }
    catch (error) { this.#lastUtilityError = error instanceof Error ? error.message : String(error); await this.renderActive(); return false; }
  }
  async #createCalendarItem(view, kind, input) {
    const perspective = view?.opened?.perspective; if (!perspective?.accountId) return false;
    const sequence = ++this.#calendarSequence; const key = `calendar-${kind}:${perspective.deviceId}:${sequence}`;
    const base = { scope: this.#scope, deviceId: perspective.deviceId, ownerActorId: perspective.accountOwnerActorId || perspective.deviceOwnerActorId, ownerInstanceId: perspective.accountOwnerInstanceId || perspective.deviceOwnerInstanceId, ownerAccountId: perspective.accountId, title: input.title, due: input.due, sourceKind: 'explicit-user', source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: key, version: '1' }, producer: 'phase23-calendar-shell', idempotencyKey: key };
    try {
      this.#lastCalendarError = null;
      if (kind === 'invitation') await this.#models.createCalendarInvitation({ ...base, participantInstanceIds: input.participantInstanceIds || [] });
      else await this.#models.createCalendarReminder(base);
      this.#calendarFormMode = null; await this.renderActive(); return true;
    } catch (error) { this.#lastCalendarError = error instanceof Error ? error.message : String(error); await this.renderActive(); return false; }
  }
  async #respondCalendarInvitation(view, item, action) {
    const perspective = view?.opened?.perspective; if (!perspective?.accountId || !item) return false;
    const sequence = ++this.#calendarSequence; const key = `calendar-${action}:${perspective.deviceId}:${item.recordId}:${sequence}`;
    const input = { scope: this.#scope, deviceId: perspective.deviceId, ownerActorId: perspective.accountOwnerActorId || perspective.deviceOwnerActorId, ownerInstanceId: perspective.accountOwnerInstanceId || perspective.deviceOwnerInstanceId, ownerAccountId: perspective.accountId, recordId: item.recordId, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: key, version: '1' }, producer: 'phase23-calendar-shell', idempotencyKey: key };
    try { this.#lastCalendarError = null; if (action === 'accept') await this.#models.acceptCalendarInvitation(input); else await this.#models.declineCalendarInvitation(input); await this.renderActive(); return true; }
    catch (error) { this.#lastCalendarError = error instanceof Error ? error.message : String(error); await this.renderActive(); return false; }
  }
  async #checkoutShopItem(view, item) {
    const perspective = view?.opened?.perspective; if (this.#checkoutBusy || !perspective?.accountId || !item) return false;
    this.#checkoutBusy = true; this.#lastCommerceError = null; this.#shopStaleRecordId = null;
    const sequence = ++this.#commerceSequence; const key = `shop-checkout:${perspective.deviceId}:${item.recordId}:${sequence}`;
    try {
      const result = await this.#models.checkoutShopItem({ scope: this.#scope, deviceId: perspective.deviceId, ownerAccountId: perspective.accountId, shopItemId: item.recordId, quantity: 1, expectedCatalogSequence: item.sourceEventSequence, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: key, version: '1' }, producer: 'phase23-shop-shell', idempotencyKey: key });
      this.#checkoutResult = result; this.#checkoutConfirmationRecordId = null; this.#checkoutBusy = false; await this.renderActive(); return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error); this.#checkoutBusy = false; this.#checkoutResult = null;
      if (/changed after|item changed|catalog.*changed/i.test(message)) { this.#shopStaleRecordId = item.recordId; this.#checkoutConfirmationRecordId = null; this.#lastCommerceError = 'ITEM CHANGED — refresh the canonical item and confirm again.'; }
      else if (/insufficient/i.test(message)) this.#lastCommerceError = 'INSUFFICIENT KNOWN FUNDS — this paid order was not created.';
      else if (/balance is unavailable|cannot fabricate funds/i.test(message)) this.#lastCommerceError = 'UNKNOWN FUNDS — no canonical Wallet balance is available for this currency.';
      else if (/access|authorization|another Device|Account does not match|Unknown scoped/i.test(message)) this.#lastCommerceError = 'Commerce access is unavailable for this phone perspective.';
      else this.#lastCommerceError = 'Shop checkout failed. Refresh the item and try again.';
      await this.renderActive(); return false;
    }
  }
  async #saveNote(view, input) {
    const perspective = view?.opened?.perspective; if (!perspective?.accountId) return false; const current = input.recordId ? view.noteItems.find(row => row.recordId === input.recordId) : null; const sequence = ++this.#noteSequence; const key = `notes-save:${perspective.deviceId}:${sequence}`;
    try { this.#lastPersonalError = null; const result = await this.#models.saveNote({ scope: this.#scope, deviceId: perspective.deviceId, ownerActorId: perspective.accountOwnerActorId || perspective.deviceOwnerActorId, ownerInstanceId: perspective.accountOwnerInstanceId || perspective.deviceOwnerInstanceId, ownerAccountId: perspective.accountId, ...(input.recordId ? { recordId: input.recordId } : {}), title: input.title, text: input.text, pinned: Boolean(current?.pinned), sourceKind: 'explicit-user', source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: key, version: '1' }, producer: 'phase23-notes-shell', idempotencyKey: key }); this.#selectedNoteRecordId = result.event.payload.record.recordId; this.#noteFormMode = null; this.#pendingNoteDeleteId = null; await this.renderActive(); return true; }
    catch (error) { this.#lastPersonalError = error instanceof Error ? error.message : String(error); await this.renderActive(); return false; }
  }
  async #deleteNote(view, item) {
    const perspective = view?.opened?.perspective; if (!perspective?.accountId || !item) return false; const sequence = ++this.#noteSequence; const key = `notes-delete:${perspective.deviceId}:${item.recordId}:${sequence}`;
    try { this.#lastPersonalError = null; await this.#models.deleteNote({ scope: this.#scope, recordId: item.recordId, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: key, version: '1' }, producer: 'phase23-notes-shell', idempotencyKey: key }); this.#selectedNoteRecordId = null; this.#pendingNoteDeleteId = null; this.#noteFormMode = null; await this.renderActive(); return true; }
    catch (error) { this.#lastPersonalError = error instanceof Error ? error.message : String(error); await this.renderActive(); return false; }
  }
  async #submitSearch(view, query) {
    const perspective = view?.opened?.perspective; const normalized = String(query || '').trim(); if (!perspective?.accountId || !normalized) return false; const sequence = ++this.#searchSequence; const key = `search-local:${perspective.deviceId}:${sequence}`;
    try { this.#lastPersonalError = null; await this.#models.recordSearch({ scope: this.#scope, deviceId: perspective.deviceId, ownerActorId: perspective.accountOwnerActorId || perspective.deviceOwnerActorId, ownerInstanceId: perspective.accountOwnerInstanceId || perspective.deviceOwnerInstanceId, ownerAccountId: perspective.accountId, query: normalized, provider: 'local-phone-world', resultRef: null, sourceKind: 'explicit-user', source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: key, version: '1' }, producer: 'phase23-search-shell', idempotencyKey: key }); this.#searchQuery = normalized; this.#submittedSearchQuery = normalized; await this.renderActive(); return true; }
    catch (error) { this.#lastPersonalError = error instanceof Error ? error.message : String(error); await this.renderActive(); return false; }
  }
  async #clearSearchHistory(view) {
    if (this.#searchClearBusy) return false; const perspective = view?.opened?.perspective; if (!perspective?.accountId) return false; this.#searchClearBusy = true; let success = true;
    try { this.#lastPersonalError = null; for (const row of view.searchHistory) { const sequence = ++this.#searchSequence; const key = `search-clear:${perspective.deviceId}:${row.recordId}:${sequence}`; await this.#models.clearSearchEntry({ scope: this.#scope, recordId: row.recordId, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: key, version: '1' }, producer: 'phase23-search-shell', idempotencyKey: key }); } }
    catch (error) { success = false; this.#lastPersonalError = error instanceof Error ? error.message : String(error); }
    finally { this.#searchClearBusy = false; }
    await this.renderActive(); return success;
  }
  async #setTheme(themeId) {
    await this.#models.setTheme({ scope: this.#scope, playerInstanceId: this.#player.instanceId, themeId });
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
  async #openNotification(view, notification) {
    if (!this.#notifications || !view.opened.perspective.accountId) return false;
    const perspective = view.opened.perspective;
    try {
      this.#lastNotificationError = null;
      await this.#notifications.markRead({ scope: this.#scope, notificationId: notification.notificationId, accountId: perspective.accountId, deviceId: perspective.deviceId });
      const resolved = await this.#notifications.resolveSource({ scope: this.#scope, notificationId: notification.notificationId, accountId: perspective.accountId, deviceId: perspective.deviceId });
      if (resolved.available) {
        if (resolved.source.kind === 'thread') this.#selectedThreadId = resolved.source.id;
        if (resolved.source.kind === 'call') this.#selectedCallSessionId = resolved.source.id;
        this.#router.navigate(resolved.route);
      } else await this.renderActive();
      return true;
    } catch (error) {
      this.#lastNotificationError = error instanceof Error ? error.message : String(error);
      await this.renderActive();
      return false;
    }
  }
  async #dismissNotification(view, notificationId) {
    if (!this.#notifications || !view.opened.perspective.accountId) return false;
    const perspective = view.opened.perspective;
    try {
      this.#lastNotificationError = null;
      await this.#notifications.dismiss({ scope: this.#scope, notificationId, accountId: perspective.accountId, deviceId: perspective.deviceId });
      await this.renderActive();
      return true;
    } catch (error) {
      this.#lastNotificationError = error instanceof Error ? error.message : String(error);
      await this.renderActive();
      return false;
    }
  }
  async #removeGalleryItem(view, item) {
    const perspective = view?.opened?.perspective;
    if (!item || !perspective || this.#pendingRemoval?.kind !== 'gallery' || this.#pendingRemoval.recordId !== item.recordId) return false;
    if (item.deviceId !== perspective.deviceId) {
      this.#lastUtilityError = 'Gallery removal rejected because the selected asset no longer belongs to this phone perspective.';
      this.#pendingRemoval = null;
      await this.renderActive();
      return false;
    }
    const sequence = ++this.#utilitySequence;
    try {
      this.#lastUtilityError = null;
      await this.#models.removeGalleryAsset({
        scope: this.#scope,
        recordId: item.recordId,
        source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: `gallery-remove:${perspective.deviceId}:${item.recordId}:${sequence}`, version: '1' },
        producer: 'phase23-gallery-shell',
        idempotencyKey: `gallery-remove:${perspective.deviceId}:${item.recordId}:${sequence}`,
      });
      this.#selectedGalleryRecordId = null;
      this.#pendingRemoval = null;
      await this.renderActive();
      return true;
    } catch (error) {
      this.#lastUtilityError = error instanceof Error ? error.message : String(error);
      this.#pendingRemoval = null;
      await this.renderActive();
      return false;
    }
  }
  async #removeFileItem(view, item) {
    const perspective = view?.opened?.perspective;
    if (!item || !perspective || this.#pendingRemoval?.kind !== 'file' || this.#pendingRemoval.recordId !== item.recordId) return false;
    if (item.deviceId !== perspective.deviceId) {
      this.#lastUtilityError = 'File removal rejected because the selected file no longer belongs to this phone perspective.';
      this.#pendingRemoval = null;
      await this.renderActive();
      return false;
    }
    const sequence = ++this.#utilitySequence;
    try {
      this.#lastUtilityError = null;
      await this.#models.removeFile({
        scope: this.#scope,
        recordId: item.recordId,
        source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: `file-remove:${perspective.deviceId}:${item.recordId}:${sequence}`, version: '1' },
        producer: 'phase23-files-shell',
        idempotencyKey: `file-remove:${perspective.deviceId}:${item.recordId}:${sequence}`,
      });
      this.#selectedFileRecordId = null;
      this.#pendingRemoval = null;
      await this.renderActive();
      return true;
    } catch (error) {
      this.#lastUtilityError = error instanceof Error ? error.message : String(error);
      this.#pendingRemoval = null;
      await this.renderActive();
      return false;
    }
  }
  dispose() { if (!this.#root) return; this.#controller.close({ scope: this.#scope, deviceId: this.#selectedDeviceId }); this.#root.remove(); this.#root = null; }
}
