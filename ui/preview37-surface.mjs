import { createPreviewIcon } from './app-icons.mjs';

const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const appendIcon = (document, node, name, size) => { node.append(createPreviewIcon({ document, name, size })); return node; };
export const previewClock = () => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
export const previewDate = () => new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

export function createPreviewAvatar({ document, label = '?', size = 'md', imageUrl = null }) {
  const avatar = el(document, 'span'); avatar.className = `tmrw-phone-avatar tmrw-phone-avatar--${size}`;
  const initials = String(label || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
  avatar.append(el(document, 'b', initials));
  if (imageUrl) { const image = el(document, 'img'); image.src = imageUrl; image.alt = ''; image.addEventListener?.('error', () => image.remove?.(), { once: true }); avatar.append(image); }
  return avatar;
}

export function createPreviewStatusBar({ document }) {
  const status = el(document, 'div'); status.className = 'tmrw-phone-status';
  const time = el(document, 'strong', previewClock()); time.className = 'tmrw-phone-live-time';
  const system = el(document, 'div'); const signal = el(document, 'span'); signal.className = 'tmrw-phone-signal';
  for (let i = 0; i < 4; i += 1) signal.append(el(document, 'i'));
  system.append(signal, el(document, 'span', '◔')); const battery = el(document, 'span', '81'); battery.className = 'tmrw-phone-battery'; system.append(battery); status.append(time, system); return status;
}

export function createPreviewRootChrome({ document, onClose }) {
  const root = el(document, 'div'); root.id = 'tmrw-phone-root'; root.className = 'tmrw-v3-shell is-open'; root.setAttribute('aria-hidden', 'false');
  const backdrop = el(document, 'div'); backdrop.className = 'tmrw-phone-backdrop'; backdrop.dataset.action = 'close-phone'; backdrop.addEventListener('click', () => onClose?.());
  const device = el(document, 'section'); device.className = 'tmrw-phone-device'; device.setAttribute('role', 'dialog'); device.setAttribute('aria-modal', 'true'); device.setAttribute('aria-label', 'TMRW Phone'); device.tabIndex = -1;
  const screen = el(document, 'div'); screen.id = 'tmrw-phone-screen'; screen.className = 'tmrw-phone-screen';
  const sheet = el(document, 'div'); sheet.id = 'tmrw-phone-sheet-layer'; sheet.setAttribute('aria-live', 'polite');
  const toast = el(document, 'div'); toast.id = 'tmrw-phone-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
  device.append(screen, sheet, toast); root.append(backdrop, device); return Object.freeze({ root, device, screen, sheet, toast });
}

function ownerButton({ document, ownerLabel, ownerAvatarUrl = null, onOwner, lock = false }) {
  const button = el(document, 'button'); button.type = 'button'; button.className = lock ? 'tmrw-phone-lock-owner' : 'tmrw-phone-owner-pill'; button.dataset.action = 'owner-sheet'; button.addEventListener('click', () => onOwner?.());
  button.append(createPreviewAvatar({ document, label: ownerLabel, size: 'sm', imageUrl: ownerAvatarUrl }));
  const copy = el(document, 'span'); copy.append(el(document, 'small', 'โทรศัพท์ของ'), el(document, 'strong', ownerLabel)); button.append(copy);
  if (lock) { const icon = el(document, 'i'); appendIcon(document, icon, 'lock', 15); button.append(icon); }
  else button.append(createPreviewIcon({ document, name: 'chevron', size: 16 }));
  return button;
}

function musicCard({ document, lock = false }) {
  const section = el(document, 'section'); section.className = lock ? 'tmrw-phone-lock-music' : 'tmrw-phone-music-card';
  const album = el(document, 'div'); album.className = lock ? 'tmrw-phone-lock-album' : 'tmrw-phone-album'; appendIcon(document, album, 'music', lock ? 25 : 27);
  const copy = el(document, 'div'); if (!lock) copy.className = 'tmrw-phone-music-copy'; copy.append(el(document, 'small', 'NOW PLAYING'), el(document, 'strong', 'ยังไม่มีเพลงที่กำลังเล่น'), el(document, 'span', '—'));
  const progress = el(document, 'i'); progress.append(el(document, 'b')); copy.append(progress);
  const play = el(document, 'button'); play.type = 'button'; play.disabled = true; play.setAttribute('aria-label', 'ไม่มีเพลงที่พร้อมเล่น'); appendIcon(document, play, 'play', lock ? 21 : 24);
  section.append(album, copy, play); return section;
}

export function createPreviewLockScreen({ document, ownerLabel, ownerAvatarUrl = null, overview, onOwner, onUnlock, onTarget, onClose }) {
  const root = el(document, 'div'); root.className = 'tmrw-phone-lock'; root.dataset.role = 'lock-screen'; root.append(createPreviewStatusBar({ document }));
  const content = el(document, 'div'); content.className = 'tmrw-phone-lock-content'; content.dataset.role = 'lock-content'; content.append(ownerButton({ document, ownerLabel, ownerAvatarUrl, onOwner, lock: true }));
  const clock = el(document, 'section'); clock.className = 'tmrw-phone-lock-clock'; const time = el(document, 'div', previewClock()); time.className = 'tmrw-phone-lock-time tmrw-phone-live-time'; const date = el(document, 'div', previewDate()); date.className = 'tmrw-phone-lock-date tmrw-phone-live-date'; clock.append(time, date); content.append(clock, musicCard({ document, lock: true }));
  const notifications = el(document, 'section'); notifications.className = 'tmrw-phone-lock-notifications'; notifications.setAttribute('aria-label', 'การแจ้งเตือน');
  for (const item of overview.lockNotifications || []) {
    const button = el(document, 'button'); button.type = 'button'; button.className = 'tmrw-phone-lock-notification'; button.dataset.target = item.target || 'notifications'; button.dataset.action = 'unlock-target';
    const icon = el(document, 'i'); appendIcon(document, icon, item.icon || 'message', 19); const copy = el(document, 'span'); const meta = el(document, 'small', item.app || 'TMRW Phone'); meta.append(el(document, 'b', item.time || 'ล่าสุด')); copy.append(meta, el(document, 'strong', item.title || 'ไม่มีรายการใหม่'), el(document, 'em', item.body || '')); button.append(icon, copy, createPreviewIcon({ document, name: 'chevron', size: 15 })); button.addEventListener('click', () => onTarget?.(button.dataset.target)); notifications.append(button);
  }
  if ((overview.lockNotifications || []).length === 0) { const empty = el(document, 'div'); empty.className = 'tmrw-phone-lock-notification tmrw-phone-lock-notification--empty'; const icon = el(document, 'i'); appendIcon(document, icon, 'notifications', 19); const copy = el(document, 'span'); copy.append(el(document, 'small', 'TMRW Phone'), el(document, 'strong', 'ไม่มีการแจ้งเตือน'), el(document, 'em', 'เมื่อมีรายการใหม่จะแสดงที่นี่')); empty.append(icon, copy, createPreviewIcon({ document, name: 'chevron', size: 15 })); notifications.append(empty); }
  content.append(notifications);
  const footer = el(document, 'footer'); footer.className = 'tmrw-phone-lock-footer'; const flashlight = el(document, 'button'); flashlight.type = 'button'; flashlight.disabled = true; flashlight.setAttribute('aria-label', 'ไฟฉายยังไม่พร้อมใช้งาน'); appendIcon(document, flashlight, 'flashlight', 22);
  const unlock = el(document, 'button'); unlock.type = 'button'; unlock.className = 'tmrw-phone-swipe-hint'; unlock.dataset.action = 'unlock'; unlock.setAttribute('aria-label', 'ปัดขึ้นเพื่อเปิด'); const chevron = el(document, 'span'); appendIcon(document, chevron, 'chevron', 16); unlock.append(chevron, el(document, 'b', 'ปัดขึ้นเพื่อเปิด')); unlock.addEventListener('click', () => onUnlock?.('home'));
  const camera = el(document, 'button'); camera.type = 'button'; camera.disabled = true; camera.setAttribute('aria-label', 'กล้องยังไม่พร้อมใช้งาน'); appendIcon(document, camera, 'camera', 22); footer.append(flashlight, unlock, camera); content.append(footer); root.append(content);
  const close = el(document, 'button'); close.type = 'button'; close.className = 'tmrw-phone-lock-close'; close.dataset.action = 'close-phone'; close.setAttribute('aria-label', 'ปิด'); appendIcon(document, close, 'close', 19); close.addEventListener('click', () => onClose?.()); root.append(close); const indicator = el(document, 'div'); indicator.className = 'tmrw-phone-home-indicator'; root.append(indicator);
  let gesture = null; root.addEventListener('pointerdown', event => { if (event.target?.closest?.('button')) return; gesture = { id: event.pointerId, startY: event.clientY, delta: 0 }; content.classList?.add?.('is-dragging'); }); root.addEventListener('pointermove', event => { if (!gesture || gesture.id !== event.pointerId) return; gesture.delta = Math.min(0, event.clientY - gesture.startY); const distance = Math.max(-150, gesture.delta); if (content.style) { content.style.transform = `translateY(${distance}px)`; content.style.opacity = String(Math.max(.25, 1 - Math.abs(distance) / 190)); } }); const finish = event => { if (!gesture) return; const shouldUnlock = gesture.delta < -72; gesture = null; content.classList?.remove?.('is-dragging'); if (shouldUnlock) onUnlock?.('home'); else if (content.style) { content.style.transform = ''; content.style.opacity = ''; } }; root.addEventListener('pointerup', finish); root.addEventListener('pointercancel', finish);
  return root;
}

const PRIMARY_APPS = Object.freeze([['insungram','Insungram','message','messages'],['maps','Maps','location'],['shop','ร้านค้า','bag'],['wallet','กระเป๋าเงิน','wallet'],['calls','Calls','phone'],['notes','Notes','notes']]);
const SECONDARY_APPS = Object.freeze([['gallery','Gallery','gallery'],['themes','Themes','palette','theme'],['calendar','Calendar','calendar'],['weather','Weather','cloud'],['health','Health','health'],['files','Files','files']]);
function appButton({ document, tuple, onApp }) { const [app,label,iconName,route = app] = tuple; const button = el(document, 'button'); button.type = 'button'; button.className = 'tmrw-phone-app'; button.dataset.action = 'open-app'; button.dataset.app = app; const iconWrap = el(document, 'span'); iconWrap.append(createPreviewIcon({ document, name: iconName, size: 25 })); button.append(iconWrap, el(document, 'b', label)); button.addEventListener('click', () => onApp?.(route)); return button; }

export function createPreviewHome({ document, ownerLabel, ownerAvatarUrl = null, overview, homePage = 0, onOwner, onApp, onPage, onDock, onLock }) {
  const root = el(document, 'div'); root.className = 'tmrw-phone-home'; root.append(createPreviewStatusBar({ document }));
  const pager = el(document, 'div'); pager.className = 'tmrw-phone-app-pages tmrw-phone-full-home-pages'; pager.dataset.role = 'home-pages';
  const main = el(document, 'section'); main.className = 'tmrw-phone-app-page tmrw-phone-home-panel tmrw-phone-home-panel--main'; main.dataset.page = '0'; main.append(ownerButton({ document, ownerLabel, ownerAvatarUrl, onOwner }));
  const clock = el(document, 'section'); clock.className = 'tmrw-phone-clock-block'; const time = el(document, 'div', previewClock()); time.className = 'tmrw-phone-home-time tmrw-phone-live-time'; const date = el(document, 'div', previewDate()); date.className = 'tmrw-phone-home-date'; clock.append(time, date, el(document, 'p', overview.status || 'พร้อมใช้งาน')); main.append(clock, musicCard({ document }));
  const primary = el(document, 'div'); primary.className = 'tmrw-phone-app-grid tmrw-phone-primary-grid'; for (const tuple of PRIMARY_APPS) primary.append(appButton({ document, tuple, badges: overview.badges, onApp })); main.append(primary);
  const note = el(document, 'div'); note.className = 'tmrw-phone-home-note'; note.append(el(document, 'span', 'NOTE'), el(document, 'p', overview.noteText || 'ยังไม่มีโน้ต')); main.append(note);
  const widgets = el(document, 'section'); widgets.className = 'tmrw-phone-app-page tmrw-phone-home-panel tmrw-phone-home-panel--widgets'; widgets.dataset.page = '1';
  const row = el(document, 'div'); row.className = 'tmrw-phone-widget-row'; const greeting = el(document, 'article'); greeting.className = 'tmrw-phone-mini-widget tmrw-phone-greeting-widget'; greeting.append(el(document, 'small', 'GOOD MORNING,'), el(document, 'strong', `${String(ownerLabel || '').split(' ')[0] || 'เจ้าของเครื่อง'} ☼`), el(document, 'p', overview.status || 'พร้อมใช้งาน'), el(document, 'span', 'TMRW Phone'));
  const steps = el(document, 'article'); steps.className = 'tmrw-phone-mini-widget tmrw-phone-steps-widget'; steps.append(el(document, 'small', 'STEPS'), el(document, 'strong', overview.steps == null ? '—' : Number(overview.steps).toLocaleString())); const bars = el(document, 'div'); for (let i=0;i<7;i+=1) bars.append(el(document,'i')); steps.append(bars, el(document, 'span', overview.steps == null ? 'NO DATA' : 'TODAY')); row.append(greeting, steps); widgets.append(row);
  const secondary = el(document, 'div'); secondary.className = 'tmrw-phone-app-grid tmrw-phone-secondary-grid'; for (const tuple of SECONDARY_APPS) secondary.append(appButton({ document, tuple, badges: overview.badges, onApp })); widgets.append(secondary);
  const focus = el(document, 'button'); focus.type = 'button'; focus.disabled = true; focus.className = 'tmrw-phone-focus-widget'; const spark = el(document,'span'); appendIcon(document,spark,'sparkle',19); const fcopy=el(document,'div'); fcopy.append(el(document,'small','FOCUS'),el(document,'strong','ยังไม่มี Focus session')); focus.append(spark,fcopy,el(document,'b','— min')); const play=el(document,'i'); appendIcon(document,play,'play',17); focus.append(play); widgets.append(focus); pager.append(main, widgets); root.append(pager);
  const dots = el(document, 'div'); dots.className = 'tmrw-phone-page-dots'; [0,1].forEach(index => { const dot=el(document,'button'); dot.type='button'; const active=homePage === index; dot.className = active ? 'is-active' : ''; dot.dataset.action='home-page'; dot.dataset.page=String(index); dot.setAttribute('aria-label',`หน้าโฮม ${index+1}`); dot.setAttribute('aria-current',String(active)); dot.addEventListener('click',()=>onPage?.(index,pager)); dots.append(dot); }); root.append(dots);
  const dock = el(document, 'div'); dock.className = 'tmrw-phone-dock';
  const castButton=el(document,'button');castButton.type='button';castButton.dataset.action='cast-manager';castButton.setAttribute('aria-label','Manage Cast');appendIcon(document,castButton,'user',23);castButton.addEventListener('click',()=>onDock?.('owner'));dock.append(castButton);
  for (const [route,label,name] of [['calls','Calls','phone'],['search','ประวัติการค้นหา','globe'],['settings','ตั้งค่า','settings']]) { const button=el(document,'button');button.type='button';button.dataset.action='open-app';button.dataset.app=route;button.setAttribute('aria-label',label);appendIcon(document,button,name,23);button.addEventListener('click',()=>onDock?.(route));dock.append(button); }
  root.append(dock);
  const lock = el(document,'button'); lock.type='button'; lock.className='tmrw-phone-close-button tmrw-phone-home-lock-button'; lock.dataset.action='lock-phone'; lock.setAttribute('aria-label','ล็อกหน้าจอ'); appendIcon(document,lock,'lock',18); lock.addEventListener('click',()=>onLock?.()); root.append(lock); const indicator=el(document,'div'); indicator.className='tmrw-phone-home-indicator'; root.append(indicator);
  const initialPage=Math.max(0,Math.min(1,Number(homePage)||0)); const sync = () => { const measured=Number(pager.clientWidth||0); const page=measured>0?Math.max(0,Math.min(1,Math.round(Number(pager.scrollLeft||0)/measured))):initialPage; for (const dot of dots.children||[]) { const active=Number(dot.dataset?.page)===page; dot.className=active?'is-active':''; dot.setAttribute('aria-current',String(active)); } onPage?.(page,null); }; let timer=null; pager.addEventListener('scroll',()=>{ if(timer) clearTimeout(timer); timer=setTimeout(sync,70); }); const restore=()=>{const width=Number(pager.clientWidth||0);if(width>0&&pager.scrollLeft!==undefined){const prior=pager.style.scrollBehavior;pager.style.scrollBehavior='auto';pager.scrollLeft=initialPage*width;pager.style.scrollBehavior=prior;}sync();}; restore(); if(typeof globalThis.requestAnimationFrame==='function')globalThis.requestAnimationFrame(restore);else timer=setTimeout(restore,0); return root;
}

export function createPreviewOwnerSheet({ document, cardLabel = 'TMRW Phone', devices, onSelect, onClose }) {
  const backdrop = el(document,'div'); backdrop.className='tmrw-phone-sheet-backdrop'; backdrop.dataset.action='close-sheet'; backdrop.addEventListener('click',()=>onClose?.());
  const sheet=el(document,'section'); sheet.className='tmrw-phone-sheet'; sheet.append(el(document,'i'));
  const header=el(document,'header'); const copy=el(document,'div'); copy.append(el(document,'small',cardLabel),el(document,'h2','เลือกเจ้าของเครื่อง')); const close=el(document,'button');close.type='button';appendIcon(document,close,'close',20);close.addEventListener('click',()=>onClose?.());header.append(copy,close);sheet.append(header);
  const list=el(document,'div');
  for(const item of devices){ const button=el(document,'button');button.type='button';button.className=item.selected?'is-selected':'';button.dataset.deviceId=item.deviceId;button.dataset.kind=item.kind;button.setAttribute('aria-pressed',String(Boolean(item.selected)));button.setAttribute('aria-label',item.kind==='my-phone'?'My Phone':`Their Phone: ${item.label}`);button.append(createPreviewAvatar({document,label:item.label,size:'md',imageUrl:item.avatarUrl||null}));const text=el(document,'span');text.append(el(document,'strong',item.label),el(document,'small',item.kind==='my-phone'?'My Phone':'Their Phone'));button.append(text,item.selected?el(document,'b','✓'):createPreviewIcon({document,name:'chevron',size:17}));button.addEventListener('click',()=>onSelect?.(item.deviceId));list.append(button);}
  sheet.append(list); return Object.freeze({ backdrop, sheet });
}

export function createPreviewBackHeader({ document, title = '', subtitle = '', onBack, kind = 'utility' }) {
  if (kind === 'social') { const header=el(document,'header');header.className='tmrw-phone-social-header';const back=el(document,'button');back.type='button';appendIcon(document,back,'back',23);back.addEventListener('click',()=>onBack?.());const t=el(document,'button');t.type='button';t.className='tmrw-phone-social-title';t.append(el(document,'strong',title));const more=el(document,'button');more.type='button';more.disabled=true;appendIcon(document,more,'more',24);header.append(back,t,more);return header; }
  if (kind === 'personal') { const header=el(document,'header');header.className='tmrw-phone-personal-header';const back=el(document,'button');back.type='button';back.setAttribute('aria-label','ย้อนกลับ');appendIcon(document,back,'back',24);back.addEventListener('click',()=>onBack?.());const more=el(document,'button');more.type='button';more.disabled=true;appendIcon(document,more,'more',23);header.append(back,more);return header; }
  if (kind === 'commerce') { const header=el(document,'header');header.className='tmrw-phone-commerce-header';const back=el(document,'button');back.type='button';appendIcon(document,back,'back',22);back.addEventListener('click',()=>onBack?.());header.append(back,el(document,'span'));const more=el(document,'button');more.type='button';more.disabled=true;appendIcon(document,more,'more',22);header.append(more);return header; }
  if (kind === 'lifestyle') { const header=el(document,'header');header.className='tmrw-phone-lifestyle-header';const back=el(document,'button');back.type='button';back.setAttribute('aria-label','ย้อนกลับ');appendIcon(document,back,'back',23);back.addEventListener('click',()=>onBack?.());const copy=el(document,'span');copy.className='tmrw-phone-lifestyle-title';copy.append(el(document,'strong',title));header.append(back,copy,el(document,'div'));return header; }
  const header=el(document,'header');const back=el(document,'button');back.type='button';appendIcon(document,back,'back',23);back.addEventListener('click',()=>onBack?.());const copy=el(document,'div');copy.append(el(document,'small','TMRW Phone'),el(document,'strong',title));const more=el(document,'button');more.type='button';more.disabled=true;appendIcon(document,more,'more',23);header.append(back,copy,more);return header;
}

export function createPreviewCommerceNav({ document, active, onNavigate }) {
  const nav=el(document,'nav');nav.className='tmrw-phone-commerce-nav';nav.setAttribute('aria-label','แถบนำทาง');
  const item=(route,label,name,{activeWhen=null}={})=>{const button=el(document,'button');button.type='button';if(activeWhen===active)button.className='is-active';const mark=el(document,'i');mark.append(createPreviewIcon({document,name,size:21}));button.append(mark,el(document,'span',label));button.addEventListener('click',()=>onNavigate?.(route));nav.append(button);};
  item('messages','ข้อความ','message');item('launcher','หน้าแรก','home');item('shop','ร้านค้า','bag',{activeWhen:'shop'});item('wallet','กระเป๋า','wallet',{activeWhen:'wallet'});return nav;
}

export function createPreviewLifestyleNav({ document, app, tabs, active, onTab }) {
  const nav=el(document,'nav');nav.className='tmrw-phone-lifestyle-nav';
  for(const [id,label,name] of tabs){const button=el(document,'button');button.type='button';button.dataset.action=`${app}-tab`;button.dataset.tab=id;if(active===id)button.className='is-active';const mark=el(document,'i');mark.append(createPreviewIcon({document,name,size:20}));button.append(mark,el(document,'span',label));button.addEventListener('click',()=>onTab?.(id));nav.append(button);}return nav;
}

export function wrapPreviewApp({ document, kind, app, title, subtitle, body, onBack, bottom = null, ownerLabel = '' }) {
  const presentationApp = app === 'theme' ? 'themes' : app;
  const className = kind === 'social' ? 'tmrw-phone-social-shell' : kind === 'commerce' ? `tmrw-phone-utility tmrw-phone-commerce tmrw-phone-commerce--${presentationApp}` : kind === 'lifestyle' ? `tmrw-phone-utility tmrw-phone-lifestyle tmrw-phone-lifestyle--${presentationApp}${bottom?' has-nav':''}` : kind === 'personal' ? `tmrw-phone-utility tmrw-phone-utility--${presentationApp} tmrw-phone-personal-shell` : `tmrw-phone-utility tmrw-phone-utility--${presentationApp}`;
  const root=el(document,'div'); root.className=className; root.append(createPreviewStatusBar({document}),createPreviewBackHeader({document,title,subtitle,onBack,kind}));
  const main=el(document,'main');
  if(kind==='personal'){
    const heading=el(document,'div'); heading.className='tmrw-phone-personal-title'; const p=el(document,'p',subtitle||''); p.append(el(document,'span','✦')); heading.append(el(document,'h1',title),p); main.append(heading);
  } else if(kind==='commerce'){
    const heading=el(document,'section'); heading.className='tmrw-phone-commerce-title'; const p=el(document,'p',subtitle||''); p.append(el(document,'b','✦')); heading.append(el(document,'h1',title),p); main.append(heading);
  } else if(kind==='utility'){
    const iconByApp={gallery:'gallery',files:'files',themes:'palette',guide:'sparkle',settings:'settings',diagnostics:'settings'};
    const hero=el(document,'div'); hero.className='tmrw-phone-utility-hero'; hero.append(createPreviewIcon({document,name:iconByApp[presentationApp]||'phone',size:34}),el(document,'h2',subtitle||title),el(document,'p',ownerLabel ? `ข้อมูลของ ${ownerLabel}` : 'TMRW Phone')); main.append(hero);
  }
  main.append(body); root.append(main); if(bottom) root.append(bottom); const indicator=el(document,'div'); indicator.className='tmrw-phone-home-indicator'; root.append(indicator); return root;
}
