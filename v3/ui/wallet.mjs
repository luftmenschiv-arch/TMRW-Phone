const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const amountText = (amount, currency) => `${Number(amount)} ${currency}`;

export function renderWallet({ document, view = { entries: [], knownBalances: {} }, authorizationGranted = true, error = null, selectedRecordId = null, onSelect }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-wallet tmrw-phone-commerce-section';
  if (!authorizationGranted) { root.append(el(document, 'p', 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return root; }
  if (error) { const alert = el(document, 'p', `Wallet error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); return root; }

  const balances = Object.values(view.knownBalances || {}).sort((a, b) => String(a.currency).localeCompare(String(b.currency)));
  const balanceCard = el(document, 'section'); balanceCard.className = 'tmrw-v3-wallet-balances tmrw-phone-wallet-balance-card';
  const balanceCopy = el(document, 'div'); balanceCopy.className = 'tmrw-phone-wallet-balance-copy'; balanceCopy.append(el(document, 'span', 'ยอดเงิน'));
  if (balances.length === 0) balanceCopy.append(el(document, 'strong', '—'), el(document, 'small', 'ยอดเงินไม่พร้อมใช้งาน'));
  else {
    const [primary, ...additional] = balances; balanceCopy.append(el(document, 'strong', amountText(primary.amount, primary.currency)));
    for (const balance of additional) {
      const chip = el(document, 'em');
      chip.append(el(document, 'i', String(balance.currency || '?').slice(0, 1).toUpperCase()), el(document, 'b', String(Number(balance.amount))), el(document, 'small', balance.currency));
      balanceCopy.append(chip);
    }
  }
  const art = el(document, 'div'); art.className = 'tmrw-phone-wallet-art'; art.setAttribute('aria-hidden', 'true'); art.append(el(document, 'b', 'T'), el(document, 'span'));
  balanceCard.append(balanceCopy, art); root.append(balanceCard);

  const transactions = (view.entries || []).filter(row => row.entryKind === 'transaction');
  const history = el(document, 'section'); history.className = 'tmrw-v3-wallet-history tmrw-phone-commerce-section'; const heading = el(document, 'header'); heading.append(el(document, 'h2', 'Transactions')); history.append(heading);
  if (transactions.length === 0) history.append(el(document, 'p', 'ยังไม่มีรายการ'));
  else {
    const list = el(document, 'div'); list.className = 'tmrw-v3-wallet-list tmrw-phone-wallet-transactions';
    for (const row of transactions) {
      const button = el(document, 'button'); button.type = 'button'; button.className = 'tmrw-phone-wallet-transaction'; button.dataset.walletRecordId = row.recordId; button.setAttribute('aria-label', `Open Wallet transaction ${row.label}`);
      const icon = el(document, 'i', 'T'); const copy = el(document, 'span'); copy.append(el(document, 'strong', row.label), el(document, 'small', row.updatedAt || ''));
      const amount = el(document, 'b', amountText(row.amount, row.currency)); amount.className = Number(row.amount) > 0 ? 'is-positive' : Number(row.amount) < 0 ? 'is-negative' : 'is-neutral'; button.append(icon, copy, amount); button.addEventListener('click', () => onSelect?.(row.recordId)); list.append(button);
    }
    history.append(list);
  }
  root.append(history);

  const selected = transactions.find(row => row.recordId === selectedRecordId) || null;
  if (selected) {
    const details = el(document, 'section'); details.className = 'tmrw-v3-wallet-details tmrw-phone-wallet-mini-promo'; details.dataset.walletDetailsId = selected.recordId;
    details.append(el(document, 'i', 'T')); const copy = el(document, 'span'); copy.append(el(document, 'strong', selected.label), el(document, 'small', amountText(selected.amount, selected.currency))); if (selected.relatedOrderId) copy.append(el(document, 'small', `Order ${selected.relatedOrderId}`)); details.append(copy); root.append(details);
  }
  return root;
}
