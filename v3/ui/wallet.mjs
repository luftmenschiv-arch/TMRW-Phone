import { createPreviewIcon } from './app-icons.mjs';

const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const icon = (document, name, size) => createPreviewIcon({ document, name, size });
const amountText = (amount, currency) => `${Number(amount)} ${currency}`;

import { renderAppEmptyState, renderInlineNotice } from './app-empty-state.mjs';
function emptyState(document, text) { return renderAppEmptyState({ document, app: 'wallet', title: text, compact: true }); }

export function renderWallet({ document, view = { entries: [], knownBalances: {} }, authorizationGranted = true, error = null, selectedRecordId = null, onSelect }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-wallet';
  if (!authorizationGranted) { root.append(emptyState(document, 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return root; }
  if (error) { root.append(renderInlineNotice({ document, tone:'error', title:'เปิดกระเป๋าเงินยังไม่สำเร็จ', detail:'ข้อมูลเดิมยังอยู่ ลองกลับเข้ามาใหม่อีกครั้ง' })); return root; }

  const balances = Object.values(view.knownBalances || {}).sort((a, b) => String(a.currency).localeCompare(String(b.currency)));
  const balanceCard = el(document, 'section'); balanceCard.className = 'tmrw-phone-wallet-balance-card';
  const balanceCopy = el(document, 'div'); balanceCopy.className = 'tmrw-phone-wallet-balance-copy';
  balanceCopy.append(el(document, 'span', 'ยอดเงิน'));
  if (balances.length === 0) {
    balanceCopy.append(el(document, 'strong', '—'), el(document, 'small', 'ยังไม่มียอดเงินที่ยืนยันแล้ว'));
  } else {
    const [primary, ...additional] = balances;
    balanceCopy.append(el(document, 'strong', amountText(primary.amount, primary.currency)));
    for (const balance of additional) {
      const chip = el(document, 'em');
      chip.append(el(document, 'i', String(balance.currency || '?').slice(0, 1).toUpperCase()), el(document, 'b', String(Number(balance.amount))), el(document, 'small', balance.currency));
      balanceCopy.append(chip);
    }
  }
  const art = el(document, 'div'); art.className = 'tmrw-phone-wallet-art'; art.setAttribute('aria-hidden', 'true'); art.append(el(document, 'b', 'T'), el(document, 'span'));
  const actions = el(document, 'div'); actions.className = 'tmrw-phone-wallet-actions';
  for (const [name, label] of [['plus','เติม'],['transfer','โอน'],['qr','จ่าย']]) { const button = el(document, 'button'); button.type = 'button'; button.disabled = true; button.setAttribute('aria-label', `${label}ยังไม่พร้อมใช้งาน`); button.append(icon(document, name, 19), el(document, 'span', label)); actions.append(button); }
  balanceCard.append(balanceCopy, art, actions); root.append(balanceCard);

  let activeTab = 'all'; let historyNode = null; let detailNode = null; const tabPanels = new Map();
  const tabs = el(document, 'div'); tabs.className = 'tmrw-phone-commerce-chips tmrw-phone-wallet-tabs';
  const paintTabs = () => { for (const child of tabs.children || []) child.className = child.dataset?.walletTab === activeTab ? 'is-active' : ''; if (historyNode) historyNode.hidden = activeTab !== 'all'; if (detailNode) detailNode.hidden = activeTab !== 'all'; for (const [id,panel] of tabPanels) panel.hidden = id !== activeTab; };
  for (const [id, label, name] of [['all','ทั้งหมด','grid'],['cards','บัตร','card'],['coupons','คูปอง','ticket'],['points','สะสมแต้ม','star']]) { const button = el(document, 'button'); button.type = 'button'; button.dataset.walletTab = id; button.className = id === 'all' ? 'is-active' : ''; button.append(icon(document, name, 15), el(document, 'span', label)); button.addEventListener('click', () => { activeTab = id; paintTabs(); }); tabs.append(button); }
  root.append(tabs);

  const transactions = (view.entries || []).filter(row => row.entryKind === 'transaction');
  const history = el(document, 'section'); history.className = 'tmrw-phone-commerce-section'; const heading = el(document, 'header'); heading.append(el(document, 'h2', 'รายการล่าสุด')); history.append(heading);
  if (transactions.length === 0) history.append(emptyState(document, 'ยังไม่มีรายการเคลื่อนไหว'));
  else {
    const list = el(document, 'div'); list.className = 'tmrw-phone-wallet-transactions';
    for (const row of transactions) {
      const button = el(document, 'button'); button.type = 'button'; button.className = 'tmrw-phone-wallet-transaction'; button.dataset.walletRecordId = row.recordId; button.setAttribute('aria-label', `เปิดรายการ ${row.label}`);
      const mark = el(document, 'i'); mark.append(icon(document, Number(row.amount) >= 0 ? 'plus' : 'receipt', 20));
      const copy = el(document, 'span'); copy.append(el(document, 'strong', row.label), el(document, 'small', row.updatedAt || ''));
      const amount = el(document, 'b', amountText(row.amount, row.currency)); amount.className = Number(row.amount) > 0 ? 'is-positive' : Number(row.amount) < 0 ? 'is-negative' : 'is-neutral';
      button.append(mark, copy, amount); button.addEventListener('click', () => onSelect?.(row.recordId)); list.append(button);
    }
    history.append(list);
  }
  root.append(history); historyNode = history;

  const cards = el(document, 'section'); cards.className = 'tmrw-phone-commerce-section'; cards.hidden = true; const cardsHeader = el(document, 'header'); cardsHeader.append(el(document, 'h2', 'บัตรของคุณ')); cards.append(cardsHeader); const cardStack = el(document, 'div'); cardStack.className = 'tmrw-phone-wallet-card-stack'; cardStack.append(emptyState(document, 'ยังไม่มีบัตรที่ยืนยันแล้ว')); cards.append(cardStack); tabPanels.set('cards', cards); root.append(cards);

  const coupons = el(document, 'section'); coupons.className = 'tmrw-phone-commerce-section tmrw-phone-wallet-coupons'; coupons.hidden = true; const couponHeader = el(document, 'header'); couponHeader.append(el(document, 'h2', 'คูปองที่ใช้ได้')); coupons.append(couponHeader); const couponGrid = el(document, 'div'); couponGrid.className = 'tmrw-phone-wallet-coupon-grid'; couponGrid.append(emptyState(document, 'ยังไม่มีคูปองที่ยืนยันแล้ว')); coupons.append(couponGrid); tabPanels.set('coupons', coupons); root.append(coupons);

  const points = el(document, 'section'); points.className = 'tmrw-phone-wallet-points-panel'; points.hidden = true; const star = el(document, 'i'); star.append(icon(document, 'star', 31)); const pointCopy = el(document, 'span'); pointCopy.append(el(document, 'small', 'TMRW Points พร้อมใช้'), el(document, 'strong', '—'), el(document, 'em', 'ยังไม่มีคะแนนสะสมที่ยืนยันแล้ว')); const redeem = el(document, 'button', 'แลกแต้ม'); redeem.type = 'button'; redeem.disabled = true; points.append(star, pointCopy, redeem); tabPanels.set('points', points); root.append(points);

  const selected = transactions.find(row => row.recordId === selectedRecordId) || null;
  if (selected) { const details = el(document, 'section'); details.className = 'tmrw-v3-wallet-details tmrw-phone-wallet-mini-promo'; details.dataset.walletDetailsId = selected.recordId; const mark = el(document, 'i'); mark.append(icon(document, 'receipt', 22)); const copy = el(document, 'span'); copy.append(el(document, 'strong', selected.label), el(document, 'small', amountText(selected.amount, selected.currency))); if (selected.relatedOrderId) copy.append(el(document, 'small', `Order ${selected.relatedOrderId}`)); details.append(mark, copy); detailNode = details; root.append(details); }
  paintTabs(); return root;
}
