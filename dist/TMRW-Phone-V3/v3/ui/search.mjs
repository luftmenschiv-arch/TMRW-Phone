const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };

function localResults(sources, query) {
  const needle = String(query || '').trim().toLocaleLowerCase(); if (!needle) return [];
  return sources.filter(row => `${row.kind} ${row.title || ''} ${row.text || ''}`.toLocaleLowerCase().includes(needle)).slice(0, 100);
}

export function renderSearch({ document, history = [], sources = [], authorizationGranted = true, error = null, query = '', submittedQuery = '', clearBusy = false, onQuery, onSubmit, onClearHistory }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-search tmrw-phone-personal-app';
  if (!authorizationGranted) { root.append(el(document, 'p', 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return root; }
  if (error) { const alert = el(document, 'p', `Search error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); return root; }

  const form = el(document, 'label'); form.className = 'tmrw-v3-search-form tmrw-phone-personal-search tmrw-phone-soft-search';
  const input = el(document, 'input'); input.type = 'search'; input.value = query; input.placeholder = 'Search in TMRW—Phone'; input.setAttribute('aria-label', 'Search this phone');
  const submit = el(document, 'button', 'Search'); submit.type = 'button'; submit.dataset.searchAction = 'submit';
  const sync = () => { submit.disabled = !String(input.value || '').trim(); onQuery?.(String(input.value || '')); }; input.addEventListener('input', sync); sync(); let busy = false;
  submit.addEventListener('click', () => { const value = String(input.value || '').trim(); if (!value || busy || submit.disabled) return; busy = true; submit.disabled = true; void Promise.resolve(onSubmit?.(value)).finally(() => { busy = false; }); });
  form.append(input, submit); root.append(form);

  const historySection = el(document, 'section'); historySection.className = 'tmrw-v3-search-history tmrw-phone-search-history-card';
  const historyHeader = el(document, 'header'); historyHeader.append(el(document, 'h3', 'Recent searches'));
  if (history.length > 0) { const clear = el(document, 'button', clearBusy ? 'Clearing…' : 'Clear all'); clear.type = 'button'; clear.dataset.searchAction = 'clear-history'; clear.disabled = Boolean(clearBusy); clear.setAttribute('aria-label', 'Clear search history on this phone'); clear.addEventListener('click', () => { if (!clear.disabled) void onClearHistory?.(); }); historyHeader.append(clear); }
  historySection.append(historyHeader);
  if (history.length === 0) historySection.append(el(document, 'p', 'ยังไม่มีประวัติการค้นหา'));
  else for (const row of history.slice(0, 10)) { const item = el(document, 'div'); item.className = 'tmrw-v3-search-history-row'; item.append(el(document, 'span', row.query)); historySection.append(item); }
  root.append(historySection);

  if (!submittedQuery) return root;
  const results = localResults(sources, submittedQuery); const resultSection = el(document, 'section'); resultSection.className = 'tmrw-v3-search-results tmrw-phone-personal-section'; resultSection.append(el(document, 'h3', `Results for “${submittedQuery}”`));
  const list = el(document, 'div'); list.className = 'tmrw-phone-unified-results';
  for (const row of results) { const item = el(document, 'article'); item.dataset.searchResultKind = row.kind; item.dataset.searchResultRecordId = row.recordId; const copy = el(document, 'span'); copy.append(el(document, 'small', row.kind.toUpperCase()), el(document, 'strong', row.title || row.recordId)); if (row.text) copy.append(el(document, 'em', row.text)); item.append(copy); list.append(item); }
  if (results.length === 0) resultSection.append(el(document, 'p', 'ไม่พบผลลัพธ์')); else resultSection.append(list);
  root.append(resultSection); return root;
}

export { localResults };
