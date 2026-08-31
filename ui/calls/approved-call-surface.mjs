const el = (document, tag, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const initials = label => String(label || '?').trim().slice(0, 1).toUpperCase() || '?';

const bindOneShot = (button, handler) => {
  let busy = false;
  button.addEventListener('click', () => {
    if (busy || button.disabled) return;
    busy = true;
    button.disabled = true;
    void Promise.resolve().then(handler).catch(() => {});
  });
};

const controlButton = (document, className, label, action, enabled = true, ariaLabel = null) => {
  const node = el(document, 'button', className);
  node.type = 'button';
  node.dataset.callAction = action;
  node.setAttribute('aria-label', ariaLabel || label);
  node.textContent = label;
  node.disabled = !enabled;
  node.append(
    el(document, 'span', 'tmrw-call-control-glyph', action === 'accept' ? '☎' : ['end', 'cancel', 'decline'].includes(action) ? '×' : '•'),
    el(document, 'span', 'tmrw-call-control-label', label),
  );
  return node;
};

export function renderApprovedCallSurface({ document, island, inspectionOnly = false, onAction, onSend, onClose, onContinueOnce }) {
  const root = el(document, 'section', `tmrw-call-approved-surface tmrw-call-approved-${island.kind}`);
  root.dataset.callSessionId = island.callSessionId || '';
  root.dataset.callState = island.state || island.kind;
  root.setAttribute('aria-label', island.title || 'Call');

  const top = el(document, 'div', 'tmrw-call-approved-top');
  const status = el(document, 'div', 'tmrw-call-approved-status');
  status.append(
    el(document, 'span', 'tmrw-call-approved-kicker', island.kind === 'incoming' ? 'สายเรียกเข้า' : island.kind === 'outgoing' ? 'สายโทรออก' : island.kind === 'ended' ? 'สิ้นสุดการโทร' : 'กำลังโทร'),
    el(document, 'strong', 'tmrw-call-approved-name', island.counterpartLabel || 'Unknown'),
    el(document, 'span', 'tmrw-call-approved-state', island.kind === 'incoming' ? 'กำลังโทร...' : island.kind === 'outgoing' ? 'กำลังโทรออก...' : island.kind === 'active' ? `เชื่อมต่อแล้ว • ${island.durationLabel || 'Story duration'}` : island.durationLabel || island.title),
  );
  top.append(status);
  if (island.kind === 'ended') {
    const close = el(document, 'button', 'tmrw-call-approved-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close ended call');
    bindOneShot(close, () => onClose?.());
    top.append(close);
  }
  root.append(top);

  const portraitWrap = el(document, 'div', 'tmrw-call-approved-portrait-wrap');
  portraitWrap.append(
    el(document, 'div', 'tmrw-call-approved-aura'),
    el(document, 'div', 'tmrw-call-approved-portrait', initials(island.counterpartLabel)),
  );
  portraitWrap.children[1].setAttribute('aria-label', `${island.counterpartLabel || 'Call participant'} avatar`);
  root.append(portraitWrap);

  if (inspectionOnly) root.append(el(document, 'p', 'tmrw-call-approved-inspection', 'Inspection only — player access does not change canonical ownership or Knowledge.'));

  if (island.kind === 'active') {
    const stage = el(document, 'div', 'tmrw-call-approved-turn-stage');
    const latest = (island.transcript || []).at(-1);
    stage.append(latest ? el(document, 'div', 'tmrw-call-approved-subtitle', latest.text) : el(document, 'div', 'tmrw-call-approved-thinking', '•••'));
    root.append(stage);

    const composer = el(document, 'div', 'tmrw-call-approved-composer');
    const input = el(document, 'textarea', 'tmrw-call-approved-input');
    input.setAttribute('aria-label', 'Call text');
    input.placeholder = 'พิมพ์ข้อความ...';
    input.disabled = inspectionOnly;
    const send = el(document, 'button', 'tmrw-call-approved-send', 'Send');
    send.type = 'button';
    send.setAttribute('aria-label', 'Send');
    const syncSend = () => { send.disabled = inspectionOnly || !String(input.value || '').trim(); };
    syncSend();
    input.addEventListener('input', syncSend);
    let sendBusy = false;
    send.addEventListener('click', () => {
      if (sendBusy || inspectionOnly || !String(input.value || '').trim()) return;
      sendBusy = true;
      send.disabled = true;
      void Promise.resolve(onSend?.(input)).catch(() => {});
    });
    composer.append(input, send);
    root.append(composer);

    const controls = el(document, 'div', 'tmrw-call-approved-controls');
    const speaker = controlButton(document, 'tmrw-call-approved-control tmrw-call-approved-control-disabled', 'ลำโพง', 'speaker', false);
    speaker.title = 'Voice controls are unavailable in text-only mode';
    const end = controlButton(document, 'tmrw-call-approved-control tmrw-call-approved-end', 'End call', 'end', !inspectionOnly, 'End call call');
    bindOneShot(end, () => onAction?.('end'));
    const mute = controlButton(document, 'tmrw-call-approved-control tmrw-call-approved-control-disabled', 'ปิดไมค์', 'mute', false);
    mute.title = 'Voice controls are unavailable in text-only mode';
    controls.append(speaker, end, mute);
    root.append(controls);
  } else if (island.kind === 'incoming') {
    root.append(el(document, 'p', 'tmrw-call-approved-hint', 'สายเรียกเข้าพร้อมรับเมื่อคุณต้องการ'));
    const actions = el(document, 'div', 'tmrw-call-approved-ring-actions');
    const decline = controlButton(document, 'tmrw-call-approved-control tmrw-call-approved-decline', 'Decline', 'decline', island.actions?.find(x => x.id === 'decline')?.enabled, 'Decline call');
    bindOneShot(decline, () => onAction?.('decline'));
    const accept = controlButton(document, 'tmrw-call-approved-control tmrw-call-approved-accept', 'Accept', 'accept', island.actions?.find(x => x.id === 'accept')?.enabled, 'Accept call');
    bindOneShot(accept, () => onAction?.('accept'));
    actions.append(decline, accept);
    root.append(actions);
  } else if (island.kind === 'outgoing') {
    root.append(el(document, 'p', 'tmrw-call-approved-hint', 'กำลังรออีกฝ่ายรับสาย...'));
    const actions = el(document, 'div', 'tmrw-call-approved-ring-actions tmrw-call-approved-ring-actions-single');
    const cancel = controlButton(document, 'tmrw-call-approved-control tmrw-call-approved-decline', 'Cancel', 'cancel', island.actions?.find(x => x.id === 'cancel')?.enabled, 'Cancel call');
    bindOneShot(cancel, () => onAction?.('cancel'));
    actions.append(cancel);
    root.append(actions);
  } else if (island.kind === 'ended') {
    root.append(
      el(document, 'p', 'tmrw-call-approved-hint', 'การสนทนาสิ้นสุดแล้ว'),
      el(document, 'div', 'tmrw-call-approved-ended', 'วางสายแล้ว'),
    );
    if (typeof onContinueOnce === 'function') {
      const cont = el(document, 'button', 'tmrw-call-approved-continue', 'Continue story after this call');
      cont.type = 'button';
      bindOneShot(cont, () => onContinueOnce());
      root.append(cont);
    }
  }
  return root;
}
