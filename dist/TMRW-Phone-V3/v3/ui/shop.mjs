const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const money = item => `${Number(item.price)} ${item.currency}`;

function fundsState(item, walletView) {
  if (Number(item.price) === 0) return Object.freeze({ kind: 'free', label: 'FREE', canCheckout: true });
  const balance = walletView?.knownBalances?.[item.currency] || null;
  if (!balance) return Object.freeze({ kind: 'unknown', label: 'ยอดเงินไม่พร้อมใช้งาน', canCheckout: false });
  if (Number(balance.amount) < Number(item.price)) return Object.freeze({ kind: 'insufficient', label: 'ยอดเงินไม่เพียงพอ', canCheckout: false });
  return Object.freeze({ kind: 'sufficient', label: 'พร้อมสั่งซื้อ', canCheckout: true });
}

export function renderShop({ document, view = { items: [], orders: [] }, walletView = { knownBalances: {} }, authorizationGranted = true, error = null, selectedRecordId = null, confirmationRecordId = null, staleRecordId = null, checkoutResult = null, checkoutBusy = false, onSelect, onRequestCheckout, onCancelCheckout, onConfirmCheckout, onRefreshItem }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-shop';
  if (!authorizationGranted) { root.append(el(document, 'p', 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return root; }
  if (error) { const alert = el(document, 'p', `Shop error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); }
  const items = view.items || [];
  if (items.length === 0) { root.append(el(document, 'p', 'ยังไม่มีสินค้า')); return root; }

  const searchShell = el(document, 'div'); searchShell.className = 'tmrw-phone-shop-search'; searchShell.append(el(document, 'span', 'ร้านค้า')); root.append(searchShell);
  const list = el(document, 'div'); list.className = 'tmrw-v3-shop-catalog tmrw-phone-shop-grid';
  for (const item of items) {
    const card = el(document, 'article'); card.className = 'tmrw-phone-shop-product';
    const art = el(document, 'button'); art.type = 'button'; art.className = 'tmrw-phone-shop-product-art art-digital'; art.dataset.shopRecordId = item.recordId; art.setAttribute('aria-label', `Open Shop item ${item.name}, ${money(item)}`); art.append(el(document, 'strong', String(item.name || 'T').slice(0, 1).toUpperCase())); art.addEventListener('click', () => onSelect?.(item.recordId));
    const copy = el(document, 'div'); copy.className = 'tmrw-phone-shop-product-copy'; const span = el(document, 'span'); span.append(el(document, 'strong', item.name), el(document, 'small', item.description || ''), el(document, 'b', money(item))); copy.append(span); card.append(art, copy); list.append(card);
  }
  root.append(list);

  const selected = items.find(item => item.recordId === selectedRecordId) || null;
  if (!selected) return root;
  const details = el(document, 'section'); details.className = 'tmrw-v3-shop-details tmrw-phone-commerce-section'; details.dataset.shopDetailsId = selected.recordId;
  const heading = el(document, 'header'); heading.append(el(document, 'h2', selected.name)); details.append(heading); if (selected.description) details.append(el(document, 'p', selected.description)); details.append(el(document, 'strong', money(selected)));
  const funds = fundsState(selected, walletView); const fundsLine = el(document, 'p', funds.label); fundsLine.dataset.fundsState = funds.kind; details.append(fundsLine);
  if (staleRecordId === selected.recordId) {
    const stale = el(document, 'p', 'รายการนี้มีการเปลี่ยนแปลง กรุณารีเฟรชก่อนยืนยัน'); stale.setAttribute('role', 'alert'); details.append(stale);
    const refresh = el(document, 'button', 'Refresh item'); refresh.type = 'button'; refresh.dataset.shopAction = 'refresh-item'; refresh.addEventListener('click', () => onRefreshItem?.(selected.recordId)); details.append(refresh);
  } else if (confirmationRecordId === selected.recordId) {
    const confirmation = el(document, 'section'); confirmation.className = 'tmrw-v3-shop-confirmation tmrw-phone-shop-cart-summary has-items'; confirmation.dataset.shopConfirmationId = selected.recordId; confirmation.append(el(document, 'span', 'Confirm'), el(document, 'b', money(selected)));
    const cancel = el(document, 'button', 'Cancel'); cancel.type = 'button'; cancel.dataset.shopAction = 'cancel-checkout'; cancel.addEventListener('click', () => onCancelCheckout?.());
    const confirm = el(document, 'button', checkoutBusy ? 'Creating order…' : 'Confirm order'); confirm.type = 'button'; confirm.dataset.shopAction = 'confirm-checkout'; confirm.disabled = checkoutBusy || !funds.canCheckout; confirm.setAttribute('aria-label', `Confirm order for ${selected.name} at ${money(selected)}`); let busy = false; confirm.addEventListener('click', () => { if (busy || confirm.disabled) return; busy = true; confirm.disabled = true; void Promise.resolve(onConfirmCheckout?.(selected)).finally(() => { busy = false; }); }); confirmation.append(cancel, confirm); details.append(confirmation);
  } else { const checkout = el(document, 'button', 'Review order'); checkout.type = 'button'; checkout.dataset.shopAction = 'review-checkout'; checkout.setAttribute('aria-label', `Review order for ${selected.name} at ${money(selected)}`); checkout.addEventListener('click', () => onRequestCheckout?.(selected.recordId)); details.append(checkout); }
  if (checkoutResult?.order?.shopItemId === selected.recordId) { const success = el(document, 'section'); success.className = 'tmrw-v3-shop-success'; success.setAttribute('role', 'status'); success.append(el(document, 'strong', 'Order created'), el(document, 'p', checkoutResult.order.status)); details.append(success); }
  root.append(details);
  if ((view.orders || []).length > 0) { const orders = el(document, 'section'); orders.className = 'tmrw-v3-shop-orders tmrw-phone-commerce-section'; const h = el(document, 'header'); h.append(el(document, 'h2', 'Orders')); orders.append(h); const ul = el(document, 'ul'); for (const order of view.orders) { const li = el(document, 'li', `${order.status}: ${order.quantity} × ${Number(order.unitPrice)} ${order.currency}`); li.dataset.shopOrderId = order.recordId; ul.append(li); } orders.append(ul); root.append(orders); }
  return root;
}
