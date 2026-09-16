import { PhoneRouter } from './router.mjs';
import { contactsViewModel } from './contacts-minimal.mjs';
import { developerDiagnostics } from './dev-diagnostics.mjs';
import { feedViewModel } from './feed.mjs';
import { notificationCenterViewModel } from './notifications.mjs';
import { renderApprovedCallSurface } from './calls/approved-call-surface.mjs';
import { renderVoiceSetup } from './voice-setup.mjs';
import { createPreviewIcon } from './app-icons.mjs';
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
import { CALL_EVENT_TYPES } from '../domain/calls/call-event-types.mjs';
import { createPreviewRootChrome, createPreviewLockScreen, createPreviewHome, createPreviewOwnerSheet, createPreviewStatusBar, createPreviewAvatar, createPreviewCommerceNav, createPreviewLifestyleNav, wrapPreviewApp } from './preview37-surface.mjs';

const element = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const formatBytes = value => { const bytes = Math.max(0, Number(value) || 0); if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; };
const normalizeDialNumber = value => String(value || '').replace(/[^0-9+*#]/gu, '');
const DIAL_KEYS = Object.freeze([['1',''],['2','ABC'],['3','DEF'],['4','GHI'],['5','JKL'],['6','MNO'],['7','PQRS'],['8','TUV'],['9','WXYZ'],['*',''],['0','+'],['#','']]);
const firstDescendant = (node, predicate) => { if (!node) return null; if (predicate(node)) return node; for (const child of node.children || []) { const found = firstDescendant(child, predicate); if (found) return found; } return null; };
const APP_TITLES = Object.freeze({ contacts: 'Phone', messages: 'Messages', calls: 'Phone', feed: 'Insungram', insungram: 'Insungram', live: 'Live', notifications: 'กิจกรรม', gallery: 'Gallery', files: 'Files', theme: 'Themes', maps: 'Maps', calendar: 'Calendar', wallet: 'กระเป๋าเงิน', shop: 'ร้านค้า', weather: 'Weather', health: 'Health', notes: 'Notes', search: 'Search', guide: 'Guide', settings: 'Settings', diagnostics: 'Diagnostics' });
const appKind = route => ['feed','insungram','live','messages','notifications'].includes(route) ? 'social' : ['wallet','shop'].includes(route) ? 'commerce' : ['maps','calendar','weather','health'].includes(route) ? 'lifestyle' : ['notes','search','calls','contacts'].includes(route) ? 'personal' : 'utility';
const addIcon = (document, node, name, size) => { node.append(createPreviewIcon({ document, name, size })); return node; };
const createActionNonce = () => typeof globalThis.crypto?.randomUUID === 'function'
  ? globalThis.crypto.randomUUID().replaceAll('-', '')
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export class TmrwPhoneShell {
  #callDetailsSessionId = null;
  #activeCharacterAvatarUrl = null;
  #callHistoryFilter = 'all';
  #dialpadOpen = false;
  #dialpadDigits = '';
  #dialpadMessage = null;
  #document; #models; #controller; #messaging; #calls; #callCoordinator; #callStoryIntegration; #callBotReply; #callVoicePresenter; #storyContinuation; #social; #notifications; #scope; #player; #playerDisplayName; #activeCharacterDisplayName; #selectedDeviceId; #selectedThreadId = null; #selectedLiveSessionId = null; #selectedCallSessionId = null; #selectedGalleryRecordId = null; #selectedFileRecordId = null; #locationDraftLabel = ''; #selectedLocationAudienceIds = new Set(); #calendarFormMode = null; #calendarViewTab = 'today'; #healthViewTab = 'summary'; #calendarSequence = 0; #lastCalendarError = null; #selectedWalletRecordId = null; #selectedShopRecordId = null; #checkoutConfirmationRecordId = null; #checkoutResult = null; #shopStaleRecordId = null; #checkoutBusy = false; #commerceSequence = 0; #lastCommerceError = null; #selectedNoteRecordId = null; #noteFormMode = null; #pendingNoteDeleteId = null; #noteSequence = 0; #searchQuery = ''; #submittedSearchQuery = ''; #searchSequence = 0; #searchClearBusy = false; #lastPersonalError = null; #pendingRemoval = null; #closedCallSurfaceId = null; #selectedVoiceActorId = null; #voiceRuntimeHealth = null; #voiceRuntimeBusy = false; #selectedPerspectiveLabel = 'My Phone'; #selectedPerspectiveKind = 'my-phone'; #selectedGuideTopic = GUIDE_TOPICS[0]; #guideBusy = false; #lastGuideError = null; #settingsBusy = false; #lastSettingsError = null; #settingsChoice = null; #bootstrapBusy = false; #bootstrapProgress = null; #socialBusy = false; #lastSocialActionError = null; #messageSequence = 0; #directThreadBusy = false; #callSequence = 0; #callActionNonce = createActionNonce(); #callTurnStates = new Map(); #callTurnControllers = new Map(); #callTurnRetries = new Map(); #callWarmKey = null; #callConnectedAt = new Map(); #outgoingCallBusy = false; #socialSequence = 0; #utilitySequence = 0; #lastMessageError = null; #lastCallError = null; #lastNotificationError = null; #lastUtilityError = null; #router; #root; #screen; #sheetLayer; #toast; #onClose; #presentationView = 'lock'; #homePage = 0; #homePageByDevice = new Map(); #homePagerTimer = null; #metrics = { shellMounts: 0, appRegionUpdates: 0, wholeShellReplacements: 0, layoutReads: 0, eventHistoryScans: 0 };

  #renderedRoute = null;
  #renderRevision = 0;

  constructor({ document, viewModels, controller, messageService = null, callService = null, callCoordinator = null, callStoryIntegration = null, callBotReply = null, callVoicePresenter = null, storyContinuation = null, socialService = null, notificationService = null, scope, playerActorId, playerInstanceId, playerDisplayName = null, activeCharacterDisplayName = null, activeCharacterAvatarUrl = null, selectedDeviceId, onClose = null }) {
    if (!document || !viewModels || !controller) throw new TypeError('TmrwPhoneShell requires a DOM document and Phase 7 services');
    this.#activeCharacterAvatarUrl = activeCharacterAvatarUrl;
    this.#document = document; this.#models = viewModels; this.#controller = controller; this.#messaging = messageService; this.#calls = callService; this.#callCoordinator = callCoordinator || viewModels.callCoordinator || null; this.#callStoryIntegration = callStoryIntegration; this.#callBotReply = callBotReply; this.#callVoicePresenter = callVoicePresenter; this.#storyContinuation = storyContinuation; this.#social = socialService; this.#notifications = notificationService; this.#scope = scope; this.#player = { actorId: playerActorId, instanceId: playerInstanceId }; this.#playerDisplayName = playerDisplayName; this.#activeCharacterDisplayName = activeCharacterDisplayName; this.#selectedDeviceId = selectedDeviceId; this.#onClose = typeof onClose === 'function' ? onClose : null;
    this.#router = new PhoneRouter({ onChange: () => { this.#lastUtilityError = null; this.#lastCalendarError = null; this.#calendarFormMode = null; this.#lastCommerceError = null; this.#selectedWalletRecordId = null; this.#selectedShopRecordId = null; this.#checkoutConfirmationRecordId = null; this.#checkoutResult = null; this.#shopStaleRecordId = null; this.#checkoutBusy = false; this.#selectedNoteRecordId = null; this.#noteFormMode = null; this.#pendingNoteDeleteId = null; this.#searchQuery = ''; this.#submittedSearchQuery = ''; this.#searchClearBusy = false; this.#lastPersonalError = null; this.#lastGuideError = null; this.#lastSettingsError = null; this.#settingsChoice = null; this.#lastSocialActionError = null; this.#pendingRemoval = null; this.#closeSheet(); void this.renderActive(); } });
  }
  get metrics() { return Object.freeze({ ...this.#metrics, router: this.#router.route, presentation: this.#presentationView }); }
  get root() { return this.#root; }
  #deviceRoster() { return this.#models.deviceRoster(this.#scope, { playerActorId: this.#player.actorId, playerDisplayName: this.#playerDisplayName, activeCharacterDisplayName: this.#activeCharacterDisplayName }); }

  async mount(target) {
    if (this.#root) return this.#root;
    const chrome = createPreviewRootChrome({ document: this.#document, onClose: () => this.close() });
    target.append(chrome.root); this.#root = chrome.root; this.#screen = chrome.screen; this.#sheetLayer = chrome.sheet; this.#toast = chrome.toast; this.#metrics.shellMounts += 1;
    await this.render(); void this.#initializeDetectedVoice(); return this.#root;
  }
  open() { if (!this.#root) return false; try { this.#document.activeElement?.blur?.(); this.#root.setAttribute?.('tabindex', '-1'); this.#root.focus?.({ preventScroll: true }); } catch {} this.#presentationView = 'lock'; this.#selectedThreadId = null; this.#selectedLiveSessionId = null; this.#closedCallSurfaceId = null; if (this.#router.route !== 'launcher') this.#router.navigate('launcher'); else void this.renderActive(); this.#document.body?.classList?.add?.('tmrw-phone-no-scroll'); return true; }
  close() { this.#closeSheet(); this.#document.body?.classList?.remove?.('tmrw-phone-no-scroll'); if (this.#onClose) this.#onClose(); else if (this.#root) this.#root.hidden = true; return true; }
  #lock() { this.#presentationView = 'lock'; this.#selectedThreadId = null; this.#selectedLiveSessionId = null; if (this.#router.route !== 'launcher') this.#router.navigate('launcher'); else void this.renderActive(); }
  #goHome() { this.#presentationView = 'home'; this.#selectedThreadId = null; this.#selectedLiveSessionId = null; if (this.#router.route !== 'launcher') this.#router.navigate('launcher'); else void this.renderActive(); }
  #openRoute(route) { this.#presentationView = 'home'; this.#selectedThreadId = null; this.#selectedLiveSessionId = null; this.#router.navigate(route); }
  #closeSheet() { if (!this.#sheetLayer) return; this.#sheetLayer.className = ''; this.#sheetLayer.replaceChildren?.(); }

  async #showOwnerSheet(devices) {
    if (!this.#sheetLayer) return;
    const rows = devices.map(row => Object.freeze({ ...row, selected: row.deviceId === this.#selectedDeviceId }));
    const sheet = createPreviewOwnerSheet({ document: this.#document, devices: rows, onSelect: deviceId => { this.#closeSheet(); void this.selectDevice(deviceId); }, onClose: () => this.#closeSheet() });
    this.#sheetLayer.className = 'is-open'; this.#sheetLayer.replaceChildren(sheet.backdrop, sheet.sheet);
  }

  async render() {
    const revision = ++this.#renderRevision;
    const root = this.#root; const screen = this.#screen; const route = this.#router.route;
    if (!root || !screen) return null;
    const isCurrent = () => this.#root === root && this.#screen === screen && this.#router.route === route && this.#renderRevision === revision;
    const roster = await this.#deviceRoster(); if (!isCurrent()) return null; const myPhone = roster.find(row => row.kind === 'my-phone');
    if (!myPhone) throw new Error('Canonical My Phone device is unavailable for the current Story/Branch');
    if (!roster.some(row => row.deviceId === this.#selectedDeviceId)) this.#selectedDeviceId = myPhone.deviceId;
    const selected = roster.find(row => row.deviceId === this.#selectedDeviceId) || myPhone; this.#selectedPerspectiveLabel = selected.label; this.#selectedPerspectiveKind = selected.kind; root.dataset.route = route; root.dataset.presentation = this.#presentationView;

    if (route === 'launcher') {
      const overview = await this.#models.previewOverview({ scope: this.#scope, deviceId: this.#selectedDeviceId, playerActorId: this.#player.actorId, playerInstanceId: this.#player.instanceId, controller: this.#controller }); if (!isCurrent()) return null;
      root.dataset.theme = overview.themeId || 'light-blue';
      const onOwner = () => { void this.#showOwnerSheet(roster); };
      if (this.#presentationView === 'lock') {
        screen.replaceChildren(createPreviewLockScreen({ document: this.#document, ownerLabel: selected.label, overview, onOwner, onUnlock: target => { this.#presentationView = 'home'; if (target && target !== 'home') this.#openRoute(target); else void this.renderActive(); }, onTarget: target => { this.#presentationView = 'home'; this.#openRoute(target); }, onClose: () => this.close() }));
      } else {
        screen.replaceChildren(createPreviewHome({ document: this.#document, ownerLabel: selected.label, overview, homePage: this.#homePage, onOwner, onApp: nextRoute => this.#openRoute(nextRoute), onPage: (page, pager) => { this.#homePage = Math.max(0, Math.min(1, Number(page) || 0)); this.#homePageByDevice.set(this.#selectedDeviceId, this.#homePage); if (!pager) return; const left = this.#homePage * Math.max(1, Number(pager.clientWidth || 0)); if (typeof pager.scrollTo === 'function') pager.scrollTo({ left, behavior: 'smooth' }); else pager.scrollLeft = left; }, onDock: action => { if (action === 'owner') onOwner(); else this.#openRoute(action); }, onLock: () => this.#lock() }));
      }
      this.#renderedRoute = route; this.#metrics.appRegionUpdates += 1; return overview;
    }

    const refreshingSameRoute = this.#renderedRoute === route && Boolean(screen.children?.length);
    if (!refreshingSameRoute) screen.replaceChildren(this.#loadingScreen(route));
    let view;
    try { view = await this.#models.selected({ scope: this.#scope, deviceId: this.#selectedDeviceId, playerActorId: this.#player.actorId, playerInstanceId: this.#player.instanceId, route, controller: this.#controller, selectedThreadId: this.#selectedThreadId, selectedCallSessionId: this.#selectedCallSessionId, selectedLiveSessionId: this.#selectedLiveSessionId, activeCharacterDisplayName: this.#activeCharacterDisplayName }); }
    catch (error) { if (!isCurrent()) return null; screen.replaceChildren(this.#errorScreen(route, error)); this.#renderedRoute = route; this.#metrics.appRegionUpdates += 1; return null; }
    if (!isCurrent()) return null;
    root.dataset.theme = view.settings?.themeId || 'light-blue';
    this.#metrics.eventHistoryScans += view.renderMetrics.canonicalEventHistoryScans;
    this.#selectedCallSessionId = view.activeCallSessionId || this.#selectedCallSessionId;
    const content = await this.#renderContent(view); if (!isCurrent()) return null; screen.replaceChildren(content); this.#renderedRoute = route; this.#metrics.appRegionUpdates += 1; return view;
  }

  #loadingScreen(route) { const body = element(this.#document, 'section'); body.className = 'tmrw-phone-utility-list'; const row = element(this.#document, 'p', `กำลังโหลด ${APP_TITLES[route] || route}…`); row.setAttribute('role','status'); body.append(row); return wrapPreviewApp({ document:this.#document, kind:appKind(route), app:route, title:APP_TITLES[route]||route, body, onBack:()=>this.#goHome() }); }
  #errorScreen(route, error) { const body=element(this.#document,'section');body.className='tmrw-phone-utility-list';const alert=element(this.#document,'p',`${APP_TITLES[route]||route} ยังไม่พร้อมใช้งาน`);alert.setAttribute('role','alert');const retry=element(this.#document,'button','Retry');retry.type='button';retry.dataset.action='retry-app';retry.addEventListener('click',()=>{retry.disabled=true;void this.renderActive();});body.append(alert,retry);return wrapPreviewApp({document:this.#document,kind:appKind(route),app:route,title:APP_TITLES[route]||route,body,onBack:()=>this.#goHome()}); }

  async selectDevice(deviceId) { if (deviceId === this.#selectedDeviceId) return; this.#homePageByDevice.set(this.#selectedDeviceId, this.#homePage); this.#controller.close({ scope:this.#scope, deviceId:this.#selectedDeviceId }); this.#selectedDeviceId=deviceId; this.#homePage=this.#homePageByDevice.get(deviceId) || 0; this.#selectedThreadId=null; this.#selectedGalleryRecordId=null; this.#selectedFileRecordId=null; this.#locationDraftLabel=''; this.#selectedLocationAudienceIds.clear(); this.#calendarFormMode=null; this.#lastCalendarError=null; this.#selectedWalletRecordId=null; this.#selectedShopRecordId=null; this.#checkoutConfirmationRecordId=null; this.#checkoutResult=null; this.#shopStaleRecordId=null; this.#checkoutBusy=false; this.#lastCommerceError=null; this.#selectedNoteRecordId=null; this.#noteFormMode=null; this.#pendingNoteDeleteId=null; this.#searchQuery=''; this.#submittedSearchQuery=''; this.#searchClearBusy=false; this.#lastPersonalError=null; this.#lastSocialActionError=null; this.#socialBusy=false; this.#pendingRemoval=null; this.#screen?.replaceChildren?.(); await this.render(); }
  async renderActive() { if (this.#root) await this.render(); }

  #socialNav(route) {
    const nav=element(this.#document,'nav');nav.className='tmrw-phone-social-nav'; const tabs=[['feed','home','ฟีด'],['live','live','ไลฟ์'],['messages','send','ข้อความ'],['notifications','heart','กิจกรรม'],['insungram','user','โปรไฟล์']];
    for(const [target,name,label] of tabs){const button=element(this.#document,'button');button.type='button';button.className=route===target?'is-active':'';button.setAttribute('aria-label',label);addIcon(this.#document,button,name,25);if(target==='messages'){const i=element(this.#document,'i');button.append(i);}button.addEventListener('click',()=>this.#openRoute(target));nav.append(button);} return nav;
  }
  #socialShell(route,title,body) { const root=element(this.#document,'div');root.className='tmrw-phone-social-shell';root.append(createPreviewStatusBar({document:this.#document}));const header=element(this.#document,'header');header.className='tmrw-phone-social-header';const back=element(this.#document,'button');back.type='button';addIcon(this.#document,back,'back',23);back.addEventListener('click',()=>this.#goHome());const owner=element(this.#document,'button');owner.type='button';owner.className='tmrw-phone-social-title';owner.append(element(this.#document,'strong',title));if(route==='messages'||route==='insungram')addIcon(this.#document,owner,'chevron',15);owner.addEventListener('click',()=>{void this.#deviceRoster().then(devices=>this.#showOwnerSheet(devices));});const more=element(this.#document,'button');more.type='button';more.disabled=true;addIcon(this.#document,more,route==='messages'?'plus':'more',24);header.append(back,owner,more);root.append(header);const main=element(this.#document,'main');main.className='tmrw-phone-social-content';main.append(body);root.append(main,this.#socialNav(route));const indicator=element(this.#document,'div');indicator.className='tmrw-phone-home-indicator';root.append(indicator);return root; }

  #renderFeed(view) {
    const feed = element(this.#document, 'section'); feed.className = 'tmrw-phone-feed';
    if (!view.opened.authorization.granted) { feed.append(element(this.#document, 'p', 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return this.#socialShell('feed', 'Insungram', feed); }
    if (view.socialError) { const p = element(this.#document, 'p', 'โหลด Feed ไม่สำเร็จ'); p.setAttribute('role', 'alert'); const retry = element(this.#document, 'button', 'Retry'); retry.dataset.action = 'retry-feed'; retry.addEventListener('click', () => void this.renderActive()); feed.append(p, retry); return this.#socialShell('feed', 'Insungram', feed); }
    const intro = element(this.#document, 'div'); intro.className = 'tmrw-phone-feed-intro'; const introCopy = element(this.#document, 'div'); introCopy.append(element(this.#document, 'small', `FOR ${this.#selectedPerspectiveLabel.toUpperCase()}`), element(this.#document, 'strong', `ฟีดของ ${this.#selectedPerspectiveLabel}`)); const settings = element(this.#document, 'button'); settings.disabled = true; addIcon(this.#document, settings, 'settings', 18); intro.append(introCopy, settings); feed.append(intro);
    if (this.#social && view.opened.perspective.accountId) { const composer = element(this.#document, 'div'); composer.className = 'tmrw-phone-feed-intro tmrw-v3-feed-composer'; const input = element(this.#document, 'textarea'); input.setAttribute('aria-label', 'Post text'); input.placeholder = 'เขียนโพสต์…'; const send = element(this.#document, 'button', 'โพสต์'); send.dataset.action = 'create-feed-post'; send.disabled = true; input.addEventListener('input', () => { send.disabled = this.#socialBusy || !String(input.value || '').trim(); }); send.addEventListener('click', () => { if (this.#socialBusy || !String(input.value || '').trim()) return; this.#socialBusy = true; send.disabled = true; void this.#createPost(view, input).finally(() => { this.#socialBusy = false; }); }); composer.append(input, send); feed.append(composer); }
    const posts = feedViewModel(view.feed);
    for (const post of posts) {
      const authorLabel = view.feedAccountLabels?.[post.authorAccountId] || 'บัญชี'; const article = element(this.#document, 'article'); article.className = 'tmrw-phone-post'; article.dataset.postId = post.postId;
      const header = element(this.#document, 'header'); header.append(createPreviewAvatar({ document: this.#document, label: authorLabel, size: 'md' })); const meta = element(this.#document, 'div'); meta.append(element(this.#document, 'strong', authorLabel), element(this.#document, 'span', post.audience || '')); header.append(meta); const more = element(this.#document, 'button'); more.disabled = true; addIcon(this.#document, more, 'more', 18); header.append(more); article.append(header, element(this.#document, 'p', post.text));
      const actions = element(this.#document, 'div'); actions.className = 'tmrw-phone-post-actions'; const heart = element(this.#document, 'button'); heart.disabled = true; addIcon(this.#document, heart, 'heart', 20); heart.append(element(this.#document, 'span', '—')); const comment = element(this.#document, 'button'); comment.disabled = true; addIcon(this.#document, comment, 'comment', 20); comment.append(element(this.#document, 'span', '—')); const send = element(this.#document, 'button'); send.disabled = true; addIcon(this.#document, send, 'send', 20); actions.append(heart, comment, send); article.append(actions); feed.append(article);
    }
    if (!posts.length) { const empty = element(this.#document, 'div'); empty.className = 'tmrw-phone-empty-state'; empty.append(element(this.#document, 'strong', 'ฟีดยังว่างอยู่'), element(this.#document, 'p', 'ยังไม่มีโพสต์ในข้อมูล Production ปัจจุบัน')); feed.append(empty); }
    const end = element(this.#document, 'div'); end.className = 'tmrw-phone-refeed-zone'; const mark = element(this.#document, 'i'); addIcon(this.#document, mark, 'refresh', 30); end.append(mark, element(this.#document, 'strong', 'รีฟีด — หาโพสต์ใหม่เพิ่ม'), element(this.#document, 'p', 'การสร้างโพสต์อัตโนมัติปิดอยู่')); const disabled = element(this.#document, 'button', 'โหลดโพสต์เพิ่ม'); disabled.disabled = true; end.append(disabled); feed.append(end); return this.#socialShell('feed', 'Insungram', feed);
  }

  #renderMessages(view) {
    if (!view.opened.authorization.granted) { const body = element(this.#document, 'section'); body.className = 'tmrw-phone-messages'; body.append(element(this.#document, 'p', 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return this.#socialShell('messages', this.#selectedPerspectiveLabel, body); }
    if (this.#selectedThreadId) return this.#renderThread(view);
    const body = element(this.#document, 'section'); body.className = 'tmrw-phone-messages';
    const search = element(this.#document, 'label'); search.className = 'tmrw-phone-search'; addIcon(this.#document, search, 'search', 19);
    const input = element(this.#document, 'input'); input.placeholder = 'ค้นหาข้อความ'; input.setAttribute('autocomplete', 'off'); search.append(input); body.append(search);
    const noteRow = element(this.#document, 'div'); noteRow.className = 'tmrw-phone-note-row';
    const own = element(this.#document, 'button'); own.type = 'button'; own.disabled = true;
    const bubble = element(this.#document, 'span', 'โน้ตของคุณ'); bubble.className = 'tmrw-phone-note-bubble';
    const avatar = element(this.#document, 'span'); avatar.className = 'tmrw-phone-note-avatar'; avatar.append(createPreviewAvatar({ document: this.#document, label: this.#selectedPerspectiveLabel, size: 'lg' }));
    own.append(bubble, avatar, element(this.#document, 'b', 'โน้ตของคุณ')); noteRow.append(own); body.append(noteRow);
    const heading = element(this.#document, 'div'); heading.className = 'tmrw-phone-message-section-title'; heading.append(element(this.#document, 'strong', 'ข้อความ'));
    const requests = element(this.#document, 'button', 'คำขอ'); requests.type = 'button'; requests.disabled = true; requests.setAttribute('aria-label', 'คำขอยังไม่มีข้อมูล'); heading.append(requests); body.append(heading);
    const list = element(this.#document, 'div'); list.className = 'tmrw-phone-thread-list'; const rows = [];
    for (const thread of view.threadRows || []) {
      const row = element(this.#document, 'button'); row.type = 'button'; row.className = 'tmrw-phone-thread'; row.dataset.threadId = thread.threadId;
      row.append(createPreviewAvatar({ document: this.#document, label: thread.label, size: 'lg' }));
      const copy = element(this.#document, 'span'); copy.append(element(this.#document, 'strong', thread.label));
      if (thread.secondary) copy.append(element(this.#document, 'em', thread.secondary));
      copy.append(element(this.#document, 'small', thread.preview)); row.append(copy);
      row.addEventListener('click', () => { this.#selectedThreadId = thread.threadId; void this.renderActive(); }); list.append(row); rows.push({ row, thread });
    }
    if (!rows.length && (view.communicationTargets || []).length) {
      const intro = element(this.#document, 'div'); intro.className = 'tmrw-phone-connect-intro';
      intro.append(element(this.#document, 'strong', 'เริ่มคุยได้ทันที'), element(this.#document, 'p', 'Instant mode เชื่อมตัวละครในเรื่องโดยไม่ต้องสร้างเบอร์โทรปลอม'));
      list.append(intro);
      for (const target of view.communicationTargets) {
        const row = element(this.#document, 'button'); row.type = 'button'; row.className = 'tmrw-phone-thread tmrw-phone-instant-target'; row.dataset.instantTargetAccountId = target.accountId;
        row.append(createPreviewAvatar({ document: this.#document, label: target.label, size: 'lg' }));
        const copy = element(this.#document, 'span'); copy.append(element(this.#document, 'strong', target.label), element(this.#document, 'small', 'แตะเพื่อเริ่ม DM • ไม่ต้องใช้เบอร์')); row.append(copy, createPreviewIcon({ document: this.#document, name: 'send', size: 19 }));
        row.addEventListener('click', () => void this.#startDirectThread(view, target)); list.append(row); rows.push({ row, thread: { label: target.label, secondary: '', preview: 'Instant contact' } });
      }
    } else if (!rows.length) {
      const empty = element(this.#document, 'div'); empty.className = 'tmrw-phone-empty-state tmrw-phone-connect-empty';
      const storyMode = view.settings.phoneNumberDiscovery === PHONE_NUMBER_DISCOVERY.SMART;
      empty.append(element(this.#document, 'strong', 'ยังไม่มี DM หรือกรุ๊ปแชท'), element(this.#document, 'p', !view.instantEligible ? 'โทรศัพท์ของตัวละครเปิดดูอย่างเดียวจากมุมมองนี้' : storyMode ? 'Story mode กำลังรอให้ค้นพบเบอร์ของตัวละครในเนื้อเรื่อง' : 'การเชื่อมต่อตัวละครอัตโนมัติปิดอยู่'));
      if (view.instantEligible) { const activate = element(this.#document, 'button', 'เชื่อมตัวละครทันที'); activate.type = 'button'; activate.dataset.action = 'enable-instant-connect'; activate.addEventListener('click', () => void this.#setPhoneNumberDiscovery(PHONE_NUMBER_DISCOVERY.ON)); empty.append(activate); } list.append(empty);
    }
    input.addEventListener('input', () => { const query = String(input.value || '').trim().toLocaleLowerCase(); for (const { row, thread } of rows) row.hidden = Boolean(query) && !`${thread.label} ${thread.secondary || ''} ${thread.preview}`.toLocaleLowerCase().includes(query); });
    body.append(list); return this.#socialShell('messages', this.#selectedPerspectiveLabel, body);
  }
  #renderThread(view) {
    const thread = (view.threadRows || []).find(row => row.threadId === this.#selectedThreadId) || (view.threadRows || [])[0] || null;
    const title = thread?.label || 'ข้อความ'; const subtitle = thread?.secondary || (thread ? `${thread.participantCount} คน` : (view.messages.length ? `${view.messages.length} ข้อความ` : 'ยังไม่มีข้อความ'));
    const root = element(this.#document, 'div'); root.className = 'tmrw-phone-thread-screen'; root.append(createPreviewStatusBar({ document: this.#document }));
    const header = element(this.#document, 'header'); header.className = 'tmrw-phone-chat-header'; const back = element(this.#document, 'button'); addIcon(this.#document, back, 'back', 23); back.addEventListener('click', () => { this.#selectedThreadId = null; void this.renderActive(); });
    header.append(back, createPreviewAvatar({ document: this.#document, label: title, size: 'sm' })); const info = element(this.#document, 'div'); info.append(element(this.#document, 'strong', title), element(this.#document, 'small', subtitle)); header.append(info);
    const call = element(this.#document, 'button'); call.disabled = true; addIcon(this.#document, call, 'phone', 21); const more = element(this.#document, 'button'); more.disabled = true; addIcon(this.#document, more, 'more', 21); header.append(call, more); root.append(header);
    const context = element(this.#document, 'div'); context.className = 'tmrw-phone-chat-context'; const note = element(this.#document, 'div'); note.append(element(this.#document, 'small', 'NOTE'), element(this.#document, 'p', 'ยังไม่มีโน้ตสำหรับแชทนี้')); const music = element(this.#document, 'div'); music.append(element(this.#document, 'small', 'NOW PLAYING'), element(this.#document, 'strong', 'ไม่มีเพลง'), element(this.#document, 'span', '')); context.append(note, music); root.append(context);
    const contactFor = instanceId => (view.contacts || []).find(contact => contact.targetInstanceId === instanceId) || null;
    const bubbles = element(this.#document, 'main'); bubbles.className = 'tmrw-phone-bubbles'; const day = element(this.#document, 'div'); day.className = 'tmrw-phone-day-divider'; day.append(element(this.#document, 'span', 'EARLIER · TODAY')); bubbles.append(day);
    for (const message of view.messages) {
      const mine = message.senderAccountId === view.opened.perspective.accountId; const contact = mine ? null : contactFor(message.actualAuthorInstanceId); const authorLabel = mine ? this.#selectedPerspectiveLabel : (contact?.savedName || contact?.number || title);
      const row = element(this.#document, 'div'); row.className = `tmrw-phone-bubble-row ${mine ? 'is-mine' : ''}`; row.dataset.messageId = message.messageId; row.setAttribute('aria-label', authorLabel);
      if (!mine) row.append(createPreviewAvatar({ document: this.#document, label: authorLabel, size: 'xs' })); const bubble = element(this.#document, 'div'); if (thread?.kind === 'group' && !mine) { const sender = element(this.#document, 'b', authorLabel); sender.className = 'tmrw-phone-bubble-sender'; bubble.append(sender); } bubble.append(element(this.#document, 'p', message.text)); row.append(bubble); bubbles.append(row);
    }
    root.append(bubbles);
    const composer = element(this.#document, 'div'); composer.className = 'tmrw-phone-readonly-composer tmrw-v3-message-composer'; const plus = element(this.#document, 'button'); plus.disabled = true; addIcon(this.#document, plus, 'plus', 20); const input = element(this.#document, 'textarea'); input.setAttribute('aria-label', 'Message text'); input.placeholder = 'พิมพ์ข้อความ…'; const send = element(this.#document, 'button'); send.className = 'is-send'; send.disabled = true; addIcon(this.#document, send, 'send', 20); input.addEventListener('input', () => { send.disabled = !String(input.value || '').trim(); }); let busy = false; send.addEventListener('click', () => { if (busy || send.disabled) return; busy = true; send.disabled = true; void this.#sendMessage(view, input).finally(() => { busy = false; }); }); composer.append(plus, input, send); root.append(composer); const indicator = element(this.#document, 'div'); indicator.className = 'tmrw-phone-home-indicator'; root.append(indicator); return root;
  }

  #renderLive(view) {
    if (!view.opened.authorization.granted) { const body = element(this.#document, 'section'); body.className = 'tmrw-phone-live-list'; body.append(element(this.#document, 'p', 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return this.#socialShell('live', 'Live', body); }
    if (view.liveError) { const body = element(this.#document, 'section'); body.className = 'tmrw-phone-live-list'; const p = element(this.#document, 'p', 'โหลด Live ไม่สำเร็จ'); p.setAttribute('role', 'alert'); const retry = element(this.#document, 'button', 'ลองอีกครั้ง'); retry.type = 'button'; retry.dataset.action = 'retry-live'; retry.addEventListener('click', () => void this.renderActive()); body.append(p, retry); return this.#socialShell('live', 'Live', body); }
    if (this.#selectedLiveSessionId && view.selectedLive?.sessionId === this.#selectedLiveSessionId) {
      const room = view.selectedLive; const hostLabel = view.liveAccountLabels?.[room.hostAccountId] || room.title || 'Live';
      const root = element(this.#document, 'div'); root.className = 'tmrw-phone-live-viewer'; root.append(createPreviewStatusBar({ document: this.#document }));
      const header = element(this.#document, 'header'); const back = element(this.#document, 'button'); addIcon(this.#document, back, 'back', 23); back.addEventListener('click', () => { this.#selectedLiveSessionId = null; void this.renderActive(); });
      header.append(back, createPreviewAvatar({ document: this.#document, label: hostLabel, size: 'sm' })); const info = element(this.#document, 'div'); info.append(element(this.#document, 'strong', hostLabel), element(this.#document, 'small', `${Number(view.liveViewers?.count || 0).toLocaleString()} กำลังรับชม · ${(view.liveMessages?.items || []).length} ข้อความสด`)); header.append(info, element(this.#document, 'i', 'LIVE'));
      const close = element(this.#document, 'button'); addIcon(this.#document, close, 'close', 22); close.addEventListener('click', () => { this.#selectedLiveSessionId = null; void this.renderActive(); }); header.append(close); root.append(header);
      const stage = element(this.#document, 'div'); stage.className = 'tmrw-phone-live-stage'; const orb = element(this.#document, 'div'); orb.className = 'tmrw-phone-live-orb'; orb.append(createPreviewAvatar({ document: this.#document, label: hostLabel, size: 'xxl' }), element(this.#document, 'span', room.title), element(this.#document, 'small', room.topic || 'LIVE')); stage.append(orb, element(this.#document, 'p', room.description || 'ยังไม่มีคำอธิบายเพิ่มเติม')); root.append(stage);
      const chat = element(this.#document, 'div'); chat.className = 'tmrw-phone-live-chat'; for (const message of view.liveMessages?.items || []) { const p = element(this.#document, 'p'); p.dataset.liveMessageId = message.messageId; p.append(element(this.#document, 'strong', `@${view.liveAccountLabels?.[message.authorAccountId] || 'ผู้ชม'}`), this.#document.createTextNode ? this.#document.createTextNode(` ${message.text}`) : element(this.#document, 'span', ` ${message.text}`)); chat.append(p); } if (!(view.liveMessages?.items || []).length) chat.append(element(this.#document, 'p', 'ยังไม่มีข้อความสด')); root.append(chat);
      const controls = element(this.#document, 'div'); controls.className = 'tmrw-phone-live-controls'; controls.append(element(this.#document, 'span', 'อ่านอย่างเดียว')); const heart = element(this.#document, 'button'); heart.disabled = true; addIcon(this.#document, heart, 'heart', 22); controls.append(heart); root.append(controls); const indicator = element(this.#document, 'div'); indicator.className = 'tmrw-phone-home-indicator'; root.append(indicator); return root;
    }
    const body = element(this.#document, 'section'); body.className = 'tmrw-phone-live-list'; const sessions = view.liveSessions?.items || [];
    if (!sessions.length) { const empty = element(this.#document, 'div'); empty.className = 'tmrw-phone-live-empty'; addIcon(this.#document, empty, 'live', 31); empty.append(element(this.#document, 'strong', 'ตอนนี้ยังไม่มีใครกำลังไลฟ์'), element(this.#document, 'p', 'ยังไม่มี Live session ในข้อมูลปัจจุบัน')); body.append(empty); }
    else { const hero = element(this.#document, 'div'); hero.className = 'tmrw-phone-live-hero'; hero.append(element(this.#document, 'span', 'LIVE NOW'), element(this.#document, 'h2', 'ชีวิตนอกฉากกำลังเกิดขึ้น'), element(this.#document, 'p', 'ห้องสดจากข้อมูล Production ปัจจุบัน')); body.append(hero); for (const session of sessions) { const card = element(this.#document, 'button'); card.type = 'button'; card.className = 'tmrw-phone-live-card'; card.dataset.liveSessionId = session.sessionId; const hostLabel = view.liveAccountLabels?.[session.hostAccountId] || session.title || 'Live'; const cover = element(this.#document, 'div'); cover.className = 'tmrw-phone-live-cover'; cover.append(createPreviewAvatar({ document: this.#document, label: hostLabel, size: 'xl' }), element(this.#document, 'i', 'LIVE')); const copy = element(this.#document, 'div'); copy.append(element(this.#document, 'small', session.topic || 'LIVE'), element(this.#document, 'strong', session.title), element(this.#document, 'p', `${hostLabel} · ${session.status}`)); card.append(cover, copy, createPreviewIcon({ document: this.#document, name: 'chevron', size: 20 })); card.addEventListener('click', () => { this.#selectedLiveSessionId = session.sessionId; void this.renderActive(); }); body.append(card); } }
    const end = element(this.#document, 'div'); end.className = 'tmrw-phone-live-refresh'; const mark = element(this.#document, 'i'); addIcon(this.#document, mark, 'refresh', 25); const copy = element(this.#document, 'div'); copy.append(element(this.#document, 'strong', 'อยากดูอะไรสด ๆ เพิ่มไหม'), element(this.#document, 'p', 'การสร้าง Live อัตโนมัติปิดอยู่')); const disabled = element(this.#document, 'button', 'รีไลฟ์'); disabled.disabled = true; end.append(mark, copy, disabled); body.append(end); return this.#socialShell('live', 'Live', body);
  }

  #renderActivity(view) {
    const body = element(this.#document, 'section'); body.className = 'tmrw-phone-explore';
    const card = (iconName, title, detail) => { const section = element(this.#document, 'div'); section.className = 'tmrw-phone-activity-card'; const header = element(this.#document, 'header'); const mark = element(this.#document, 'span'); addIcon(this.#document, mark, iconName, 21); const copy = element(this.#document, 'div'); copy.append(element(this.#document, 'strong', title), element(this.#document, 'small', detail)); header.append(mark, copy); section.append(header); return section; };
    const recent = card('heart', 'กิจกรรมล่าสุด', 'การแจ้งเตือนของโทรศัพท์เครื่องนี้'); const items = notificationCenterViewModel({ items: view.phoneWorld.recent });
    for (const item of items) { const row = element(this.#document, 'button'); row.type = 'button'; row.dataset.notificationId = item.notificationId; row.append(createPreviewAvatar({ document: this.#document, label: item.title, size: 'sm' })); const text = element(this.#document, 'span'); text.append(element(this.#document, 'b', item.title), element(this.#document, 'small', item.preview || '')); row.append(text, element(this.#document, 'i', 'ล่าสุด')); row.addEventListener('click', () => void this.#openNotification(view, item)); recent.append(row); }
    if (!items.length) { const empty = element(this.#document, 'p', 'ยังไม่มีกิจกรรม'); empty.className = 'tmrw-phone-empty-state'; recent.append(empty); } body.append(recent);
    const followed = card('userPlus', 'เพิ่งกดติดตาม', 'บัญชีที่เจ้าของเครื่องเพิ่มล่าสุด'); const followedEmpty = element(this.#document, 'p', 'ยังไม่มีข้อมูลบัญชีที่ติดตาม'); followedEmpty.className = 'tmrw-phone-empty-state'; followed.append(followedEmpty); body.append(followed);
    const trending = card('trend', 'กำลังเป็นที่นิยม', 'หัวข้อจากข้อมูลสังคมของ Branch นี้'); const trendingEmpty = element(this.#document, 'p', 'ยังไม่มีข้อมูลหัวข้อกำลังนิยม'); trendingEmpty.className = 'tmrw-phone-empty-state'; trending.append(trendingEmpty); body.append(trending);
    return this.#socialShell('notifications', 'กิจกรรม', body);
  }
  #renderProfile(view) {
    const body = element(this.#document, 'section'); body.className = 'tmrw-phone-profile'; const ownedPosts = feedViewModel(view.feed).filter(post => post.authorAccountId === view.opened.perspective.accountId);
    const top = element(this.#document, 'div'); top.className = 'tmrw-phone-profile-top'; top.append(createPreviewAvatar({ document: this.#document, label: this.#selectedPerspectiveLabel, size: 'xxl' })); const stats = element(this.#document, 'div'); stats.className = 'tmrw-phone-profile-stats';
    for (const [value, label] of [[ownedPosts.length, 'โพสต์'], ['—', 'ผู้ติดตาม'], ['—', 'กำลังติดตาม']]) { const span = element(this.#document, 'span'); span.append(element(this.#document, 'b', String(value)), element(this.#document, 'small', label)); stats.append(span); } top.append(stats); body.append(top);
    const bio = element(this.#document, 'div'); bio.className = 'tmrw-phone-profile-bio'; const profileCopy = view.socialProfile?.captionStyle || (view.socialProfile?.typicalTopics || []).join(' · ') || 'ยังไม่มีข้อมูลโปรไฟล์เพิ่มเติม'; bio.append(element(this.#document, 'strong', this.#selectedPerspectiveLabel), element(this.#document, 'p', profileCopy)); body.append(bio);
    const buttons = element(this.#document, 'div'); buttons.className = 'tmrw-phone-profile-buttons'; for (const label of ['แก้ไขโปรไฟล์', 'แชร์โปรไฟล์']) { const button = element(this.#document, 'button', label); button.disabled = true; buttons.append(button); } body.append(buttons);
    const tabs = element(this.#document, 'div'); tabs.className = 'tmrw-phone-profile-tabs'; const postsTab = element(this.#document, 'button', 'โพสต์ข้อความ'); postsTab.className = 'is-active'; const savedTab = element(this.#document, 'button', 'บันทึกไว้'); savedTab.disabled = true; tabs.append(postsTab, savedTab); body.append(tabs);
    const posts = element(this.#document, 'div'); posts.className = 'tmrw-phone-profile-posts'; for (const post of ownedPosts.slice(0, 12)) { const article = element(this.#document, 'article'); article.dataset.postId = post.postId; article.append(element(this.#document, 'small', view.feedAccountLabels?.[post.authorAccountId] || this.#selectedPerspectiveLabel), element(this.#document, 'p', post.text)); const footer = element(this.#document, 'footer'); footer.append(createPreviewIcon({ document: this.#document, name: 'heart', size: 17 }), element(this.#document, 'span', '—'), createPreviewIcon({ document: this.#document, name: 'comment', size: 17 }), element(this.#document, 'span', '—')); article.append(footer); posts.append(article); } if (!ownedPosts.length) { const empty = element(this.#document, 'p', 'ยังไม่มีโพสต์ของบัญชีนี้'); empty.className = 'tmrw-phone-empty-state'; posts.append(empty); } body.append(posts);
    return this.#socialShell('insungram', this.#selectedPerspectiveLabel, body);
  }

  #avatarUrlFor(label, instanceId = null, view = null) {
    if (!this.#activeCharacterAvatarUrl) return null;
    const expected = String(this.#activeCharacterDisplayName || '').trim().toLocaleLowerCase();
    const actual = String(label || '').trim().toLocaleLowerCase();
    if (expected && actual && (actual === expected || actual.includes(expected) || expected.includes(actual))) return this.#activeCharacterAvatarUrl;
    const targets = [...(view?.communicationTargets || []), ...(view?.callUi?.dialTargets || [])];
    if (instanceId && targets.some(target => target.instanceId === instanceId && (!expected || String(target.label || '').trim().toLocaleLowerCase() === expected))) return this.#activeCharacterAvatarUrl;
    if (targets.length === 1 && (!instanceId || targets[0].instanceId === instanceId)) return this.#activeCharacterAvatarUrl;
    return null;
  }

  #attachDialpadLauncher(page, view) {
    const button = element(this.#document, 'button'); button.type = 'button'; button.className = 'tmrw-phone-dialpad-launcher'; button.dataset.callAction = 'open-dialpad'; button.disabled = view.callUi?.owner?.canAct === false;
    button.append(createPreviewIcon({ document: this.#document, name: 'phone', size: 19 }), element(this.#document, 'span', 'โทร'));
    button.addEventListener('click', () => { this.#dialpadOpen = true; this.#dialpadMessage = null; if (this.#router.route !== 'calls') this.#router.navigate('calls'); else void this.renderActive(); }); page.append(button); return page;
  }

  #renderDialpad(view) {
    const body = element(this.#document, 'section'); body.className = 'tmrw-phone-dialpad';
    const recommended = element(this.#document, 'section'); recommended.className = 'tmrw-phone-dialpad-recommended'; recommended.append(element(this.#document, 'h3', 'แนะนำ'));
    for (const target of (view.callUi?.dialTargets || []).slice(0, 3)) {
      const row = element(this.#document, 'button'); row.type = 'button'; row.dataset.callTargetAccountId = target.accountId;
      row.append(createPreviewAvatar({ document: this.#document, label: target.label, size: 'md', imageUrl: this.#avatarUrlFor(target.label, target.instanceId, view) }));
      const copy = element(this.#document, 'span'); copy.append(element(this.#document, 'strong', target.label), element(this.#document, 'small', target.number || 'โทรได้ทันที')); row.append(copy, createPreviewIcon({ document: this.#document, name: 'phone', size: 20 }));
      row.addEventListener('click', () => { this.#dialpadOpen = false; void this.#startOutgoing(view, target); }); recommended.append(row);
    }
    if ((view.callUi?.dialTargets || []).length) body.append(recommended);
    const display = element(this.#document, 'div', this.#dialpadDigits || 'กดหมายเลข'); display.className = `tmrw-phone-dialpad-display${this.#dialpadDigits ? '' : ' is-empty'}`; body.append(display);
    const message = element(this.#document, 'p', this.#dialpadMessage || ''); message.className = 'tmrw-phone-dialpad-message'; message.hidden = !this.#dialpadMessage; body.append(message);
    const pad = element(this.#document, 'div'); pad.className = 'tmrw-phone-dialpad-grid';
    const call = element(this.#document, 'button'); call.type = 'button'; call.className = 'tmrw-phone-dialpad-call'; call.dataset.callAction = 'dial-number'; call.append(createPreviewIcon({ document: this.#document, name: 'phone', size: 23 }), element(this.#document, 'span', 'โทร'));
    const update = () => { display.textContent = this.#dialpadDigits || 'กดหมายเลข'; display.className = `tmrw-phone-dialpad-display${this.#dialpadDigits ? '' : ' is-empty'}`; message.hidden = true; message.textContent = ''; call.disabled = !this.#dialpadDigits; };
    for (const [digit, letters] of DIAL_KEYS) { const key = element(this.#document, 'button'); key.type = 'button'; key.className = 'tmrw-phone-dialpad-key'; key.dataset.dialKey = digit; key.append(element(this.#document, 'strong', digit), element(this.#document, 'small', letters)); key.addEventListener('click', () => { if (this.#dialpadDigits.length >= 24) return; this.#dialpadDigits += digit; update(); }); pad.append(key); }
    const deleteButton = element(this.#document, 'button', '⌫'); deleteButton.type = 'button'; deleteButton.className = 'tmrw-phone-dialpad-delete'; deleteButton.setAttribute('aria-label', 'ลบหมายเลข'); deleteButton.addEventListener('click', () => { this.#dialpadDigits = this.#dialpadDigits.slice(0, -1); update(); });
    const actions = element(this.#document, 'div'); actions.className = 'tmrw-phone-dialpad-actions'; actions.append(call, deleteButton); body.append(pad, actions); update();
    call.addEventListener('click', () => { const number = normalizeDialNumber(this.#dialpadDigits); const target = (view.callUi?.dialTargets || []).find(row => normalizeDialNumber(row.number) === number); if (target) { this.#dialpadOpen = false; void this.#startOutgoing(view, target); return; } message.textContent = 'ยังไม่พบหมายเลขนี้ใน Story/Branch ปัจจุบัน'; message.hidden = false; });
    return wrapPreviewApp({ document: this.#document, kind: 'personal', app: 'calls', title: 'ปุ่มกด', subtitle: 'โทรด้วยหมายเลข', body, onBack: () => { this.#dialpadOpen = false; this.#dialpadDigits = ''; this.#dialpadMessage = null; void this.renderActive(); } });
  }

  #renderCallsBase(view) {
    const body = element(this.#document, 'section'); body.className = 'tmrw-phone-personal-app tmrw-phone-phone-app';
    const tabs = element(this.#document, 'div'); tabs.className = 'tmrw-phone-phone-tabs'; const historyTab = element(this.#document, 'button', 'Call History'); historyTab.className = 'is-active'; const contactsTab = element(this.#document, 'button', 'Saved Names'); contactsTab.addEventListener('click', () => this.#router.navigate('contacts')); tabs.append(historyTab, contactsTab); body.append(tabs);
    const filters = element(this.#document, 'div'); filters.className = 'tmrw-phone-filter-chips tmrw-phone-soft-chips tmrw-phone-call-filters';
    for (const [value, label] of [['all','All'],['ended','Ended'],['missed','Missed'],['cancelled','Cancelled']]) { const button = element(this.#document, 'button', label); button.type = 'button'; button.dataset.callFilter = value; if (this.#callHistoryFilter === value) button.className = 'is-active'; button.addEventListener('click', () => { this.#callHistoryFilter = value; void this.renderActive(); }); filters.append(button); } body.append(filters);
    const visible = view.callUi.history.filter(call => this.#callHistoryFilter === 'all' || call.statusCategory === this.#callHistoryFilter);
    const groups = element(this.#document, 'div'); groups.className = 'tmrw-phone-call-groups'; if (!visible.length) groups.append(element(this.#document, 'p', this.#callHistoryFilter === 'all' ? 'ยังไม่มี Call History' : `ยังไม่มีสาย ${this.#callHistoryFilter}`));
    const sections = new Map();
    for (const call of visible) { let section = sections.get(call.dateGroupKey); if (!section) { section = element(this.#document, 'section'); section.className = 'tmrw-phone-call-group'; section.dataset.dateGroup = call.dateGroupKey; section.append(element(this.#document, 'h3', call.dateGroupLabel)); sections.set(call.dateGroupKey, section); groups.append(section); } const row = element(this.#document, 'button'); row.className = 'tmrw-phone-call-row'; row.dataset.callSessionId = call.callSessionId; row.append(createPreviewAvatar({ document:this.#document, label:call.displayLabel, size:'sm', imageUrl:this.#avatarUrlFor(call.displayName, call.counterpartInstanceId, view) })); const copy = element(this.#document, 'span'); copy.append(element(this.#document, 'strong', call.displayLabel), element(this.#document, 'small', `${call.statusLabel} · ${call.durationLabel}`)); row.append(copy, element(this.#document, 'time', call.timeLabel), createPreviewIcon({ document:this.#document, name:'more', size:17 })); row.addEventListener('click', () => { this.#selectedCallSessionId = call.callSessionId; this.#callDetailsSessionId = call.callSessionId; this.#closedCallSurfaceId = null; void this.renderActive(); }); section.append(row); }
    body.append(groups); const page = wrapPreviewApp({ document:this.#document, kind:'personal', app:'calls', title:'Phone', subtitle:'Call History และ Saved Names ของเครื่องนี้', body, onBack:()=>this.#goHome() }); return this.#attachDialpadLauncher(page, view);
  }
  #renderCallDetails(view, detail) {
    const body=element(this.#document,'section');body.className='tmrw-phone-call-details';
    const hero=element(this.#document,'div');hero.className='tmrw-phone-call-details-hero';hero.append(createPreviewAvatar({document:this.#document,label:detail.counterpartLabel,size:'xl',imageUrl:this.#avatarUrlFor(detail.counterpartDisplayName,detail.counterpartInstanceId,view)}),element(this.#document,'h2',detail.counterpartLabel),element(this.#document,'p',detail.directionLabel));
    const summary=element(this.#document,'dl');summary.className='tmrw-phone-call-details-summary';
    for(const [label,value] of [['วันที่',detail.dateLabel],['เวลาเริ่ม',detail.timeLabel],['สถานะ',detail.statusLabel],['ระยะเวลา',detail.durationLabel],['ภาษาของเสียง',detail.languageSummary]])summary.append(element(this.#document,'dt',label),element(this.#document,'dd',value));
    body.append(hero,summary);
    if(detail.callbackTarget){const callback=element(this.#document,'button','โทรกลับ');callback.type='button';callback.className='tmrw-phone-call-details-callback';callback.dataset.callAction='callback';callback.addEventListener('click',()=>{this.#callDetailsSessionId=null;this.#selectedCallSessionId=null;void this.#startOutgoing(view,detail.callbackTarget);});body.append(callback);}
    if(detail.audioArtifacts.length){const archive=element(this.#document,'section');archive.className='tmrw-phone-call-audio-archive';archive.append(element(this.#document,'h3','เสียงจากสายนี้'));const actions=element(this.#document,'div');actions.className='tmrw-phone-call-audio-actions';const replay=element(this.#document,'button','ฟังทั้งสาย');replay.type='button';replay.dataset.callAudioAction='replay-all';replay.addEventListener('click',()=>void this.#playArchivedAudio(detail,detail.audioArtifacts));const stop=element(this.#document,'button','หยุด');stop.type='button';stop.dataset.callAudioAction='stop';stop.addEventListener('click',()=>this.#callVoicePresenter?.stopArchivedPlayback?.(detail.callSessionId));const keep=element(this.#document,'button',detail.audioKept?'นำออกจากคลังถาวร':'เก็บสายนี้ไว้');keep.type='button';keep.dataset.callAudioAction='keep';keep.addEventListener('click',()=>void this.#setCallAudioKept(detail,!detail.audioKept));actions.append(replay,stop,keep);archive.append(actions);body.append(archive);}
    const transcript=element(this.#document,'section');transcript.className='tmrw-phone-call-details-transcript';transcript.append(element(this.#document,'h3','บทสนทนา'));
    if(!detail.transcript.length)transcript.append(element(this.#document,'p','สายนี้ยังไม่มีข้อความสนทนา'));
    for(const entry of detail.transcript){const row=element(this.#document,'article');row.className=`tmrw-phone-call-detail-turn is-${entry.speakerKind}`;row.dataset.transcriptEntryId=entry.transcriptEntryId;row.append(element(this.#document,'strong',entry.speakerLabel),element(this.#document,'p',entry.text));const audio=entry.audioSegments.filter(segment=>segment.recoverable);if(audio.length){const spoken=audio.map(segment=>segment.spokenText).filter(Boolean).join(' ');if(spoken)row.append(element(this.#document,'small',`${audio[0].languageLabel||'Voice'}: ${spoken}`));const controls=element(this.#document,'div');controls.className='tmrw-phone-call-segment-audio';const play=element(this.#document,'button','ฟัง');play.type='button';play.dataset.audioTranscriptId=entry.transcriptEntryId;play.addEventListener('click',()=>void this.#playArchivedAudio(detail,audio));const download=element(this.#document,'button','ดาวน์โหลด');download.type='button';download.addEventListener('click',()=>void this.#downloadArchivedTurn(detail,entry,audio));controls.append(play,download);row.append(controls);}transcript.append(row);}
    body.append(transcript);
    if(detail.audioStorage){const storage=element(this.#document,'section');storage.className='tmrw-phone-call-audio-storage';storage.append(element(this.#document,'strong','พื้นที่เสียง'),element(this.#document,'p',`ชั่วคราว ${formatBytes(detail.audioStorage.temporaryBytes)} · เก็บไว้ ${formatBytes(detail.audioStorage.keptBytes)} · รวม ${formatBytes(detail.audioStorage.totalBytes)}`));if(detail.audioStorage.temporaryArtifacts>0){const clean=element(this.#document,'button','ล้างเสียงชั่วคราว');clean.type='button';clean.dataset.callAudioAction='cleanup-temporary';clean.addEventListener('click',()=>void this.#deleteTemporaryCallAudio(detail.callSessionId));storage.append(clean);}body.append(storage);}
    return wrapPreviewApp({document:this.#document,kind:'personal',app:'calls',title:'รายละเอียดสาย',subtitle:`${detail.dateLabel} · ${detail.timeLabel}`,body,onBack:()=>{this.#callDetailsSessionId=null;this.#selectedCallSessionId=null;void this.renderActive();}});
  }
  async #playArchivedAudio(detail, artifacts) { return this.#callVoicePresenter?.playArchivedArtifacts?.({ callSessionId: detail.callSessionId, artifacts }) || false; }
  #downloadArchivedAudio(audio) { const URLApi=globalThis.URL;if(!audio?.audioBlob||typeof URLApi?.createObjectURL!=='function')return false;const ref=URLApi.createObjectURL(audio.audioBlob);const anchor=this.#document.createElement('a');anchor.href=ref;anchor.download=audio.filename||'tmrw-call-audio.wav';anchor.hidden=true;(this.#root||this.#document.body)?.append?.(anchor);anchor.click?.();anchor.remove?.();setTimeout(()=>{try{URLApi.revokeObjectURL?.(ref);}catch{}},0);return true; }
  async #downloadArchivedTurn(detail,entry,audio) { const blob=audio.length===1?audio[0].audioBlob:await this.#callVoicePresenter?.combineArchivedArtifacts?.(audio);if(!blob)return false;return this.#downloadArchivedAudio({audioBlob:blob,filename:`tmrw-call-${detail.callSessionId}-${entry.turnIndex+1}.wav`}); }
  async #setCallAudioKept(detail, kept) { await this.#models.setCallAudioKept({ scope:this.#scope,callSessionId:detail.callSessionId,kept });await this.renderActive(); }
  async #deleteTemporaryCallAudio(callSessionId) { this.#callVoicePresenter?.stopArchivedPlayback?.(callSessionId);await this.#models.deleteTemporaryCallAudio({ scope:this.#scope });await this.renderActive(); }
  #renderContacts(view) { const body=element(this.#document,'section');body.className='tmrw-phone-personal-app tmrw-phone-phone-app';const tabs=element(this.#document,'div');tabs.className='tmrw-phone-phone-tabs';const history=element(this.#document,'button','Call History');history.addEventListener('click',()=>this.#router.navigate('calls'));const saved=element(this.#document,'button','Saved Names');saved.className='is-active';tabs.append(history,saved);body.append(tabs);const search=element(this.#document,'label');search.className='tmrw-phone-personal-search tmrw-phone-soft-search';addIcon(this.#document,search,'search',20);const input=element(this.#document,'input');input.placeholder='Search saved names...';input.disabled=true;search.append(input);body.append(search);const list=element(this.#document,'div');list.className='tmrw-phone-saved-list';for(const contact of contactsViewModel(view.contacts)){const row=element(this.#document,'button');row.dataset.contactPointId=contact.id;row.append(createPreviewAvatar({document:this.#document,label:contact.primary,size:'md'}));const copy=element(this.#document,'span');copy.append(element(this.#document,'strong',contact.primary),element(this.#document,'small',contact.secondary));row.append(copy);const icon=element(this.#document,'b');addIcon(this.#document,icon,'phone',18);row.append(icon);list.append(row);}if(!view.contacts.length)list.append(element(this.#document,'p','ยังไม่มี Saved Names'));body.append(list);return wrapPreviewApp({document:this.#document,kind:'personal',app:'contacts',title:'Phone',subtitle:'Saved Names ของเครื่องนี้',body,onBack:()=>this.#goHome()}); }

  #commerceNav(route) { return createPreviewCommerceNav({ document:this.#document, active:route, onNavigate:target=>{ if(target==='launcher')this.#goHome(); else this.#openRoute(target); } }); }
  #lifestyleNav(route) { const calendar=route==='calendar'; const tabs=calendar?[['today','วันนี้','calendar'],['calendar','ปฏิทิน','grid'],['tasks','งาน','tasks'],['agenda','กำหนดการ','agenda']]:[['summary','สรุป','health'],['activity','กิจกรรม','runner'],['sleep','การนอน','moon'],['vitals','สัญญาณชีพ','pulse']]; const active=calendar?this.#calendarViewTab:this.#healthViewTab; return createPreviewLifestyleNav({ document:this.#document, app:route, tabs, active, onTab:id=>{ if(calendar)this.#calendarViewTab=id; else this.#healthViewTab=id; void this.renderActive(); } }); }
  #utilityWrap(route, body, title=APP_TITLES[route]) { const bottom=['wallet','shop'].includes(route)?this.#commerceNav(route):['calendar','health'].includes(route)?this.#lifestyleNav(route):null; const subtitles={notes:'บันทึกทุกไอเดีย สำคัญทุกวัน',search:'สิ่งที่เคยค้น เปิด และกลับไปดู',wallet:'เงินและรายการของเครื่องนี้',shop:'สินค้าและคำสั่งซื้อของเครื่องนี้',gallery:'อัลบั้มและภาพที่บันทึกไว้',files:'ไฟล์และเอกสาร',theme:'ธีมโทรศัพท์',guide:'คู่มือการใช้งาน',settings:'ตั้งค่าโทรศัพท์',diagnostics:'ข้อมูลระบบแบบอ่านอย่างเดียว'}; return wrapPreviewApp({document:this.#document,kind:appKind(route),app:route,title,subtitle:subtitles[route]||'',body,onBack:()=>this.#goHome(),bottom,ownerLabel:this.#selectedPerspectiveLabel}); }

  #renderContactsWithConnectivity(view) {
    if (this.#dialpadOpen) return this.#renderDialpad(view);
    const body = element(this.#document, 'section'); body.className = 'tmrw-phone-personal-app tmrw-phone-phone-app';
    const tabs = element(this.#document, 'div'); tabs.className = 'tmrw-phone-phone-tabs';
    const history = element(this.#document, 'button', 'Call History'); history.addEventListener('click', () => this.#router.navigate('calls'));
    const saved = element(this.#document, 'button', 'Saved Names'); saved.className = 'is-active'; tabs.append(history, saved); body.append(tabs);
    const search = element(this.#document, 'label'); search.className = 'tmrw-phone-personal-search tmrw-phone-soft-search'; addIcon(this.#document, search, 'search', 20);
    const input = element(this.#document, 'input'); input.placeholder = 'ค้นหาชื่อหรือตัวละคร'; input.disabled = !(view.contacts.length || view.communicationTargets.length); search.append(input); body.append(search);
    const list = element(this.#document, 'div'); list.className = 'tmrw-phone-saved-list'; const searchable = [];
    for (const contact of contactsViewModel(view.contacts)) {
      const row = element(this.#document, 'div'); row.className = 'tmrw-phone-contact-row'; row.dataset.contactPointId = contact.id; row.append(createPreviewAvatar({ document: this.#document, label: contact.primary, size: 'md', imageUrl: this.#avatarUrlFor(contact.primary, contact.targetInstanceId, view) }));
      const copy = element(this.#document, 'span'); copy.append(element(this.#document, 'strong', contact.primary), element(this.#document, 'small', contact.secondary)); row.append(copy); const icon = element(this.#document, 'b'); addIcon(this.#document, icon, 'phone', 18); row.append(icon); list.append(row); searchable.push({ row, text: `${contact.primary} ${contact.secondary}` });
    }
    const savedInstances = new Set((view.contacts || []).map(contact => contact.targetInstanceId).filter(Boolean));
    for (const target of view.communicationTargets || []) {
      if (savedInstances.has(target.instanceId)) continue;
      const row = element(this.#document, 'div'); row.className = 'tmrw-phone-contact-row tmrw-phone-instant-contact'; row.dataset.instantContactAccountId = target.accountId; row.append(createPreviewAvatar({ document: this.#document, label: target.label, size: 'md', imageUrl: this.#avatarUrlFor(target.label, target.instanceId, view) }));
      const copy = element(this.#document, 'span'); copy.append(element(this.#document, 'strong', target.label), element(this.#document, 'small', 'พร้อมติดต่อทันที • ไม่ต้องใช้เบอร์')); row.append(copy);
      const actions = element(this.#document, 'span'); actions.className = 'tmrw-phone-contact-actions'; const message = element(this.#document, 'button'); message.type = 'button'; message.setAttribute('aria-label', `เริ่มแชทกับ ${target.label}`); addIcon(this.#document, message, 'comment', 17); message.addEventListener('click', () => { this.#selectedThreadId = null; void this.#startDirectThread(view, target); }); const call = element(this.#document, 'button'); call.type = 'button'; call.setAttribute('aria-label', `โทรหา ${target.label}`); addIcon(this.#document, call, 'phone', 17); call.addEventListener('click', () => void this.#startDirectCall(view, target)); actions.append(message, call); row.append(actions); list.append(row); searchable.push({ row, text: target.label });
    }
    if (!list.children.length) {
      const empty = element(this.#document, 'div'); empty.className = 'tmrw-phone-empty-state tmrw-phone-connect-empty'; const storyMode = view.settings.phoneNumberDiscovery === PHONE_NUMBER_DISCOVERY.SMART;
      empty.append(element(this.#document, 'strong', 'ยังไม่มี Saved Names'), element(this.#document, 'p', !view.instantEligible ? 'โทรศัพท์ของตัวละครเปิดดูอย่างเดียวจากมุมมองนี้' : storyMode ? 'Story mode กำลังรอให้ตัวละครบอกเบอร์ของตัวเองในเนื้อเรื่อง' : 'การเชื่อมต่อตัวละครอัตโนมัติปิดอยู่'));
      if (view.instantEligible) { const activate = element(this.#document, 'button', 'เชื่อมตัวละครทันที'); activate.type = 'button'; activate.dataset.action = 'enable-instant-connect'; activate.addEventListener('click', () => void this.#setPhoneNumberDiscovery(PHONE_NUMBER_DISCOVERY.ON)); empty.append(activate); } list.append(empty);
    }
    input.addEventListener('input', () => { const query = String(input.value || '').trim().toLocaleLowerCase(); for (const item of searchable) item.row.hidden = Boolean(query) && !item.text.toLocaleLowerCase().includes(query); });
    if (this.#lastCallError) { const alert = element(this.#document, 'p', 'เริ่มสายไม่สำเร็จ กรุณาลองอีกครั้ง'); alert.className = 'tmrw-phone-call-start-error'; alert.setAttribute('role', 'alert'); body.append(alert); }
    body.append(list); const page = wrapPreviewApp({ document: this.#document, kind: 'personal', app: 'contacts', title: 'Phone', subtitle: view.settings.phoneNumberDiscovery === PHONE_NUMBER_DISCOVERY.ON ? 'Instant contacts ของเครื่องนี้' : 'Saved Names ของเครื่องนี้', body, onBack: () => this.#goHome() }); return this.#attachDialpadLauncher(page, view);
  }

  #restoreInterruptedCallTurn(island, call) {
    const callSessionId = String(island?.callSessionId || '').trim();
    if (!callSessionId || island?.kind !== 'active' || !call || !this.#callBotReply || !this.#callVoicePresenter) return;
    if (this.#callTurnStates.has(callSessionId) || this.#callTurnControllers.has(callSessionId) || this.#callTurnRetries.has(callSessionId)) return;
    const latest = (island.transcript || []).at(-1) || null;
    if (!latest?.transcriptEntryId || latest.speakerAccountId === island.counterpartAccountId) return;
    const transcript = Object.freeze({ ...latest, callSessionId });
    const commit = Object.freeze({
      event: Object.freeze({ eventType: CALL_EVENT_TYPES.TRANSCRIPT_ADDED, payload: Object.freeze({ transcript }) }),
      transcript,
    });
    const retry = () => this.#runCallReply(call, commit);
    this.#callTurnRetries.set(callSessionId, retry);
    this.#callTurnStates.set(callSessionId, Object.freeze({ phase: 'failed', message: 'คำตอบก่อนหน้าหยุดชะงัก', retryLabel: 'ลองตอบใหม่', locked: true }));
  }

  #renderCallsWithConnectivity(view) {
    if (this.#dialpadOpen) return this.#renderDialpad(view);
    if (this.#callDetailsSessionId && view.callUi.details?.callSessionId === this.#callDetailsSessionId) return this.#renderCallDetails(view, view.callUi.details);
    const island = view.callUi.island;
    if (island.kind !== 'empty' && island.callSessionId !== this.#closedCallSurfaceId) {
      const call = view.calls.find(row => row.callSessionId === island.callSessionId);
      this.#restoreInterruptedCallTurn(island, call);
      if (island.kind === 'active') { this.#rememberConnectedAt(call); this.#warmActiveCall(view, island.callSessionId); }
      return renderApprovedCallSurface({
        document: this.#document,
        avatarUrl: this.#activeCharacterAvatarUrl,
        island,
        inspectionOnly: view.callUi.owner.inspectionOnly,
        onAction: action => call ? this.#transitionCall(view, call, action) : null,
        onSend: input => call ? this.#sendCallText(view, call, input) : null,
        turnState: this.#callTurnStates.get(island.callSessionId) || null,
        captionsVisible: view.settings.voiceCaptionsEnabled !== false,
        onToggleCaptions: enabled => void this.#setVoiceCaptions(enabled),
        onRetry: () => this.#retryCallTurn(island.callSessionId),
        onClose: () => { this.#closedCallSurfaceId = island.callSessionId; this.#selectedCallSessionId = null; return this.renderActive(); },
        onContinueOnce: island.kind === 'ended' && this.#callStoryIntegration && this.#storyContinuation ? () => this.#continueAfterEnded(island.callSessionId) : null,
        onNavigate: target => { if (target === 'settings') this.#router.navigate('settings'); else if (target === 'history') { this.#closedCallSurfaceId = island.callSessionId; this.#selectedCallSessionId = null; void this.renderActive(); } },
      });
    }
    const base = this.#renderCallsBase(view); const main = firstDescendant(base, node => String(node.tagName || '').toLowerCase() === 'main'); if (!main) return base;
    if (!view.callUi.dialTargets.length && !view.callUi.history.length) {
      const empty = element(this.#document, 'div'); empty.className = 'tmrw-phone-empty-state tmrw-phone-connect-empty'; const storyMode = view.settings.phoneNumberDiscovery === PHONE_NUMBER_DISCOVERY.SMART;
      empty.append(element(this.#document, 'strong', 'ยังไม่มีคนที่โทรได้'), element(this.#document, 'p', !view.instantEligible ? 'โทรศัพท์ของตัวละครเปิดดูอย่างเดียวจากมุมมองนี้' : storyMode ? 'Story mode กำลังรอให้ค้นพบเบอร์ของตัวละครในเนื้อเรื่อง' : 'การเชื่อมต่อตัวละครอัตโนมัติปิดอยู่'));
      if (view.instantEligible) { const activate = element(this.#document, 'button', 'เชื่อมตัวละครทันที'); activate.type = 'button'; activate.dataset.action = 'enable-instant-connect'; activate.addEventListener('click', () => void this.#setPhoneNumberDiscovery(PHONE_NUMBER_DISCOVERY.ON)); empty.append(activate); } main.append(empty);
    }
    return base;
  }

  #warmActiveCall(view, callSessionId) {
    const language = String(view?.settings?.voiceLanguagePreference || 'en');
    const endpoint = String(view?.settings?.voiceRuntimeBaseUrl || '');
    const key = `${callSessionId}|${language}|${endpoint}`;
    if (!this.#callVoicePresenter?.warmCall || this.#callWarmKey === key) return false;
    this.#callWarmKey = key;
    void this.#callVoicePresenter.warmCall({ scope: this.#scope, playerInstanceId: this.#player.instanceId, callSessionId });
    return true;
  }

  #rememberConnectedAt(call) {
    const id = String(call?.callSessionId || '').trim();
    if (!id || this.#callConnectedAt.has(id)) return;
    const canonical = Date.parse(call?.connectedAt || '');
    this.#callConnectedAt.set(id, Number.isFinite(canonical) ? canonical : Date.now());
  }

  #measuredCallDuration(call) {
    const id = String(call?.callSessionId || '').trim();
    this.#rememberConnectedAt(call);
    const startedAt = this.#callConnectedAt.get(id);
    return Number.isFinite(startedAt) ? Math.max(0, Math.round(Date.now() - startedAt)) : 0;
  }

  async #renderContent(view) {
    const route=this.#router.route;
    if(route==='feed') return this.#renderFeed(view);
    if(route==='messages') return this.#renderMessages(view);
    if(route==='live') return this.#renderLive(view);
    if(route==='notifications') return this.#renderActivity(view);
    if(route==='insungram') return this.#renderProfile(view);
    if(route==='contacts') return this.#renderContactsWithConnectivity(view);
    if(route==='calls') return this.#renderCallsWithConnectivity(view);
    if(route==='gallery') return this.#utilityWrap(route,renderGallery({document:this.#document,items:view.galleryItems,authorizationGranted:view.opened.authorization.granted,error:view.utilityError||this.#lastUtilityError,selectedRecordId:this.#selectedGalleryRecordId,pendingRemovalRecordId:this.#pendingRemoval?.kind==='gallery'?this.#pendingRemoval.recordId:null,onOpen:recordId=>{this.#selectedGalleryRecordId=recordId;this.#pendingRemoval=null;void this.renderActive();},onRequestRemove:recordId=>{this.#pendingRemoval={kind:'gallery',recordId};void this.renderActive();},onCancelRemove:()=>{this.#pendingRemoval=null;void this.renderActive();},onConfirmRemove:item=>this.#removeGalleryItem(view,item)}));
    if(route==='files') return this.#utilityWrap(route,renderFiles({document:this.#document,items:view.fileItems,authorizationGranted:view.opened.authorization.granted,error:view.utilityError||this.#lastUtilityError,selectedRecordId:this.#selectedFileRecordId,pendingRemovalRecordId:this.#pendingRemoval?.kind==='file'?this.#pendingRemoval.recordId:null,onOpen:recordId=>{this.#selectedFileRecordId=recordId;this.#pendingRemoval=null;void this.renderActive();},onRequestRemove:recordId=>{this.#pendingRemoval={kind:'file',recordId};void this.renderActive();},onCancelRemove:()=>{this.#pendingRemoval=null;void this.renderActive();},onConfirmRemove:item=>this.#removeFileItem(view,item)}));
    if(route==='maps') return this.#utilityWrap(route,renderMaps({document:this.#document,authorizationGranted:view.opened.authorization.granted,error:view.utilityError||this.#lastUtilityError,items:view.locationItems,audiences:view.locationAudienceChoices,selectedAudienceIds:[...this.#selectedLocationAudienceIds],draftLabel:this.#locationDraftLabel,viewerAccountId:view.opened.perspective.accountId,viewerDeviceId:view.opened.perspective.deviceId,onDraft:value=>{this.#locationDraftLabel=value;void this.renderActive();},onToggleAudience:accountId=>{if(this.#selectedLocationAudienceIds.has(accountId))this.#selectedLocationAudienceIds.delete(accountId);else this.#selectedLocationAudienceIds.add(accountId);void this.renderActive();},onCheckIn:()=>this.#createLocation(view,'check-in'),onShare:()=>this.#createLocation(view,'shared'),onStartLive:()=>this.#createLocation(view,'live'),onEndLive:item=>this.#endLiveLocation(view,item)}));
    if(route==='calendar') return this.#utilityWrap(route,renderCalendar({document:this.#document,view:view.calendarView,recipients:view.calendarRecipients,authorizationGranted:view.opened.authorization.granted,error:view.calendarError||this.#lastCalendarError,activeTab:this.#calendarViewTab,formMode:this.#calendarFormMode,onStartForm:mode=>{this.#calendarFormMode=mode;this.#lastCalendarError=null;void this.renderActive();},onCancelForm:()=>{this.#calendarFormMode=null;this.#lastCalendarError=null;void this.renderActive();},onCreateReminder:input=>this.#createCalendarItem(view,'reminder',input),onCreateInvitation:input=>this.#createCalendarItem(view,'invitation',input),onAccept:item=>this.#respondCalendarInvitation(view,item,'accept'),onDecline:item=>this.#respondCalendarInvitation(view,item,'decline')}));
    if(route==='wallet') return this.#utilityWrap(route,renderWallet({document:this.#document,view:view.walletView,authorizationGranted:view.opened.authorization.granted,error:view.commerceError||this.#lastCommerceError,selectedRecordId:this.#selectedWalletRecordId,onSelect:recordId=>{this.#selectedWalletRecordId=recordId;void this.renderActive();}}));
    if(route==='shop') return this.#utilityWrap(route,renderShop({document:this.#document,view:view.shopView,walletView:view.walletView,authorizationGranted:view.opened.authorization.granted,error:view.commerceError||this.#lastCommerceError,selectedRecordId:this.#selectedShopRecordId,confirmationRecordId:this.#checkoutConfirmationRecordId,staleRecordId:this.#shopStaleRecordId,checkoutResult:this.#checkoutResult,checkoutBusy:this.#checkoutBusy,onSelect:recordId=>{this.#selectedShopRecordId=recordId;this.#checkoutConfirmationRecordId=null;this.#checkoutResult=null;this.#shopStaleRecordId=null;void this.renderActive();},onRequestCheckout:recordId=>{this.#checkoutConfirmationRecordId=recordId;void this.renderActive();},onCancelCheckout:()=>{this.#checkoutConfirmationRecordId=null;void this.renderActive();},onConfirmCheckout:item=>this.#checkoutShopItem(view,item),onRefreshItem:recordId=>{this.#selectedShopRecordId=recordId;this.#checkoutConfirmationRecordId=null;this.#checkoutResult=null;this.#shopStaleRecordId=null;void this.renderActive();}}));
    if(route==='weather') return this.#utilityWrap(route,renderWeather({document:this.#document,items:view.weatherItems,authorizationGranted:view.opened.authorization.granted,error:view.utilityError||this.#lastUtilityError}));
    if(route==='health') return this.#utilityWrap(route,renderHealth({document:this.#document,items:view.healthItems,activeTab:this.#healthViewTab,authorizationGranted:view.opened.authorization.granted,error:view.utilityError||this.#lastUtilityError}));
    if(route==='notes') return this.#utilityWrap(route,renderNotes({document:this.#document,items:view.noteItems,authorizationGranted:view.opened.authorization.granted,error:view.utilityError||this.#lastPersonalError,selectedRecordId:this.#selectedNoteRecordId,formMode:this.#noteFormMode,pendingDeleteRecordId:this.#pendingNoteDeleteId,onOpen:recordId=>{this.#selectedNoteRecordId=recordId;this.#noteFormMode=null;this.#pendingNoteDeleteId=null;void this.renderActive();},onStartCreate:()=>{this.#selectedNoteRecordId=null;this.#noteFormMode='new';void this.renderActive();},onStartEdit:()=>{if(this.#selectedNoteRecordId){this.#noteFormMode='edit';void this.renderActive();}},onCancelForm:()=>{this.#noteFormMode=null;void this.renderActive();},onSave:input=>this.#saveNote(view,input),onRequestDelete:recordId=>{this.#pendingNoteDeleteId=recordId;this.#noteFormMode=null;void this.renderActive();},onCancelDelete:()=>{this.#pendingNoteDeleteId=null;void this.renderActive();},onConfirmDelete:item=>this.#deleteNote(view,item)}));
    if(route==='search') return this.#utilityWrap(route,renderSearch({document:this.#document,history:view.searchHistory,sources:view.searchSources,authorizationGranted:view.opened.authorization.granted,error:view.utilityError||this.#lastPersonalError,query:this.#searchQuery,submittedQuery:this.#submittedSearchQuery,clearBusy:this.#searchClearBusy,onQuery:value=>{this.#searchQuery=value;},onSubmit:query=>this.#submitSearch(view,query),onClearHistory:()=>this.#clearSearchHistory(view)}));
    if(route==='theme') return this.#utilityWrap(route,renderTheme({document:this.#document,selectedTheme:view.settings.themeId,onSelect:themeId=>this.#setTheme(themeId)}));
    if(route==='guide') return this.#renderGuide(view);
    if(route==='settings') return await this.#renderSettings(view);
    if(route==='diagnostics') return this.#renderDiagnostics(view);
    return this.#errorScreen(route,new Error('Unsupported route'));
  }

  #renderGuide(view) {
    const body=element(this.#document,'div');body.className='tmrw-phone-utility-list';
    if(view.guideError||this.#lastGuideError){
      const p=element(this.#document,'p','Guide ยังไม่พร้อมใช้งาน');p.setAttribute('role','alert');
      const retry=element(this.#document,'button');retry.type='button';retry.dataset.action='retry-guide';const copy=element(this.#document,'span');copy.append(element(this.#document,'strong','ลองอีกครั้ง'),element(this.#document,'small','โหลดคำแนะนำใหม่'));retry.append(copy,createPreviewIcon({document:this.#document,name:'chevron',size:18}));retry.addEventListener('click',()=>{this.#lastGuideError=null;void this.renderActive();});body.append(p,retry);
    }else if(view.guideState){
      for(const topic of GUIDE_TOPICS){const b=element(this.#document,'button');b.dataset.guideTopic=topic;const copy=element(this.#document,'span');copy.append(element(this.#document,'strong',topic),element(this.#document,'small',GUIDE_TOPIC_CONTENT[topic]));b.append(copy,createPreviewIcon({document:this.#document,name:'chevron',size:18}));body.append(b);}
      const reset=element(this.#document,'button');const rcopy=element(this.#document,'span');rcopy.append(element(this.#document,'strong','Reset tips'),element(this.#document,'small','เริ่มคำแนะนำใหม่'));reset.append(rcopy);reset.dataset.action='reset-guide-tips';reset.addEventListener('click',()=>void this.#resetGuideTips());
      const replay=element(this.#document,'button');const pcopy=element(this.#document,'span');pcopy.append(element(this.#document,'strong','Replay tutorial'),element(this.#document,'small','เปิดคำแนะนำอีกครั้ง'));replay.append(pcopy);replay.dataset.action='replay-guide-tutorial';replay.addEventListener('click',()=>void this.#replayGuideTutorial());body.append(reset,replay);
    }
    return this.#utilityWrap('guide',body,'Guide');
  }

  async #renderSettings(view) {
    const body=element(this.#document,'div');body.className='tmrw-phone-utility-list tmrw-phone-settings-list';
    const row=(title,detail,value,action)=>{const b=element(this.#document,'button');const copy=element(this.#document,'span');copy.append(element(this.#document,'strong',title),element(this.#document,'small',detail));b.append(copy);if(value!=null)b.append(element(this.#document,'b',String(value)));else b.append(createPreviewIcon({document:this.#document,name:'chevron',size:18}));if(action&&!this.#settingsBusy)b.addEventListener('click',action);else b.disabled=true;return b;};
    if(this.#lastSettingsError){const alert=element(this.#document,'p',`บันทึกการตั้งค่าไม่สำเร็จ: ${this.#lastSettingsError}`);alert.setAttribute('role','alert');body.append(alert);}
    body.append(row('เจ้าของโทรศัพท์',this.#selectedPerspectiveLabel,null,()=>{ void this.#deviceRoster().then(devices=>this.#showOwnerSheet(devices)); }));
    const bootstrap=view.settings.playableBootstrap||{};const ready=bootstrap.status==='ready';const running=this.#bootstrapBusy||bootstrap.status==='running'||bootstrap.status==='quick-ready';const magic=row(ready?'อัปเดตมือถือให้ทันเรื่อง':'ทำให้มือถือพร้อมเล่น',running?this.#bootstrapStageLabel(this.#bootstrapProgress?.stage||bootstrap.stage,bootstrap):ready?`อ่านถึง ${bootstrap.totalMessages||0} ข้อความ • มือถือ ${bootstrap.castCount||0} เครื่อง`:'อ่านเรื่องที่คุยมาแล้ว และจัดมือถือทุกเครื่องให้เป็นปัจจุบัน','',running?null:()=>void this.#runPlayableBootstrap());magic.className='tmrw-phone-update-all';magic.dataset.action='playable-bootstrap';magic.disabled=running;const sparkle=element(this.#document,'i','✦');magic.append(sparkle);body.append(magic);
    if(bootstrap.status==='failed'&&bootstrap.lastError){const error=element(this.#document,'p',`เตรียมมือถือยังไม่สำเร็จ: ${bootstrap.lastError}`);error.className='tmrw-phone-bootstrap-error';error.setAttribute('role','alert');body.append(error);}
    body.append(row('Experience','เลือกวิธีเชื่อมตัวละครและการเข้าถึงโทรศัพท์',view.settings.preset,()=>{this.#settingsChoice=this.#settingsChoice==='experience'?null:'experience';void this.renderActive();}));
    if(this.#settingsChoice==='experience'){
      for(const [preset,label,detail] of [[EXPERIENCE_PRESET.SIMPLE,'Instant','เห็นตัวละครและเริ่มแชทหรือโทรได้ทันที'],[EXPERIENCE_PRESET.STORY,'Story','รอค้นพบเบอร์จากสิ่งที่เกิดขึ้นในเรื่อง'],[EXPERIENCE_PRESET.IMMERSIVE,'Immersive','เชื่อมตัวละครทันที แต่คงข้อจำกัดการเข้าถึงโทรศัพท์']]){const selected=view.settings.preset===preset;body.append(row(label,selected?`${detail} • ใช้อยู่`:detail,selected?'✓':null,selected?null:()=>{this.#settingsChoice=null;void this.#setExperiencePreset(preset);}));}
    }
    body.append(row('การเชื่อมต่อตัวละคร',view.settings.phoneNumberDiscovery===PHONE_NUMBER_DISCOVERY.ON?'Instant — ติดต่อได้โดยไม่ต้องมีเบอร์':view.settings.phoneNumberDiscovery===PHONE_NUMBER_DISCOVERY.SMART?'Story — รอเบอร์จากเนื้อเรื่อง':'ปิดการเชื่อมต่ออัตโนมัติ',view.settings.phoneNumberDiscovery,()=>{this.#settingsChoice=this.#settingsChoice==='discovery'?null:'discovery';void this.renderActive();}));
    if(this.#settingsChoice==='discovery'){
      for(const [value,label,detail] of [[PHONE_NUMBER_DISCOVERY.ON,'Instant','เชื่อมตัวละครทันทีโดยไม่สร้างเบอร์ปลอม'],[PHONE_NUMBER_DISCOVERY.SMART,'Story','ต้องค้นพบเบอร์จากเนื้อเรื่องก่อน'],[PHONE_NUMBER_DISCOVERY.OFF,'Off','ไม่เชื่อมตัวละครอัตโนมัติ']]){const selected=view.settings.phoneNumberDiscovery===value;body.append(row(label,selected?`${detail} • ใช้อยู่`:detail,selected?'✓':null,selected?null:()=>{this.#settingsChoice=null;void this.#setPhoneNumberDiscovery(value);}));}
    }
    body.append(row('Continue story after calls','หลังสายจบ',view.settings.continueStoryAfterCalls?'เปิด':'ปิด',()=>void this.#setContinueStoryAfterCalls(!view.settings.continueStoryAfterCalls)));
    body.append(row('Diagnostics','Advanced',view.settings.developerDiagnosticsEnabled?'เปิด':'ปิด',()=>void this.#setDeveloperDiagnostics(!view.settings.developerDiagnosticsEnabled)));
    if(view.settings.developerDiagnosticsEnabled)body.append(row('Open Diagnostics','ข้อมูล runtime แบบอ่านอย่างเดียว',null,()=>this.#router.navigate('diagnostics')));
    body.append(row('Guide','คำแนะนำการใช้งาน',null,()=>this.#router.navigate('guide')));
    const voiceRoster=(await this.#deviceRoster()).filter(r=>r.kind==='their-phone');if(!voiceRoster.some(r=>r.actorId===this.#selectedVoiceActorId))this.#selectedVoiceActorId=voiceRoster[0]?.actorId||null;const selectedIdentity=voiceRoster.find(r=>r.actorId===this.#selectedVoiceActorId)||null;let baseProfile=null,instanceOverride=null,resolvedProfile=null;if(selectedIdentity){baseProfile=await this.#models.voiceProfiles.getActorBase({actorId:selectedIdentity.actorId});instanceOverride=await this.#models.voiceProfiles.getInstanceOverride({scope:this.#scope,instanceId:selectedIdentity.instanceId});resolvedProfile=await this.#models.voiceProfiles.resolve({scope:this.#scope,actorId:selectedIdentity.actorId,instanceId:selectedIdentity.instanceId});}const voice=renderVoiceSetup({document:this.#document,settings:view.settings,capability:this.#models.voiceCapability,runtimeHealth:this.#voiceRuntimeHealth,runtimeBusy:this.#voiceRuntimeBusy,roster:voiceRoster,selectedActorId:this.#selectedVoiceActorId,selectedIdentity,baseProfile,instanceOverride,resolvedProfile,onToggleVoiceCalls:enabled=>void this.#setVoiceCalls(enabled),onToggleBotVoice:enabled=>void this.#setBotCallsWithVoice(enabled),onToggleCaptions:enabled=>void this.#setVoiceCaptions(enabled),onSetDefaultLanguage:language=>void this.#setVoiceLanguagePreference(language),onSetDefaultDelivery:delivery=>void this.#setVoiceDefaultDelivery(delivery),onSaveRuntimeBaseUrl:baseUrl=>void this.#setVoiceRuntimeBaseUrl(baseUrl),onTestRuntime:()=>void this.#testVoiceRuntime(),onSelectActor:identity=>{this.#selectedVoiceActorId=identity.actorId;void this.renderActive();},onSaveBaseName:profileName=>{if(selectedIdentity)void this.#setActorBaseVoice(selectedIdentity,{profileName});},onSetBaseLanguage:language=>{if(selectedIdentity)void this.#setActorBaseVoice(selectedIdentity,{language});},onToggleBaseLock:lockedByUser=>{if(selectedIdentity)void this.#setActorBaseVoice(selectedIdentity,{lockedByUser});},onToggleOverride:enabled=>{if(selectedIdentity)void this.#setInstanceVoiceOverride(selectedIdentity,{enabled});},onSaveOverrideName:profileName=>{if(selectedIdentity)void this.#setInstanceVoiceOverride(selectedIdentity,{profileName});},onSetOverrideLanguage:language=>{if(selectedIdentity)void this.#setInstanceVoiceOverride(selectedIdentity,{language});}});body.append(voice);return this.#utilityWrap('settings',body,'Settings'); }
  #renderDiagnostics(view) { const body=element(this.#document,'div');body.className='tmrw-phone-utility-list';if(!view.settings.developerDiagnosticsEnabled)body.append(element(this.#document,'p','Diagnostics ปิดอยู่'));else if(!view.opened.authorization.granted)body.append(element(this.#document,'p','โทรศัพท์เครื่องนี้ยังล็อกอยู่'));else{const d=developerDiagnostics({enabled:true,scope:this.#scope,perspective:view.opened.perspective,lifecycle:view.opened.lifecycle,renderMetrics:view.renderMetrics,callTiming:this.#models.callTimingDiagnostics?.snapshot?.()||null});const pre=element(this.#document,'pre',JSON.stringify(d,null,2));pre.className='tmrw-v3-diagnostics-output';body.append(pre);}return this.#utilityWrap('diagnostics',body,'Diagnostics'); }

  async #startDirectCall(view, target) {
    const started = await this.#startOutgoing(view, target);
    if (started) this.#router.navigate('calls');
    return started;
  }
  async #startDirectThread(view, target) {
    const perspective = view?.opened?.perspective;
    if (this.#directThreadBusy || !this.#messaging || !perspective?.accountId || !target?.accountId || target.accountId === perspective.accountId) return false;
    this.#directThreadBusy = true;
    const participantAccountIds = [perspective.accountId, target.accountId];
    const identityKey = [...participantAccountIds].sort().join(':');
    try {
      this.#lastMessageError = null;
      const result = await this.#messaging.createThread({
        scope: this.#scope,
        kind: 'dm',
        participantAccountIds,
        sourceMode: 'live',
        source: { authority: 'tmrw-v3-ui', kind: 'instant-connect', recordId: `instant-dm:${identityKey}`, version: '1' },
        producer: 'tmrw-instant-connect',
        idempotencyKey: `instant-dm:${identityKey}`,
      });
      this.#selectedThreadId = result.thread.threadId;
      if (this.#router.route !== 'messages') this.#router.navigate('messages');
      else await this.renderActive();
      return true;
    } catch (error) {
      this.#lastMessageError = error instanceof Error ? error.message : String(error);
      await this.renderActive();
      return false;
    } finally { this.#directThreadBusy = false; }
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
    if (!this.#callCoordinator || !target || this.#outgoingCallBusy) return false;
    this.#callDetailsSessionId = null;
    this.#outgoingCallBusy = true; const perspective = view.opened.perspective; const sequence = ++this.#callSequence; const key = 'phase18-call-start:' + perspective.deviceId + ':' + this.#callActionNonce + ':' + sequence; let started = false;
    try { this.#lastCallError = null; const result = await this.#callCoordinator.startOutgoing({ scope: this.#scope, deviceId: perspective.deviceId, playerActorId: this.#player.actorId, playerInstanceId: this.#player.instanceId, targetAccountId: target.accountId, autoAcceptTarget: target.autoAnswerEligible === true, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: key, version: '1' }, idempotencyKey: key }); if (!['ringing', 'active'].includes(result?.session?.state)) throw new Error('Call start did not produce an open Call Session'); this.#selectedCallSessionId = result.session.callSessionId; started = true; }
    catch (error) { this.#lastCallError = error instanceof Error ? error.message : String(error); }
    finally { try { await this.renderActive(); } finally { this.#outgoingCallBusy = false; } }
    return started;
  }
  async #transitionCall(view, call, action) {
    if (!call) return; const perspective = view.opened.perspective; const sequence = ++this.#callSequence; let canonicalEndCommitted = false;
    const measuredDurationMs = action === 'end' ? this.#measuredCallDuration(call) : null;
    if (['end', 'cancel', 'decline'].includes(action)) this.#cancelCallTurn(call.callSessionId, `call-${action}`);
    try {
      this.#lastCallError = null;
      if (action === 'end' && this.#callStoryIntegration) {
        await this.#callStoryIntegration.endCall({
          scope: this.#scope,
          deviceId: perspective.deviceId,
          playerActorId: this.#player.actorId,
          playerInstanceId: this.#player.instanceId,
          callSessionId: call.callSessionId,
          measuredDurationMs,
          consequences: [],
          latestVisibleRole: this.#storyContinuation?.latestVisibleRole?.() || null,
          continuationDriver: this.#storyContinuation,
          releaseEphemeral: () => this.#cancelCallTurn(call.callSessionId, 'call-ended'),
          source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: 'phase18-closure-call-end:' + perspective.deviceId + ':' + this.#callActionNonce + ':' + sequence, version: '1' },
          idempotencyKey: 'phase18-closure-call-end:' + perspective.deviceId + ':' + this.#callActionNonce + ':' + sequence,
        });
        canonicalEndCommitted = true;
      } else if (this.#callCoordinator) {
        const key = 'phase18-call-transition:' + perspective.deviceId + ':' + this.#callActionNonce + ':' + sequence;
        await this.#callCoordinator.transition({ scope: this.#scope, deviceId: perspective.deviceId, playerActorId: this.#player.actorId, playerInstanceId: this.#player.instanceId, callSessionId: call.callSessionId, action, measuredDurationMs, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: key, version: '1' }, idempotencyKey: key });
        canonicalEndCommitted = action === 'end';
      } else if (this.#calls && perspective.accountId) {
        const key = 'call-transition:' + perspective.deviceId + ':' + this.#callActionNonce + ':' + sequence;
        await this.#calls.transition({ scope: this.#scope, callSessionId: call.callSessionId, action, actualActorId: perspective.actualAuthorActorId || perspective.accountOwnerActorId, actualInstanceId: perspective.actualAuthorInstanceId || perspective.accountOwnerInstanceId, deviceId: perspective.deviceId, measuredDurationMs, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: key, version: '1' }, producer: 'phase9-shell', idempotencyKey: key });
        canonicalEndCommitted = action === 'end';
      }
      if (canonicalEndCommitted && !this.#callStoryIntegration) { try { this.#callVoicePresenter?.cancelCall?.(call.callSessionId); } catch {} }
      if (canonicalEndCommitted) this.#callConnectedAt.delete(call.callSessionId);
    } catch (error) { this.#lastCallError = error instanceof Error ? error.message : String(error); }
    await this.renderActive();
  }
  async #sendCallText(view, call, input) {
    const text = String(input.value || '').trim(); if (!text || !call || this.#callTurnStates.get(call.callSessionId)?.locked) return false; const perspective = view.opened.perspective; const sequence = ++this.#callSequence; let userCommit = null;
    try {
      this.#lastCallError = null;
      if (this.#callCoordinator) { const key = 'phase18-call-text:' + perspective.deviceId + ':' + this.#callActionNonce + ':' + sequence; userCommit = await this.#callCoordinator.sendText({ scope: this.#scope, deviceId: perspective.deviceId, playerActorId: this.#player.actorId, playerInstanceId: this.#player.instanceId, callSessionId: call.callSessionId, text, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: key, version: '1' }, idempotencyKey: key }); }
      else if (this.#calls && perspective.accountId) { const key = 'call-text:' + perspective.deviceId + ':' + this.#callActionNonce + ':' + sequence; userCommit = await this.#calls.addTranscript({ scope: this.#scope, callSessionId: call.callSessionId, speakerAccountId: perspective.accountId, actualAuthorActorId: perspective.actualAuthorActorId || perspective.accountOwnerActorId, actualAuthorInstanceId: perspective.actualAuthorInstanceId || perspective.accountOwnerInstanceId, deviceId: perspective.deviceId, text, source: { authority: 'tmrw-v3-ui', kind: 'live-phone', recordId: key, version: '1' }, producer: 'phase9-shell', idempotencyKey: key }); }
      input.value = '';
      if (userCommit) {
        const timingId = String(userCommit.event?.id || userCommit.transcript?.transcriptEntryId || '').trim();
        this.#models.callTimingDiagnostics?.begin?.(timingId, { callSessionId: call.callSessionId });
      }
      if (userCommit && this.#callBotReply && this.#callVoicePresenter) return this.#runCallReply(call, userCommit);
      this.#failCallTurn(call.callSessionId, 'ระบบตอบกลับด้วยเสียงยังไม่พร้อม', 'ลองตอบใหม่', () => this.#runCallReply(call, userCommit));
      return false;
    } catch (error) { this.#lastCallError = error instanceof Error ? error.message : String(error); this.#failCallTurn(call.callSessionId, 'ส่งข้อความไม่สำเร็จ', 'ลองตอบใหม่', () => this.#sendCallText(view, call, input)); return false; }
  }
  #setCallTurnState(callSessionId, state) {
    const id = String(callSessionId || '').trim(); if (!id) return;
    if (state) this.#callTurnStates.set(id, Object.freeze({ locked: true, ...state })); else this.#callTurnStates.delete(id);
    void this.renderActive();
  }
  #cancelCallTurn(callSessionId, reason = 'cancelled') {
    const id = String(callSessionId || '').trim(); if (!id) return false;
    const controller = this.#callTurnControllers.get(id); if (controller) { try { controller.abort(reason); } catch { controller.abort(); } }
    this.#callTurnControllers.delete(id); this.#callTurnRetries.delete(id); this.#callTurnStates.delete(id);
    try { this.#callBotReply?.cancelCall?.(id); } catch {}
    try { this.#callVoicePresenter?.cancelCall?.(id, reason); } catch {}
    if (this.#callWarmKey?.startsWith(`${id}|`)) this.#callWarmKey = null;
    this.#callConnectedAt.delete(id);
    return Boolean(controller);
  }
  #failCallTurn(callSessionId, message, retryLabel, retry) {
    const id = String(callSessionId || '').trim(); if (!id) return;
    if (typeof retry === 'function') this.#callTurnRetries.set(id, retry); else this.#callTurnRetries.delete(id);
    this.#setCallTurnState(id, { phase: 'failed', message, retryLabel, locked: true });
  }
  #retryCallTurn(callSessionId) {
    const id = String(callSessionId || '').trim(); const retry = this.#callTurnRetries.get(id); if (!retry) return false;
    this.#callTurnRetries.delete(id); void Promise.resolve().then(retry).catch(error => this.#failCallTurn(id, error instanceof Error ? error.message : String(error), 'ลองอีกครั้ง', retry)); return true;
  }
  async #runCallReply(call, userCommit) {
    const callSessionId = call.callSessionId;
    const prior = this.#callTurnControllers.get(callSessionId); if (prior) { try { prior.abort('replaced'); } catch { prior.abort(); } }
    const controller = new AbortController(); this.#callTurnControllers.set(callSessionId, controller); this.#callTurnRetries.delete(callSessionId);
    this.#setCallTurnState(callSessionId, { phase: 'thinking', locked: true });
    const failSafe = setTimeout(() => {
      if (this.#callTurnControllers.get(callSessionId) !== controller || controller.signal.aborted) return;
      try { controller.abort('shell-generation-timeout'); } catch { controller.abort(); }
      this.#failCallTurn(callSessionId, 'บอทใช้เวลาตอบเกิน 30 วินาที', 'ลองตอบใหม่', () => this.#runCallReply(call, userCommit));
    }, 32000);
    try {
      const prepared = await this.#callBotReply.prepareReplyToCommittedUserTranscript({ scope: this.#scope, playerInstanceId: this.#player.instanceId, commit: userCommit, signal: controller.signal, timeoutMs: 30000 });
      if (controller.signal.aborted || this.#callTurnControllers.get(callSessionId) !== controller) return false;
      if (prepared?.status !== 'prepared') {
        const message = prepared?.reason === 'generation-timeout' ? 'บอทใช้เวลาตอบเกิน 30 วินาที' : prepared?.reason === 'invalid-structured-model-response' ? 'คำตอบจากโมเดลมาไม่ครบ' : 'สร้างคำตอบไม่สำเร็จ';
        this.#failCallTurn(callSessionId, message, 'ลองตอบใหม่', () => this.#runCallReply(call, userCommit)); return false;
      }
      return this.#runPreparedVoice(call, prepared, { controller, committed: null, startIndex: 0 });
    } catch (error) {
      if (controller.signal.aborted || this.#callTurnControllers.get(callSessionId) !== controller) return false;
      this.#failCallTurn(callSessionId, 'สร้างคำตอบไม่สำเร็จ', 'ลองตอบใหม่', () => this.#runCallReply(call, userCommit));
      return false;
    } finally { clearTimeout(failSafe); }
  }
  async #runPreparedVoice(call, prepared, { controller = null, committed = null, startIndex = 0 } = {}) {
    const callSessionId = call.callSessionId;
    const activeController = controller || new AbortController(); this.#callTurnControllers.set(callSessionId, activeController); this.#callTurnRetries.delete(callSessionId);
    this.#setCallTurnState(callSessionId, { phase: 'synthesizing', segmentIndex: startIndex, segmentCount: prepared.segments.length, locked: true });
    const result = await this.#callVoicePresenter.presentPreparedBotReply({
      scope: this.#scope,
      playerInstanceId: this.#player.instanceId,
      prepared,
      committed,
      startIndex,
      commit: () => this.#callBotReply.commitPreparedReply({ scope: this.#scope, prepared }),
      onUpdate: update => this.#setCallTurnState(callSessionId, { ...update, locked: true }),
    });
    if (activeController.signal.aborted || result?.status === 'cancelled') return false;
    if (result?.status === 'played') {
      this.#callTurnControllers.delete(callSessionId); this.#callTurnRetries.delete(callSessionId); this.#setCallTurnState(callSessionId, null); return true;
    }
    const failedIndex = Number.isSafeInteger(result?.failedIndex) ? result.failedIndex : startIndex;
    const partial = Boolean(result?.committed) || failedIndex > 0;
    this.#failCallTurn(callSessionId, partial ? 'สร้างเสียงส่วนที่เหลือไม่สำเร็จ' : 'สร้างเสียงไม่สำเร็จ', partial ? 'ลองส่วนที่เหลือใหม่' : 'ลองตอบใหม่', () => this.#runPreparedVoice(call, prepared, { committed: result?.committed || committed, startIndex: failedIndex }));
    return false;
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
  #setVoiceCaptions(enabled) { return this.#runSettingsMutation(() => this.#models.setVoiceCaptions({ scope: this.#scope, playerInstanceId: this.#player.instanceId, enabled })); }
  async #setVoiceLanguagePreference(language) { const changed = await this.#runSettingsMutation(() => this.#models.setVoiceLanguagePreference({ scope: this.#scope, playerInstanceId: this.#player.instanceId, language })); this.#callWarmKey = null; if (changed && this.#selectedCallSessionId) void this.#callVoicePresenter?.warmCall?.({ scope: this.#scope, playerInstanceId: this.#player.instanceId, callSessionId: this.#selectedCallSessionId }); return changed; }
  #setVoiceDefaultDelivery(delivery) { return this.#runSettingsMutation(() => this.#models.setVoiceDefaultDelivery({ scope: this.#scope, playerInstanceId: this.#player.instanceId, delivery })); }
  #bootstrapStageLabel(stage,state={}) { const labels={ 'discovering-cast':'กำลังทำความรู้จักตัวละคร…','quick-start':'กำลังจัดเรื่องช่วงล่าสุดให้พร้อมเล่น…','quick-ready':'มือถือพร้อมแล้ว • กำลังเติมประวัติเก่า…','deep-backfill':`กำลังอ่านเรื่องที่ผ่านมา ${state.processedOrdinal||0}/${state.totalMessages||0}…`,'ready':'มือถือพร้อมแล้ว ✨','failed':'แตะเพื่อลองอีกครั้ง' }; return labels[stage]||'กำลังเตรียมมือถือ…'; }
  async #runPlayableBootstrap() { if(this.#bootstrapBusy)return false;this.#bootstrapBusy=true;this.#lastSettingsError=null;await this.renderActive();try{await this.#models.runPlayableBootstrap({scope:this.#scope,playerInstanceId:this.#player.instanceId,onProgress:state=>{this.#bootstrapProgress=state;void this.renderActive();}});return true;}catch(error){this.#lastSettingsError=error instanceof Error?error.message:String(error);return false;}finally{this.#bootstrapBusy=false;this.#bootstrapProgress=null;await this.renderActive();} }
  async #setVoiceRuntimeBaseUrl(baseUrl) { this.#voiceRuntimeHealth = null; const changed = await this.#runSettingsMutation(() => this.#models.setVoiceRuntimeBaseUrl({ scope: this.#scope, playerInstanceId: this.#player.instanceId, baseUrl })); this.#callWarmKey = null; if (changed && this.#selectedCallSessionId) void this.#callVoicePresenter?.warmCall?.({ scope: this.#scope, playerInstanceId: this.#player.instanceId, callSessionId: this.#selectedCallSessionId }); return changed; }
  async #testVoiceRuntime() {
    if (this.#voiceRuntimeBusy) return false;
    this.#voiceRuntimeBusy = true; this.#voiceRuntimeHealth = null; await this.renderActive();
    try { this.#voiceRuntimeHealth = await this.#models.testVoiceRuntime({ scope: this.#scope, playerInstanceId: this.#player.instanceId }); if (this.#voiceRuntimeHealth?.ready) await this.#models.activateDetectedVoice({ scope: this.#scope, playerInstanceId: this.#player.instanceId, language: 'en' }); return this.#voiceRuntimeHealth?.ready === true; }
    catch (error) { this.#voiceRuntimeHealth = Object.freeze({ ok: false, ready: false, reason: 'runtime-check-failed', error: error instanceof Error ? error.message : String(error) }); return false; }
    finally { this.#voiceRuntimeBusy = false; await this.renderActive(); }
  }
  async #initializeDetectedVoice() {
    if (this.#voiceRuntimeBusy) return false;
    this.#voiceRuntimeBusy = true;
    try {
      this.#voiceRuntimeHealth = await this.#models.testVoiceRuntime({ scope: this.#scope, playerInstanceId: this.#player.instanceId });
      if (this.#voiceRuntimeHealth?.ready) await this.#models.activateDetectedVoice({ scope: this.#scope, playerInstanceId: this.#player.instanceId, language: 'en' });
      return this.#voiceRuntimeHealth?.ready === true;
    } catch (error) {
      this.#voiceRuntimeHealth = Object.freeze({ ok: false, ready: false, reason: 'runtime-check-failed', error: error instanceof Error ? error.message : String(error) });
      return false;
    } finally { this.#voiceRuntimeBusy = false; await this.renderActive(); }
  }
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
      if (/changed after|item changed|catalog.*changed/i.test(message)) { this.#shopStaleRecordId = item.recordId; this.#checkoutConfirmationRecordId = null; this.#lastCommerceError = 'สินค้ามีการเปลี่ยนแปลง กรุณารีเฟรชแล้วตรวจสอบอีกครั้ง'; }
      else if (/insufficient/i.test(message)) this.#lastCommerceError = 'ยอดเงินไม่เพียงพอ';
      else if (/balance is unavailable|cannot fabricate funds/i.test(message)) this.#lastCommerceError = 'ยังตรวจสอบยอดเงินสกุลนี้ไม่ได้';
      else if (/access|authorization|another Device|Account does not match|Unknown scoped/i.test(message)) this.#lastCommerceError = 'โทรศัพท์เครื่องนี้ยังล็อกอยู่';
      else this.#lastCommerceError = 'สั่งซื้อไม่สำเร็จ กรุณาลองอีกครั้ง';
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
  dispose() { try { this.#callVoicePresenter?.dispose?.(); } catch {} if (!this.#root) return; if (this.#homePagerTimer != null) { clearTimeout(this.#homePagerTimer); this.#homePagerTimer = null; } this.#controller.close({ scope: this.#scope, deviceId: this.#selectedDeviceId }); this.#root.remove(); this.#root = null; }
}
