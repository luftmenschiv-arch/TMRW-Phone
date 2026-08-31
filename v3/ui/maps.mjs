const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };

export function renderMaps({ document, authorizationGranted = true, error = null, items = [], audiences = [], selectedAudienceIds = [], draftLabel = '', viewerAccountId = null, viewerDeviceId = null, onDraft, onToggleAudience, onCheckIn, onShare, onStartLive, onEndLive }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-maps';
  root.append(el(document, 'p', 'Story-world locations only · TMRW does not claim device GPS or live map-tile coverage.'));
  if (!authorizationGranted) { root.append(el(document, 'p', 'Maps location state is unavailable until access to this phone is granted.')); return root; }
  if (error) { const alert = el(document, 'p', `Maps error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); return root; }

  const composer = el(document, 'section'); composer.className = 'tmrw-v3-location-composer'; composer.append(el(document, 'h3', 'Location action'));
  const input = el(document, 'input'); input.type = 'text'; input.value = draftLabel; input.placeholder = 'Story-world location'; input.setAttribute('aria-label', 'Story-world location label'); input.addEventListener('input', () => onDraft?.(String(input.value || ''))); composer.append(input);
  const audience = el(document, 'div'); audience.className = 'tmrw-v3-location-audiences';
  if (audiences.length === 0) audience.append(el(document, 'p', 'No identified Contacts are available for location sharing. Check In remains private to this phone account.'));
  for (const choice of audiences) { const button = el(document, 'button', choice.label); button.type = 'button'; button.dataset.locationAudience = choice.accountId; button.setAttribute('aria-pressed', String(selectedAudienceIds.includes(choice.accountId))); button.setAttribute('aria-label', `Share location with ${choice.label}`); button.addEventListener('click', () => onToggleAudience?.(choice.accountId)); audience.append(button); }
  composer.append(audience);
  const actions = el(document, 'div'); actions.className = 'tmrw-v3-location-actions'; const labelReady = Boolean(String(draftLabel || '').trim()); const audienceReady = selectedAudienceIds.length > 0;
  const addAction = (id, text, disabled, callback) => { const button = el(document, 'button', text); button.type = 'button'; button.dataset.locationAction = id; button.disabled = disabled; let busy = false; button.addEventListener('click', () => { if (busy || button.disabled) return; busy = true; button.disabled = true; void Promise.resolve(callback?.()).finally(() => { busy = false; }); }); actions.append(button); };
  addAction('check-in', 'Check In', !labelReady, onCheckIn); addAction('share', 'Share Location', !labelReady || !audienceReady, onShare); addAction('live', 'Share Live · 30 min', !labelReady || !audienceReady, onStartLive); composer.append(actions); root.append(composer);

  const list = el(document, 'section'); list.className = 'tmrw-v3-location-list'; list.append(el(document, 'h3', 'Visible location state'));
  if (items.length === 0) list.append(el(document, 'p', 'No phone-world location records are visible to this account.'));
  for (const item of items) {
    const row = el(document, 'article'); row.className = 'tmrw-v3-location-row'; row.dataset.locationRecordId = item.recordId; const ownership = item.ownerAccountId === viewerAccountId ? 'This phone' : 'Shared with this phone'; row.append(el(document, 'strong', item.label), el(document, 'p', `${ownership} · ${item.mode} · ${item.status}`));
    if (item.mode === 'live') row.append(el(document, 'small', item.expiresAt ? `Live sharing expiry: ${item.expiresAt}` : 'Live sharing has no claimed automatic expiry source.'));
    if (item.mode === 'live' && item.status === 'active' && item.ownerAccountId === viewerAccountId && item.deviceId === viewerDeviceId) { const end = el(document, 'button', 'End Live Location'); end.type = 'button'; end.dataset.locationAction = 'end-live'; end.dataset.locationRecordId = item.recordId; end.setAttribute('aria-label', `End live location ${item.label}`); let busy = false; end.addEventListener('click', () => { if (busy || end.disabled) return; busy = true; end.disabled = true; void Promise.resolve(onEndLive?.(item)).finally(() => { busy = false; }); }); row.append(end); }
    list.append(row);
  }
  root.append(list); return root;
}
