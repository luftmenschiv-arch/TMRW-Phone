const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const amountText = (amount, currency) => `${Number(amount)} ${currency}`;

export function renderWallet({ document, view = { entries: [], knownBalances: {} }, authorizationGranted = true, error = null, selectedRecordId = null, onSelect }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-wallet';
  if (!authorizationGranted) { root.append(el(document, 'p', 'Wallet is unavailable until access to this phone is granted.')); return root; }
  if (error) { const alert = el(document, 'p', `Wallet error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); return root; }

  const balances = Object.values(view.knownBalances || {}).sort((a, b) => String(a.currency).localeCompare(String(b.currency)));
  const balanceSection = el(document, 'section'); balanceSection.className = 'tmrw-v3-wallet-balances'; balanceSection.append(el(document, 'h3', 'Known balances'));
  if (balances.length === 0) balanceSection.append(el(document, 'p', 'Balance unknown — no canonical balance snapshot exists for this phone.'));
  else for (const balance of balances) {
    const row = el(document, 'article'); row.className = 'tmrw-v3-wallet-balance'; row.dataset.currency = balance.currency;
    row.append(el(document, 'strong', amountText(balance.amount, balance.currency)));
    const provenance = [balance.sourceKind, balance.updatedAt].filter(Boolean).join(' · ');
    row.append(el(document, 'small', provenance ? `Source: ${provenance}` : 'Source: canonical Wallet balance snapshot'));
    balanceSection.append(row);
  }
  root.append(balanceSection);

  const transactions = (view.entries || []).filter(row => row.entryKind === 'transaction');
  const history = el(document, 'section'); history.className = 'tmrw-v3-wallet-history'; history.append(el(document, 'h3', 'Transactions'));
  if (transactions.length === 0) history.append(el(document, 'p', 'No canonical Wallet transactions on this phone yet.'));
  else {
    const list = el(document, 'ul'); list.className = 'tmrw-v3-wallet-list';
    for (const row of transactions) {
      const item = el(document, 'li'); const button = el(document, 'button'); button.type = 'button'; button.dataset.walletRecordId = row.recordId; button.setAttribute('aria-label', `Open Wallet transaction ${row.label}`);
      button.append(el(document, 'strong', row.label), el(document, 'span', amountText(row.amount, row.currency)), el(document, 'small', row.sourceKind || 'Canonical Wallet state'));
      button.addEventListener('click', () => onSelect?.(row.recordId)); item.append(button); list.append(item);
    }
    history.append(list);
  }
  root.append(history);

  const selected = transactions.find(row => row.recordId === selectedRecordId) || null;
  if (selected) {
    const details = el(document, 'section'); details.className = 'tmrw-v3-wallet-details'; details.dataset.walletDetailsId = selected.recordId;
    details.append(el(document, 'h3', selected.label), el(document, 'p', `Amount: ${amountText(selected.amount, selected.currency)}`), el(document, 'p', `Source: ${selected.sourceKind || 'Canonical Wallet state'}`));
    if (selected.relatedOrderId) { const linked = el(document, 'p', `Linked Shop Order: ${selected.relatedOrderId}`); linked.className = 'tmrw-v3-commerce-reference'; details.append(linked); }
    if (selected.updatedAt) details.append(el(document, 'p', `Recorded: ${selected.updatedAt}`));
    root.append(details);
  }
  return root;
}
