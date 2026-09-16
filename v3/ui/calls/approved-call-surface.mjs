const el = (document, tag, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const initials = label => String(label || '?').trim().slice(0, 1).toUpperCase() || '?';

function loadingWave(document, text) {
  const wave = el(document, 'div', 'tmrw-call-authority-loading-wave');
  wave.setAttribute('role', 'status'); wave.setAttribute('aria-label', text);
  const graphemes = typeof Intl?.Segmenter === 'function'
    ? [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(text)].map(row => row.segment)
    : Array.from(text);
  graphemes.forEach((grapheme, index) => { const span = el(document, 'span', '', grapheme); span.setAttribute('aria-hidden', 'true'); span.setAttribute('style', `--tmrw-wave-index:${index}`); wave.append(span); });
  return wave;
}

const SVG = Object.freeze({
  phone: '<path d="M3 5.5C3 4.7 3.7 4 4.5 4h3.3c.7 0 1.3.5 1.5 1.1l1.1 3.2c.2.6 0 1.3-.5 1.7l-1.7 1.3c1.1 2.3 2.9 4.2 5.2 5.3l1.3-1.7c.4-.5 1.1-.7 1.7-.5l3.2 1.1c.6.2 1.1.8 1.1 1.5v3.3c0 .8-.7 1.5-1.5 1.5C10.3 21.5 3.3 14.5 3 5.5Z" fill="currentColor"/>',
  send: '<path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>',
  speaker: '<path d="M5 10v4h3l4 3V7l-4 3H5Z" fill="currentColor"/><path d="M15 9.2c1.8 1.5 1.8 4.1 0 5.6M17.5 7c3 2.7 3 7.3 0 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  mute: '<path d="M9 5.5a3 3 0 0 1 6 0V12c0 .4-.1.8-.26 1.23M7 11.5v.5a5 5 0 0 0 8.45 3.62M12 17v3M9 20h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  more: '<circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/>',
  minimize: '<path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2L12 2Z" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
});

function icon(document, name, size = 24) {
  const span = el(document, 'span', 'tmrw-call-authority-icon');
  span.setAttribute?.('aria-hidden', 'true');
  const markup = SVG[name] || SVG.more;
  if ('innerHTML' in span) span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${markup}</svg>`;
  else span.textContent = name === 'phone' ? '☎' : name === 'send' ? '→' : name === 'close' ? '×' : '•';
  return span;
}

function bindOneShot(button, handler) {
  let busy = false;
  button.addEventListener('click', () => {
    if (busy || button.disabled) return;
    busy = true;
    button.disabled = true;
    void Promise.resolve().then(handler).catch(() => {}).finally(() => { busy = false; });
  });
}

function actionButton(document, { action, label, className = '', enabled = true, glyph = 'phone', onAction }) {
  const column = el(document, 'div', 'tmrw-call-authority-action-col');
  const button = el(document, 'button', `tmrw-call-authority-action-btn ${className}`.trim());
  button.type = 'button';
  button.dataset.callAction = action;
  button.setAttribute('aria-label', label);
  button.disabled = !enabled;
  button.append(icon(document, glyph, action === 'accept' || ['decline', 'cancel', 'end'].includes(action) ? 28 : 23));
  if (['decline', 'cancel', 'end'].includes(action)) button.firstChild?.querySelector?.('svg')?.setAttribute?.('style', 'transform:rotate(135deg)');
  bindOneShot(button, () => onAction?.(action));
  column.append(button, el(document, 'span', 'tmrw-call-authority-action-label', label));
  return column;
}

function statusBar(document) {
  const bar = el(document, 'div', 'tmrw-call-authority-statusbar');
  bar.append(el(document, 'span', '', ''), el(document, 'div', 'tmrw-call-authority-system', ''));
  bar.children?.[1]?.append?.(el(document, 'i'), el(document, 'i'), el(document, 'i'));
  return bar;
}

function portrait(document, counterpartLabel, { pulse = false, avatarUrl = null } = {}) {
  const wrap = el(document, 'div', 'tmrw-call-authority-portrait-wrap');
  if (pulse) {
    for (let index = 1; index <= 3; index += 1) wrap.append(el(document, 'div', `tmrw-call-authority-pulse-ring r${index}`));
  } else wrap.append(el(document, 'div', 'tmrw-call-authority-portrait-aura'));
  const ring = el(document, 'div', 'tmrw-call-authority-portrait-ring');
  const avatar = el(document, 'div', 'tmrw-call-authority-avatar', initials(counterpartLabel));
  avatar.setAttribute('aria-label', `${counterpartLabel || 'Call participant'} avatar`);
  if (avatarUrl) { const image = el(document, 'img', 'tmrw-call-authority-avatar-image'); image.src = avatarUrl; image.alt = ''; image.addEventListener?.('error', () => image.remove?.(), { once: true }); avatar.append(image); }
  ring.append(avatar); wrap.append(ring);
  return wrap;
}

function header(document, island) {
  const box = el(document, 'div', 'tmrw-call-authority-header');
  const label = island.kind === 'incoming' ? 'สายเรียกเข้า' : island.kind === 'outgoing' ? 'สายโทรออก' : island.kind === 'ended' ? 'สิ้นสุดการโทร' : '';
  if (label) box.append(el(document, 'div', 'tmrw-call-authority-caller-label', label));
  box.append(el(document, 'div', 'tmrw-call-authority-caller-name', island.counterpartLabel || 'Unknown'));
  const status = el(document, 'div', 'tmrw-call-authority-call-status');
  const dot = el(document, 'span', island.kind === 'active' ? 'tmrw-call-authority-connected-dot' : island.kind === 'ended' ? 'tmrw-call-authority-ended-dot' : 'tmrw-call-authority-ring-dot');
  const state = island.kind === 'incoming' ? 'กำลังโทรเข้า…' : island.kind === 'outgoing' ? 'กำลังโทรออก…' : island.kind === 'active' ? (Number.isSafeInteger(island.canonicalDurationMs) ? `เชื่อมต่อแล้ว • ${island.durationLabel}` : 'เชื่อมต่อแล้ว') : (island.durationLabel || island.title || 'วางสายแล้ว');
  status.append(dot, el(document, 'span', '', state)); box.append(status);
  return box;
}

function renderRinging({ document, root, island, inspectionOnly, onAction, avatarUrl }) {
  root.append(header(document, island), portrait(document, island.counterpartLabel, { pulse: true, avatarUrl }));
  const hint = island.kind === 'incoming' ? 'สายเรียกเข้าพร้อมรับเมื่อคุณต้องการ' : `กำลังรอ ${island.counterpartLabel || 'อีกฝ่าย'} รับสาย…`;
  root.append(el(document, 'div', 'tmrw-call-authority-hint', inspectionOnly ? 'ดูสถานะสายนี้ได้ แต่โทรศัพท์เครื่องนี้ไม่ได้อยู่ในการควบคุมของคุณ' : hint));
  const actions = el(document, 'div', `tmrw-call-authority-actions ${island.kind === 'outgoing' ? 'single' : ''}`);
  if (island.kind === 'incoming') {
    actions.append(
      actionButton(document, { action: 'decline', label: 'ปฏิเสธ', className: 'decline', enabled: !inspectionOnly && Boolean(island.actions?.find(item => item.id === 'decline')?.enabled), glyph: 'phone', onAction }),
      actionButton(document, { action: 'accept', label: 'รับสาย', className: 'accept', enabled: !inspectionOnly && Boolean(island.actions?.find(item => item.id === 'accept')?.enabled), glyph: 'phone', onAction }),
    );
  } else {
    actions.append(actionButton(document, { action: 'cancel', label: 'วางสาย', className: 'decline', enabled: !inspectionOnly && Boolean(island.actions?.find(item => item.id === 'cancel')?.enabled), glyph: 'phone', onAction }));
  }
  root.append(actions);
}

function renderActive({ document, root, island, inspectionOnly, onAction, onSend, onNavigate, turnState = null, captionsVisible = true, onToggleCaptions = null, onRetry = null, avatarUrl = null }) {
  const top = el(document, 'div', 'tmrw-call-authority-top-actions');
  const minimize = el(document, 'button', 'tmrw-call-authority-icon-btn'); minimize.type = 'button'; minimize.dataset.callAction = 'minimize'; minimize.setAttribute('aria-label', 'ย่อสาย'); minimize.append(icon(document, 'minimize', 18));
  const more = el(document, 'button', 'tmrw-call-authority-icon-btn'); more.type = 'button'; more.dataset.callAction = 'menu'; more.setAttribute('aria-label', 'เมนูเพิ่มเติม'); more.append(icon(document, 'more', 20));
  top.append(minimize, more); root.append(top, header(document, island), portrait(document, island.counterpartLabel, { avatarUrl }));

  const latest = (island.transcript || []).at(-1) || null;
  const stage = el(document, 'div', 'tmrw-call-authority-turn-stage');
  if (turnState?.phase && turnState.phase !== 'completed') {
    const latestIsCaller = latest && latest.speakerAccountId !== island.counterpartAccountId;
    if (latestIsCaller) stage.append(el(document, 'div', 'tmrw-call-authority-user-message-bubble', latest.text));
    const card = el(document, 'div', `tmrw-call-authority-subtitle-card tmrw-call-authority-turn-${turnState.phase}`);
    const statusText = turnState.phase === 'thinking' ? 'กำลังคิด…' : turnState.phase === 'synthesizing' ? 'กำลังเตรียมเสียง…' : turnState.phase === 'retrying-voice' ? 'กำลังเตรียมเสียงอีกครั้ง…' : turnState.phase === 'speaking' ? (captionsVisible ? turnState.subtitleThai : '') : (turnState.message || 'ตอบไม่สำเร็จ');
    if (['thinking', 'synthesizing', 'retrying-voice'].includes(turnState.phase)) card.append(loadingWave(document, statusText));
    else card.append(el(document, 'div', 'tmrw-call-authority-subtitle-text', statusText));
    if (turnState.phase === 'failed' && typeof onRetry === 'function') { const retry = el(document, 'button', 'tmrw-call-authority-retry', turnState.retryLabel || 'ลองตอบใหม่'); retry.type = 'button'; retry.dataset.callAction = 'retry-reply'; bindOneShot(retry, onRetry); card.append(retry); }
    stage.append(card);
  } else if (latest) {
    const fromCounterpart = latest.speakerAccountId === island.counterpartAccountId;
    const card = el(document, 'div', fromCounterpart ? 'tmrw-call-authority-subtitle-card' : 'tmrw-call-authority-user-message-bubble');
    if (fromCounterpart && captionsVisible) card.append(el(document, 'span', 'tmrw-call-authority-quote left', '“'), el(document, 'div', 'tmrw-call-authority-subtitle-text', latest.text), el(document, 'span', 'tmrw-call-authority-quote right', '“'));
    else if (fromCounterpart) card.append(el(document, 'div', 'tmrw-call-authority-subtitle-text tmrw-call-authority-subtitle-empty', ''));
    else card.append(el(document, 'span', 'tmrw-call-authority-user-message-text', latest.text));
    stage.append(card);
  } else stage.append(el(document, 'div', 'tmrw-call-authority-subtitle-card tmrw-call-authority-subtitle-empty', ''));
  root.append(stage);

  const turnLocked = Boolean(turnState?.locked);
  const composerLocked = inspectionOnly || turnLocked;
  const composerWrap = el(document, 'div', 'tmrw-call-authority-composer-wrap'); const composer = el(document, 'div', `tmrw-call-authority-composer ${composerLocked ? 'locked' : ''}`);
  if (composerLocked) composer.append(el(document, 'span', 'tmrw-call-authority-lock-icon', '🔒'));
  const input = el(document, 'input', 'tmrw-call-authority-input'); input.type = 'text'; input.setAttribute('aria-label', 'Call text'); input.placeholder = turnLocked ? 'รอให้อีกฝ่ายพูดจบ…' : 'พิมพ์ข้อความ...'; input.disabled = composerLocked;
  const send = el(document, 'button', 'tmrw-call-authority-send'); send.type = 'button'; send.dataset.callAction = 'send-text'; send.setAttribute('aria-label', 'ส่ง'); send.append(icon(document, 'send', 18));
  const syncSend = () => { send.disabled = composerLocked || !String(input.value || '').trim(); }; input.addEventListener('input', syncSend); syncSend();
  let sendBusy = false; send.addEventListener('click', () => { if (sendBusy || send.disabled) return; sendBusy = true; send.disabled = true; input.blur?.(); void Promise.resolve(onSend?.(input)).catch(() => {}).finally(() => { sendBusy = false; syncSend(); }); });
  composer.append(input, send); composerWrap.append(composer); root.append(composerWrap);

  const controls = el(document, 'div', 'tmrw-call-authority-controls');
  const speaker = actionButton(document, { action: 'speaker', label: 'ลำโพง', enabled: false, glyph: 'speaker' }); const speakerButton = speaker.children?.[0]; if (speakerButton) { speakerButton.title = 'Voice controls are unavailable in text-only mode'; speakerButton.dataset.presentationState = 'unavailable'; }
  const end = actionButton(document, { action: 'end', label: 'วางสาย', className: 'end', enabled: !inspectionOnly && Boolean(island.actions?.find(item => item.id === 'end')?.enabled), glyph: 'phone', onAction });
  const mute = actionButton(document, { action: 'mute', label: 'ปิดไมค์', enabled: false, glyph: 'mute' }); const muteButton = mute.children?.[0]; if (muteButton) { muteButton.title = 'Voice controls are unavailable in text-only mode'; muteButton.dataset.presentationState = 'unavailable'; }
  controls.append(speaker, end, mute); root.append(controls);

  const menu = el(document, 'div', 'tmrw-call-authority-menu'); menu.hidden = true;
  const menuButton = (label, target, enabled = true, handler = null) => { const button = el(document, 'button', '', label); button.type = 'button'; button.dataset.callNavigate = target; button.disabled = !enabled; button.addEventListener('click', () => { menu.hidden = true; if (handler) handler(); else onNavigate?.(target); }); return button; };
  menu.append(menuButton('โปรไฟล์', 'profile', false), menuButton('ประวัติการโทร', 'history'), menuButton(captionsVisible ? 'ปิดคำบรรยาย' : 'เปิดคำบรรยาย', 'captions', true, () => onToggleCaptions?.(!captionsVisible)), menuButton('การตั้งค่า', 'settings')); root.append(menu);
  more.addEventListener('click', () => { menu.hidden = !menu.hidden; });

  const mini = el(document, 'div', 'tmrw-call-authority-mini-layer'); mini.hidden = true; mini.append(el(document, 'div', 'tmrw-call-authority-mini-title', 'TMRW Phone'), el(document, 'div', 'tmrw-call-authority-mini-sub', 'สายยังคงเชื่อมต่ออยู่'));
  const card = el(document, 'button', 'tmrw-call-authority-mini-card'); card.type = 'button'; card.dataset.callAction = 'restore'; card.append(el(document, 'span', 'tmrw-call-authority-mini-avatar', initials(island.counterpartLabel)), el(document, 'span', 'tmrw-call-authority-mini-info', island.counterpartLabel || 'Call participant'), el(document, 'i', 'tmrw-call-authority-mini-live-dot')); mini.append(card); root.append(mini);
  minimize.addEventListener('click', () => { root.classList?.add?.('is-minimized'); mini.hidden = false; }); card.addEventListener('click', () => { root.classList?.remove?.('is-minimized'); mini.hidden = true; });

}

function renderEnded({ document, root, island, onClose, onContinueOnce, avatarUrl = null }) {
  const close = el(document, 'button', 'tmrw-call-authority-close-btn'); close.type = 'button'; close.dataset.callAction = 'close-ended'; close.setAttribute('aria-label', 'ปิดหน้าสรุปสาย'); close.append(icon(document, 'close', 20)); bindOneShot(close, () => onClose?.()); root.append(close);
  root.append(header(document, island), portrait(document, island.counterpartLabel, { avatarUrl }));
  root.append(el(document, 'div', 'tmrw-call-authority-hint', 'การสนทนาถูกบันทึกไว้แล้ว แตะประวัติการโทรเพื่อดูข้อมูลที่บันทึกไว้'));
  const ended = el(document, 'div', 'tmrw-call-authority-ended-row'); ended.append(el(document, 'span', 'tmrw-call-authority-ended-label', 'วางสายแล้ว'), el(document, 'span', 'tmrw-call-authority-ended-duration', island.durationLabel || '')); root.append(ended);
  if (typeof onContinueOnce === 'function') {
    const cont = el(document, 'button', 'tmrw-call-authority-continue', 'ดำเนินเรื่องต่อ'); cont.type = 'button'; cont.dataset.callAction = 'continue-story'; bindOneShot(cont, () => onContinueOnce()); root.append(cont);
  }
}

export function renderApprovedCallSurface({ document, island, inspectionOnly = false, onAction, onSend, onClose, onContinueOnce, onNavigate = null, turnState = null, captionsVisible = true, onToggleCaptions = null, onRetry = null, avatarUrl = null }) {
  const root = el(document, 'section', `tmrw-call-authority-surface tmrw-call-authority-${island.kind}`);
  root.dataset.callSessionId = island.callSessionId || '';
  root.dataset.callState = island.state || island.kind;
  root.dataset.presentationAuthority = 'v3/design/call-ui-authority';
  root.setAttribute('aria-label', island.title || 'Call');
  root.append(statusBar(document), el(document, 'div', 'tmrw-call-authority-notch'));

  if (island.kind === 'incoming' || island.kind === 'outgoing') renderRinging({ document, root, island, inspectionOnly, onAction, avatarUrl });
  else if (island.kind === 'active') renderActive({ document, root, island, inspectionOnly, onAction, onSend, onNavigate, turnState, captionsVisible, onToggleCaptions, onRetry, avatarUrl });
  else if (island.kind === 'ended') renderEnded({ document, root, island, onClose, onContinueOnce, avatarUrl });

  root.append(el(document, 'div', 'tmrw-call-authority-home-indicator'));
  return root;
}
