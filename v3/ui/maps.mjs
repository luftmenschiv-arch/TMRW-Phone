const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };

export function renderMaps({ document, authorizationGranted = true, error = null, items = [], audiences = [], selectedAudienceIds = [], draftLabel = '', viewerAccountId = null, viewerDeviceId = null, onDraft, onToggleAudience, onCheckIn, onShare, onStartLive, onEndLive }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-maps';
  if (!authorizationGranted) { root.append(el(document, 'p', 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return root; }
  if (error) { const alert = el(document, 'p', `Maps error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); return root; }

  const canvas = el(document, 'section'); canvas.className = 'tmrw-phone-map-canvas'; canvas.setAttribute('aria-label', 'Story locations'); const grid = el(document, 'div'); grid.className = 'tmrw-phone-map-grid'; grid.setAttribute('aria-hidden', 'true'); canvas.append(grid);
  root.append(canvas);

  const panel = el(document, 'section'); panel.className = 'tmrw-phone-map-panel';
  const search = el(document, 'label'); const input = el(document, 'input'); input.type = 'text'; input.value = draftLabel; input.placeholder = 'Story-world location'; input.setAttribute('aria-label', 'Story-world location label'); input.addEventListener('input', () => onDraft?.(String(input.value || ''))); search.append(input); panel.append(search);
  const shortcuts = el(document, 'div'); shortcuts.className = 'tmrw-phone-map-shortcuts';
  const action = (id, label, disabled, callback) => { const button = el(document, 'button', label); button.type = 'button'; button.dataset.locationAction = id; button.disabled = disabled; let busy = false; button.addEventListener('click', () => { if (busy || button.disabled) return; busy = true; button.disabled = true; void Promise.resolve(callback?.()).finally(() => { busy = false; }); }); shortcuts.append(button); };
  const ready = Boolean(String(draftLabel || '').trim()); const audienceReady = selectedAudienceIds.length > 0; action('check-in', 'Check In', !ready, onCheckIn); action('share', 'Share', !ready || !audienceReady, onShare); action('live', 'Live · 30m', !ready || !audienceReady, onStartLive); panel.append(shortcuts);
  if (audiences.length) { const audience = el(document, 'div'); audience.className = 'tmrw-v3-location-audiences'; for (const choice of audiences) { const button = el(document, 'button', choice.label); button.type = 'button'; button.dataset.locationAudience = choice.accountId; button.setAttribute('aria-pressed', String(selectedAudienceIds.includes(choice.accountId))); button.addEventListener('click', () => onToggleAudience?.(choice.accountId)); audience.append(button); } panel.append(audience); }
  const heading = el(document, 'header'); heading.append(el(document, 'h2', 'Locations'), el(document, 'small', `${items.length}`)); panel.append(heading);
  const nearby = el(document, 'div'); nearby.className = 'tmrw-phone-map-nearby';
  for (const item of items) { const row = el(document, 'article'); row.className = 'tmrw-v3-location-row'; row.dataset.locationRecordId = item.recordId; const copy = el(document, 'span'); copy.append(el(document, 'strong', item.label), el(document, 'small', `${item.mode} · ${item.status}`)); row.append(copy); if (item.mode === 'live' && item.status === 'active' && item.ownerAccountId === viewerAccountId && item.deviceId === viewerDeviceId) { const end = el(document, 'button', 'End Live'); end.type = 'button'; end.dataset.locationAction = 'end-live'; end.dataset.locationRecordId = item.recordId; let busy = false; end.addEventListener('click', () => { if (busy || end.disabled) return; busy = true; end.disabled = true; void Promise.resolve(onEndLive?.(item)).finally(() => { busy = false; }); }); row.append(end); } nearby.append(row); }
  if (items.length === 0) nearby.append(el(document, 'p', 'ยังไม่มีตำแหน่งที่แชร์ไว้')); panel.append(nearby); root.append(panel); return root;
}
