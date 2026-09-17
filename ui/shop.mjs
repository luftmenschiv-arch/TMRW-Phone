import { createPreviewIcon } from './app-icons.mjs';

const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const icon = (document, name, size) => createPreviewIcon({ document, name, size });
const money = item => `${Number(item.price)} ${item.currency}`;
import { renderAppEmptyState, renderInlineNotice } from './app-empty-state.mjs';
const emptyState = (document, text) => renderAppEmptyState({ document, app: 'shop', title: text, compact: true });

function fundsState(item, walletView) {
  if (Number(item.price) === 0) return Object.freeze({ kind: 'free', label: 'FREE', canCheckout: true });
  const balance = walletView?.knownBalances?.[item.currency] || null;
  if (!balance) return Object.freeze({ kind: 'unknown', label: 'ยอดเงินไม่พร้อมใช้งาน', canCheckout: false });
  if (Number(balance.amount) < Number(item.price)) return Object.freeze({ kind: 'insufficient', label: 'ยอดเงินไม่เพียงพอ', canCheckout: false });
  return Object.freeze({ kind: 'sufficient', label: 'พร้อมสั่งซื้อ', canCheckout: true });
}

export function renderShop({ document, view = { items: [], orders: [] }, walletView = { knownBalances: {} }, authorizationGranted = true, error = null, selectedRecordId = null, confirmationRecordId = null, staleRecordId = null, checkoutResult = null, checkoutBusy = false, onSelect, onRequestCheckout, onCancelCheckout, onConfirmCheckout, onRefreshItem }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-shop';
  if (!authorizationGranted) { root.append(emptyState(document, 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return root; }
  if (error) root.append(renderInlineNotice({ document, tone:'error', title:'ร้านค้ายังไม่พร้อมใช้งาน', detail:'ข้อมูลเดิมยังอยู่ ลองกลับเข้ามาใหม่อีกครั้ง' }));
  const items = view.items || [];

  const search = el(document, 'label'); search.className = 'tmrw-phone-shop-search'; search.append(icon(document, 'search', 20)); const searchInput = el(document, 'input'); searchInput.type = 'search'; searchInput.placeholder = 'ค้นหาในร้าน...'; searchInput.setAttribute('aria-label', 'ค้นหาสินค้าในร้าน'); const filter = el(document, 'button'); filter.type = 'button'; filter.disabled = true; filter.setAttribute('aria-label', 'ตัวกรองยังไม่มีข้อมูล'); filter.append(icon(document, 'settings', 19)); search.append(searchInput, filter); root.append(search);

  const chips = el(document, 'div'); chips.className = 'tmrw-phone-commerce-chips tmrw-phone-shop-categories';
  for (const [id, label, name] of [['all','แนะนำ','sparkle'],['food','อาหาร','coffee'],['daily','ของใช้','bag'],['gift','ของขวัญ','gift'],['digital','ดิจิทัล','phone']]) { const button = el(document, 'button'); button.type = 'button'; button.className = id === 'all' ? 'is-active' : ''; button.disabled = id !== 'all'; if (id !== 'all') button.setAttribute('aria-label', `${label}ยังไม่มีข้อมูลหมวดหมู่`); button.append(icon(document, name, 15), el(document, 'span', label)); chips.append(button); }
  root.append(chips);

  const promo = el(document, 'section'); promo.className = 'tmrw-phone-shop-promo'; const promoCopy = el(document, 'span'); promoCopy.append(el(document, 'small', 'โปรโมชั่น ✦'), el(document, 'strong', 'ยังไม่มีโปรโมชั่นที่ยืนยันแล้ว'), el(document, 'em', 'จะแสดงที่นี่เมื่อมีข้อมูลจริง')); const promoArt = el(document, 'div'); promoArt.className = 'tmrw-phone-shop-bag-art'; promoArt.setAttribute('aria-hidden', 'true'); promoArt.append(el(document, 'b', 'TMRW'), el(document, 'i', '—')); promo.append(promoCopy, promoArt); root.append(promo);

  const productSection = el(document, 'section'); productSection.className = 'tmrw-phone-commerce-section tmrw-phone-shop-products-section'; const productHeader = el(document, 'header'); productHeader.append(el(document, 'h2', 'คัดสรรสำหรับคุณ'), el(document, 'small', `${items.length} รายการ`)); productSection.append(productHeader); const grid = el(document, 'div'); grid.className = 'tmrw-phone-shop-grid';
  const cards = [];
  for (const item of items) {
    const card = el(document, 'article'); card.className = 'tmrw-phone-shop-product'; card.dataset.shopRecordId = item.recordId;
    const art = el(document, 'button'); art.type = 'button'; art.className = 'tmrw-phone-shop-product-art'; art.setAttribute('aria-label', `เปิด ${item.name}`); art.append(icon(document, 'bag', 34)); art.addEventListener('click', () => onSelect?.(item.recordId));
    const copy = el(document, 'div'); copy.className = 'tmrw-phone-shop-product-copy'; const text = el(document, 'span'); text.append(el(document, 'strong', item.name), el(document, 'small', item.description || 'ไม่มีรายละเอียดเพิ่มเติม'), el(document, 'b', money(item))); const actions = el(document, 'div'); const favorite = el(document, 'button'); favorite.type = 'button'; favorite.disabled = true; favorite.setAttribute('aria-label', 'รายการโปรดยังไม่พร้อมใช้งาน'); favorite.append(icon(document, 'heart', 17)); const select = el(document, 'button'); select.type = 'button'; select.className = item.recordId === selectedRecordId ? 'is-active' : ''; select.setAttribute('aria-label', `เลือก ${item.name}`); select.append(icon(document, item.recordId === selectedRecordId ? 'check' : 'cart', 18)); select.addEventListener('click', () => onSelect?.(item.recordId)); actions.append(favorite, select); copy.append(text, actions); card.append(art, copy); grid.append(card); cards.push({ card, item });
  }
  if (items.length === 0) { const empty = el(document, 'div'); empty.className = 'tmrw-phone-shop-empty'; empty.append(icon(document, 'search', 30), el(document, 'strong', 'ยังไม่มีสินค้า'), el(document, 'small', 'สินค้าจริงจะปรากฏที่นี่')); grid.append(empty); }
  productSection.append(grid); root.append(productSection);
  searchInput.addEventListener('input', () => { const q = String(searchInput.value || '').trim().toLocaleLowerCase(); for (const { card, item } of cards) card.hidden = Boolean(q) && !`${item.name} ${item.description || ''}`.toLocaleLowerCase().includes(q); });

  const selected = items.find(item => item.recordId === selectedRecordId) || null;
  const cart = el(document, 'section'); cart.className = `tmrw-phone-shop-cart-summary ${selected ? 'has-items' : ''}`; cart.dataset.shopCart = selected?.recordId || '';
  const thumb = el(document, 'span'); const thumbIcon = el(document, 'i'); thumbIcon.append(icon(document, selected ? 'bag' : 'cart', 19)); thumb.append(thumbIcon); const cartCopy = el(document, 'b', selected ? `${selected.name} · ${money(selected)}` : 'เลือกสินค้าเพื่อดูคำสั่งซื้อ'); cart.append(thumb, cartCopy, icon(document, 'chevron', 15)); root.append(cart);

  if (!selected) return root;
  const details = el(document, 'section'); details.className = 'tmrw-v3-shop-details tmrw-phone-commerce-section'; details.dataset.shopDetailsId = selected.recordId; const heading = el(document, 'header'); heading.append(el(document, 'h2', selected.name)); details.append(heading); if (selected.description) details.append(el(document, 'p', selected.description)); details.append(el(document, 'strong', money(selected))); const funds = fundsState(selected, walletView); const fundsLine = el(document, 'p', funds.label); fundsLine.dataset.fundsState = funds.kind; details.append(fundsLine);
  if (staleRecordId === selected.recordId) { const stale = el(document, 'p', 'รายการนี้มีการเปลี่ยนแปลง กรุณารีเฟรชก่อนยืนยัน'); stale.setAttribute('role', 'alert'); const refresh = el(document, 'button', 'รีเฟรชสินค้า'); refresh.type = 'button'; refresh.dataset.shopAction = 'refresh-item'; refresh.addEventListener('click', () => onRefreshItem?.(selected.recordId)); details.append(stale, refresh); }
  else if (confirmationRecordId === selected.recordId) { const confirmation = el(document, 'section'); confirmation.className = 'tmrw-v3-shop-confirmation tmrw-phone-shop-cart-summary has-items'; confirmation.dataset.shopConfirmationId = selected.recordId; confirmation.append(el(document, 'span', 'ยืนยันคำสั่งซื้อ'), el(document, 'b', money(selected))); const cancel = el(document, 'button', 'ยกเลิก'); cancel.type = 'button'; cancel.dataset.shopAction = 'cancel-checkout'; cancel.addEventListener('click', () => onCancelCheckout?.()); const confirm = el(document, 'button', checkoutBusy ? 'กำลังสร้างคำสั่งซื้อ…' : 'ยืนยันคำสั่งซื้อ'); confirm.type = 'button'; confirm.dataset.shopAction = 'confirm-checkout'; confirm.disabled = checkoutBusy || !funds.canCheckout; let busy = false; confirm.addEventListener('click', () => { if (busy || confirm.disabled) return; busy = true; confirm.disabled = true; void Promise.resolve(onConfirmCheckout?.(selected)).finally(() => { busy = false; }); }); confirmation.append(cancel, confirm); details.append(confirmation); }
  else { const checkout = el(document, 'button', 'ตรวจสอบคำสั่งซื้อ'); checkout.type = 'button'; checkout.dataset.shopAction = 'review-checkout'; checkout.addEventListener('click', () => onRequestCheckout?.(selected.recordId)); details.append(checkout); }
  if (checkoutResult?.order?.shopItemId === selected.recordId) { const success = el(document, 'section'); success.className = 'tmrw-v3-shop-success'; success.setAttribute('role', 'status'); success.append(el(document, 'strong', 'สร้างคำสั่งซื้อแล้ว'), el(document, 'p', checkoutResult.order.status)); details.append(success); }
  root.append(details);

  if ((view.orders || []).length) { const orders = el(document, 'section'); orders.className = 'tmrw-phone-commerce-section'; const h = el(document, 'header'); h.append(el(document, 'h2', 'คำสั่งซื้อ')); orders.append(h); for (const order of view.orders) { const row = el(document, 'div'); row.className = 'tmrw-phone-wallet-transaction'; row.dataset.shopOrderId = order.recordId; row.append(el(document, 'span', `${order.quantity} × ${Number(order.unitPrice)} ${order.currency}`), el(document, 'b', order.status)); orders.append(row); } root.append(orders); }
  return root;
}
