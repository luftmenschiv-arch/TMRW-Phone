const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };

function localResults(sources, query) {
  const needle = String(query || '').trim().toLocaleLowerCase(); if (!needle) return [];
  return sources.filter(row => `${row.kind} ${row.title || ''} ${row.text || ''}`.toLocaleLowerCase().includes(needle)).slice(0, 100);
}

export function renderSearch({ document, history = [], sources = [], authorizationGranted = true, error = null, query = '', submittedQuery = '', clearBusy = false, onQuery, onSubmit, onClearHistory }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-search';
  if (!authorizationGranted) { root.append(el(document, 'p', 'Search is unavailable until access to this phone is granted.')); return root; }
  if (error) { const alert = el(document, 'p', `Search error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); return root; }
  const truth = el(document, 'p', 'Search is local to authoritative content on this phone. TMRW does not fabricate internet results or a Discover feed.'); truth.className = 'tmrw-v3-search-truth'; root.append(truth);
  const form = el(document, 'section'); form.className = 'tmrw-v3-search-form'; const input = el(document, 'input'); input.type = 'search'; input.value = query; input.placeholder = 'Search this phone'; input.setAttribute('aria-label', 'Search this phone'); const submit = el(document, 'button', 'Search'); submit.type = 'button'; submit.dataset.searchAction = 'submit'; const sync = () => { submit.disabled = !String(input.value || '').trim(); onQuery?.(String(input.value || '')); }; input.addEventListener('input', sync); sync(); let busy = false; submit.addEventListener('click', () => { const value = String(input.value || '').trim(); if (!value || busy || submit.disabled) return; busy = true; submit.disabled = true; void Promise.resolve(onSubmit?.(value)).finally(() => { busy = false; }); }); form.append(input, submit); root.append(form);

  const historySection = el(document, 'section'); historySection.className = 'tmrw-v3-search-history'; historySection.append(el(document, 'h3', 'Search history'));
  if (history.length === 0) historySection.append(el(document, 'p', 'No search history on this phone yet.'));
  else { const clear = el(document, 'button', clearBusy ? 'Clearing…' : 'Clear history'); clear.type = 'button'; clear.dataset.searchAction = 'clear-history'; clear.disabled = Boolean(clearBusy); clear.setAttribute('aria-label', 'Clear search history on this phone'); clear.addEventListener('click', () => { if (!clear.disabled) void onClearHistory?.(); }); historySection.append(clear); const list = el(document, 'ul'); for (const row of history) { const item = el(document, 'li'); item.append(el(document, 'strong', row.query), el(document, 'small', `Source: ${row.provider || row.sourceKind || 'local phone-world search'}`)); list.append(item); } historySection.append(list); }
  root.append(historySection);

  if (!submittedQuery) { root.append(el(document, 'p', 'Enter a query to search local phone-world content.')); return root; }
  const results = localResults(sources, submittedQuery); const resultSection = el(document, 'section'); resultSection.className = 'tmrw-v3-search-results'; resultSection.append(el(document, 'h3', `Results for “${submittedQuery}”`));
  if (results.length === 0) resultSection.append(el(document, 'p', 'No local results found.'));
  else { const list = el(document, 'ul'); for (const row of results) { const item = el(document, 'li'); item.dataset.searchResultKind = row.kind; item.dataset.searchResultRecordId = row.recordId; item.append(el(document, 'strong', row.title || row.recordId), el(document, 'small', row.kind)); list.append(item); } resultSection.append(list); }
  root.append(resultSection); return root;
}

export { localResults };
