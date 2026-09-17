import { createPreviewIcon } from './app-icons.mjs';

const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const icon = (document, name, size) => createPreviewIcon({ document, name, size });
import { renderAppEmptyState, renderInlineNotice } from './app-empty-state.mjs';
const emptyState = (document, text) => renderAppEmptyState({ document, app: 'maps', title: text, compact: true });

export function renderMaps({ document, authorizationGranted = true, error = null, items = [], audiences = [], selectedAudienceIds = [], draftLabel = '', viewerAccountId = null, viewerDeviceId = null, onDraft, onToggleAudience, onCheckIn, onShare, onStartLive, onEndLive }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-maps';
  if (!authorizationGranted) { root.append(emptyState(document, 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return root; }
  if (error) { root.append(renderInlineNotice({ document, tone:'error', title:'เปิด Maps ยังไม่สำเร็จ', detail:'ข้อมูลเดิมยังอยู่ ลองกลับเข้ามาใหม่อีกครั้ง' })); return root; }

  const canvas = el(document, 'section'); canvas.className = 'tmrw-phone-map-canvas'; canvas.setAttribute('aria-label', 'Story locations');
  const grid = el(document, 'div'); grid.className = 'tmrw-phone-map-grid'; grid.setAttribute('aria-hidden', 'true');
  const river = el(document, 'div'); river.className = 'tmrw-phone-map-river'; river.setAttribute('aria-hidden', 'true'); canvas.append(grid, river);
  for (const name of ['road-a','road-b','road-c']) { const road = el(document, 'span'); road.className = `road ${name}`; road.setAttribute('aria-hidden', 'true'); canvas.append(road); }
  const layers = el(document, 'button'); layers.type = 'button'; layers.className = 'tmrw-phone-map-layers'; layers.disabled = true; layers.setAttribute('aria-label', 'ชั้นแผนที่ยังไม่พร้อมใช้งาน'); layers.append(icon(document, 'layers', 18)); const locate = el(document, 'button'); locate.type = 'button'; locate.className = 'tmrw-phone-map-locate'; locate.disabled = true; locate.setAttribute('aria-label', 'ตำแหน่งปัจจุบันยังไม่มีพิกัด'); locate.append(icon(document, 'navigation', 19)); canvas.append(layers, locate); root.append(canvas);

  const panel = el(document, 'section'); panel.className = 'tmrw-phone-map-panel';
  const search = el(document, 'label'); search.append(icon(document, 'search', 18)); const input = el(document, 'input'); input.type = 'text'; input.value = draftLabel; input.placeholder = 'ค้นหาหรือระบุสถานที่...'; input.setAttribute('aria-label', 'Story-world location label'); input.addEventListener('input', () => onDraft?.(String(input.value || ''))); search.append(input); if (draftLabel) { const clear = el(document, 'button'); clear.type = 'button'; clear.append(icon(document, 'close', 15)); clear.addEventListener('click', () => { input.value = ''; onDraft?.(''); }); search.append(clear); } else { const nav = el(document, 'i'); nav.append(icon(document, 'navigation', 15)); search.append(nav); } panel.append(search);

  const ready = Boolean(String(draftLabel || '').trim()); const audienceReady = selectedAudienceIds.length > 0;
  const shortcuts = el(document, 'div'); shortcuts.className = 'tmrw-phone-map-shortcuts';
  const shortcut = (id, label, detail, iconName, disabled, callback) => { const button = el(document, 'button'); button.type = 'button'; button.dataset.locationAction = id; button.disabled = disabled; const mark = el(document, 'i'); mark.append(icon(document, iconName, 18)); const copy = el(document, 'span'); copy.append(el(document, 'strong', label), el(document, 'small', detail)); button.append(mark, copy); let busy = false; button.addEventListener('click', () => { if (busy || button.disabled) return; busy = true; button.disabled = true; void Promise.resolve(callback?.()).finally(() => { busy = false; }); }); shortcuts.append(button); };
  shortcut('check-in', 'Check In', ready ? 'บันทึกสถานที่นี้' : 'ระบุสถานที่ก่อน', 'location', !ready, onCheckIn);
  shortcut('share', 'Share', audienceReady ? `${selectedAudienceIds.length} คน` : 'เลือกผู้รับก่อน', 'send', !ready || !audienceReady, onShare);
  shortcut('live', 'Live', audienceReady ? 'แชร์ตำแหน่งสด' : 'เลือกผู้รับก่อน', 'live', !ready || !audienceReady, onStartLive);
  shortcut('more', 'เพิ่มเติม', 'ไม่มีคำสั่งเพิ่มเติม', 'more', true, null); panel.append(shortcuts);

  if (audiences.length) { const audience = el(document, 'section'); audience.className = 'tmrw-phone-filter-chips tmrw-v3-location-audiences'; const label = el(document, 'strong', 'แชร์กับ'); audience.append(label); for (const choice of audiences) { const button = el(document, 'button', choice.label); button.type = 'button'; button.dataset.locationAudience = choice.accountId; button.setAttribute('aria-pressed', String(selectedAudienceIds.includes(choice.accountId))); button.className = selectedAudienceIds.includes(choice.accountId) ? 'is-active' : ''; button.addEventListener('click', () => onToggleAudience?.(choice.accountId)); audience.append(button); } panel.append(audience); }

  const heading = el(document, 'header'); heading.append(el(document, 'h2', 'สถานที่ล่าสุด'), el(document, 'small', `${items.length} แห่ง`)); panel.append(heading); const nearby = el(document, 'div'); nearby.className = 'tmrw-phone-map-nearby';
  for (const item of items) { const row = el(document, 'article'); row.className = 'tmrw-v3-location-row'; row.dataset.locationRecordId = item.recordId; const mark = el(document, 'i'); mark.append(icon(document, item.mode === 'live' ? 'navigation' : item.mode === 'shared' ? 'send' : 'location', 17)); const copy = el(document, 'span'); copy.append(el(document, 'strong', item.label), el(document, 'small', `${item.mode} · ${item.status}`)); row.append(mark, copy); if (item.mode === 'live' && item.status === 'active' && item.ownerAccountId === viewerAccountId && item.deviceId === viewerDeviceId) { const end = el(document, 'button', 'End Live'); end.type = 'button'; end.dataset.locationAction = 'end-live'; end.dataset.locationRecordId = item.recordId; let busy = false; end.addEventListener('click', () => { if (busy || end.disabled) return; busy = true; end.disabled = true; void Promise.resolve(onEndLive?.(item)).finally(() => { busy = false; }); }); row.append(end); } nearby.append(row); }
  if (items.length === 0) nearby.append(emptyState(document, 'ยังไม่มีตำแหน่งที่บันทึกหรือแชร์ไว้')); panel.append(nearby); root.append(panel); return root;
}
