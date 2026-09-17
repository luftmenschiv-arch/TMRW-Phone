import { createPreviewIcon } from './app-icons.mjs';

const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const icon = (document, name, size) => createPreviewIcon({ document, name, size });
import { renderAppEmptyState, renderInlineNotice } from './app-empty-state.mjs';
const emptyState = (document, text) => renderAppEmptyState({ document, app: 'search', title: text, compact: true });

function localResults(sources, query) {
  const needle = String(query || '').trim().toLocaleLowerCase(); if (!needle) return [];
  return sources.filter(row => `${row.kind} ${row.title || ''} ${row.text || ''}`.toLocaleLowerCase().includes(needle)).slice(0, 100);
}

export function renderSearch({ document, history = [], sources = [], authorizationGranted = true, error = null, query = '', submittedQuery = '', clearBusy = false, onQuery, onSubmit, onClearHistory }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-search tmrw-phone-personal-app tmrw-phone-search-hub';
  if (!authorizationGranted) { root.append(emptyState(document, 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return root; }
  if (error) { root.append(renderInlineNotice({ document, tone:'error', title:'ค้นหายังไม่สำเร็จ', detail:'ข้อมูลเดิมยังอยู่ ลองกลับเข้ามาใหม่อีกครั้ง' })); return root; }

  const form = el(document, 'label'); form.className = 'tmrw-v3-search-form tmrw-phone-personal-search tmrw-phone-soft-search'; form.append(icon(document, 'search', 20)); const input = el(document, 'input'); input.type = 'search'; input.value = query; input.placeholder = 'Search in TMRW Phone'; input.setAttribute('aria-label', 'Search this phone'); form.append(input); root.append(form);

  const chips = el(document, 'div'); chips.className = 'tmrw-phone-filter-chips tmrw-phone-soft-chips'; const filters = [['all','Latest'],['Contact','Contacts'],['Chat','Chats'],['Note','Notes']]; let activeFilter = 'all'; const resultRows = [];
  const paintFilter = () => { for (const entry of resultRows) entry.node.hidden = activeFilter !== 'all' && entry.kind !== activeFilter; };
  for (const [value, label] of filters) { const button = el(document, 'button', label); button.type = 'button'; button.className = value === 'all' ? 'is-active' : ''; button.dataset.searchFilter = value; button.addEventListener('click', () => { activeFilter = value; for (const child of chips.children || []) child.className = child.dataset?.searchFilter === value ? 'is-active' : ''; paintFilter(); }); chips.append(button); }
  root.append(chips);

  let busy = false; const submitQuery = () => { const value = String(input.value || '').trim(); onQuery?.(value); if (!value || busy) return; busy = true; void Promise.resolve(onSubmit?.(value)).finally(() => { busy = false; }); }; input.addEventListener('input', () => onQuery?.(String(input.value || ''))); input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault?.(); submitQuery(); } });

  const historySection = el(document, 'section'); historySection.className = 'tmrw-v3-search-history tmrw-phone-search-history-card'; const historyHeader = el(document, 'header'); historyHeader.append(el(document, 'h3', 'Recent searches')); if (history.length > 0) { const clear = el(document, 'button', clearBusy ? 'Clearing…' : 'Clear all'); clear.type = 'button'; clear.dataset.searchAction = 'clear-history'; clear.disabled = Boolean(clearBusy); clear.addEventListener('click', () => { if (!clear.disabled) void onClearHistory?.(); }); historyHeader.append(clear); } historySection.append(historyHeader);
  if (history.length === 0) historySection.append(emptyState(document, 'ยังไม่มีประวัติการค้นหา'));
  else for (const row of history.slice(0, 10)) { const item = el(document, 'button'); item.type = 'button'; item.dataset.searchHistoryRecordId = row.recordId || ''; item.append(icon(document, 'clock', 15), el(document, 'span', row.query), el(document, 'i', '×')); item.addEventListener('click', () => { input.value = row.query; onQuery?.(row.query); }); historySection.append(item); }
  root.append(historySection);

  const suggestions = [...new Map(sources.filter(row => row.title).map(row => [row.title, row])).values()].slice(0, 6);
  const suggestedSection = el(document, 'section'); suggestedSection.className = 'tmrw-phone-personal-section'; suggestedSection.append(el(document, 'h3', 'Suggested')); const suggestionList = el(document, 'div'); suggestionList.className = 'tmrw-phone-search-suggestions'; for (const row of suggestions) { const button = el(document, 'button'); button.type = 'button'; button.append(icon(document, row.kind === 'Note' ? 'notes' : row.kind === 'Contact' ? 'user' : row.kind === 'Gallery' ? 'gallery' : 'search', 15), el(document, 'span', row.title)); button.addEventListener('click', () => { input.value = row.title; onQuery?.(row.title); }); suggestionList.append(button); } if (!suggestions.length) suggestionList.append(emptyState(document, 'ยังไม่มีคำแนะนำจากข้อมูลจริง')); suggestedSection.append(suggestionList); root.append(suggestedSection);

  const effectiveQuery = submittedQuery || '';
  const results = localResults(sources, effectiveQuery); const resultSection = el(document, 'section'); resultSection.className = 'tmrw-phone-personal-section'; const resultHeading = el(document, 'div'); resultHeading.className = 'tmrw-phone-results-heading'; resultHeading.append(el(document, 'h3', effectiveQuery ? 'Search results' : 'On this phone'), el(document, 'small', 'ค้นจากข้อมูลจริงในโทรศัพท์เครื่องนี้')); resultSection.append(resultHeading); const list = el(document, 'div'); list.className = 'tmrw-phone-unified-results';
  const shown = effectiveQuery ? results : sources.slice(0, 10);
  for (const row of shown) { const item = el(document, 'article'); item.dataset.searchResultKind = row.kind; item.dataset.searchResultRecordId = row.recordId; const mark = el(document, 'i'); mark.append(icon(document, row.kind === 'Note' ? 'notes' : row.kind === 'Contact' ? 'user' : row.kind === 'Gallery' ? 'gallery' : row.kind === 'File' ? 'files' : 'search', 18)); const copy = el(document, 'span'); copy.append(el(document, 'small', String(row.kind || 'RESULT').toUpperCase()), el(document, 'strong', row.title || row.recordId)); if (row.text) copy.append(el(document, 'em', row.text)); item.append(mark, copy); list.append(item); resultRows.push({ node: item, kind: row.kind }); }
  if (shown.length === 0) list.append(emptyState(document, effectiveQuery ? 'ไม่พบผลลัพธ์' : 'ยังไม่มีข้อมูลที่ค้นหาได้')); resultSection.append(list); root.append(resultSection); paintFilter(); return root;
}

export { localResults };
