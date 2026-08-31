const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const money = item => `${Number(item.price)} ${item.currency}`;

function fundsState(item, walletView) {
  if (Number(item.price) === 0) return Object.freeze({ kind: 'free', label: 'FREE ITEM', canCheckout: true });
  const balance = walletView?.knownBalances?.[item.currency] || null;
  if (!balance) return Object.freeze({ kind: 'unknown', label: 'UNKNOWN FUNDS', canCheckout: false });
  if (Number(balance.amount) < Number(item.price)) return Object.freeze({ kind: 'insufficient', label: 'INSUFFICIENT KNOWN FUNDS', canCheckout: false });
  return Object.freeze({ kind: 'sufficient', label: 'SUFFICIENT KNOWN FUNDS', canCheckout: true });
}

export function renderShop({ document, view = { items: [], orders: [] }, walletView = { knownBalances: {} }, authorizationGranted = true, error = null, selectedRecordId = null, confirmationRecordId = null, staleRecordId = null, checkoutResult = null, checkoutBusy = false, onSelect, onRequestCheckout, onCancelCheckout, onConfirmCheckout, onRefreshItem }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-shop';
  if (!authorizationGranted) { root.append(el(document, 'p', 'Shop is unavailable until access to this phone is granted. Private orders and Wallet state remain hidden.')); return root; }
  if (error) { const alert = el(document, 'p', `Shop error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); }
  if ((view.items || []).length === 0) { root.append(el(document, 'p', 'No canonical Shop catalog is available on this phone. TMRW does not generate fallback merchandise.')); return root; }

  const list = el(document, 'div'); list.className = 'tmrw-v3-shop-catalog';
  for (const item of view.items) {
    const button = el(document, 'button'); button.type = 'button'; button.className = 'tmrw-v3-shop-item'; button.dataset.shopRecordId = item.recordId; button.setAttribute('aria-label', `Open Shop item ${item.name}, ${money(item)}`);
    button.append(el(document, 'strong', item.name), el(document, 'span', money(item)), el(document, 'small', item.sourceKind || 'Canonical Shop catalog'));
    button.addEventListener('click', () => onSelect?.(item.recordId)); list.append(button);
  }
  root.append(list);

  const selected = view.items.find(item => item.recordId === selectedRecordId) || null;
  if (!selected) return root;
  const details = el(document, 'section'); details.className = 'tmrw-v3-shop-details'; details.dataset.shopDetailsId = selected.recordId;
  details.append(el(document, 'h3', selected.name));
  if (selected.description) details.append(el(document, 'p', selected.description));
  details.append(el(document, 'p', `Canonical price: ${money(selected)}`), el(document, 'p', `Source: ${selected.sourceKind || 'Canonical Shop catalog'}`));
  const funds = fundsState(selected, walletView); const fundsLine = el(document, 'p', funds.label); fundsLine.dataset.fundsState = funds.kind; details.append(fundsLine);

  if (staleRecordId === selected.recordId) {
    const stale = el(document, 'p', 'ITEM CHANGED — refresh the canonical item and confirm again. The changed price was not accepted automatically.'); stale.setAttribute('role', 'alert'); details.append(stale);
    const refresh = el(document, 'button', 'Refresh item'); refresh.type = 'button'; refresh.dataset.shopAction = 'refresh-item'; refresh.setAttribute('aria-label', `Refresh ${selected.name} from canonical catalog`); refresh.addEventListener('click', () => onRefreshItem?.(selected.recordId)); details.append(refresh);
  } else if (confirmationRecordId === selected.recordId) {
    const confirmation = el(document, 'section'); confirmation.className = 'tmrw-v3-shop-confirmation'; confirmation.dataset.shopConfirmationId = selected.recordId;
    confirmation.append(el(document, 'p', `Confirm this order at ${money(selected)}. This does not imply shipping, delivery, or inventory ownership.`));
    const cancel = el(document, 'button', 'Cancel'); cancel.type = 'button'; cancel.dataset.shopAction = 'cancel-checkout'; cancel.addEventListener('click', () => onCancelCheckout?.());
    const confirm = el(document, 'button', checkoutBusy ? 'Creating order…' : 'Confirm order'); confirm.type = 'button'; confirm.dataset.shopAction = 'confirm-checkout'; confirm.disabled = checkoutBusy || !funds.canCheckout; confirm.setAttribute('aria-label', `Confirm order for ${selected.name} at ${money(selected)}`);
    if (!funds.canCheckout) confirm.setAttribute('aria-description', funds.kind === 'unknown' ? 'Wallet balance is unknown for this currency' : 'Known Wallet funds are insufficient');
    let busy = false; confirm.addEventListener('click', () => { if (busy || confirm.disabled) return; busy = true; confirm.disabled = true; void Promise.resolve(onConfirmCheckout?.(selected)).finally(() => { busy = false; }); });
    confirmation.append(cancel, confirm); details.append(confirmation);
  } else {
    const checkout = el(document, 'button', 'Review order'); checkout.type = 'button'; checkout.dataset.shopAction = 'review-checkout'; checkout.setAttribute('aria-label', `Review order for ${selected.name} at ${money(selected)}`); checkout.addEventListener('click', () => onRequestCheckout?.(selected.recordId)); details.append(checkout);
  }

  if (checkoutResult?.order?.shopItemId === selected.recordId) {
    const success = el(document, 'section'); success.className = 'tmrw-v3-shop-success'; success.setAttribute('role', 'status');
    success.append(el(document, 'strong', 'Order created'), el(document, 'p', `Order status: ${checkoutResult.order.status}.`));
    if (checkoutResult.walletDebit) success.append(el(document, 'p', `Linked Wallet debit: ${Number(checkoutResult.walletDebit.amount)} ${checkoutResult.walletDebit.currency}.`));
    else success.append(el(document, 'p', 'No Wallet debit was created for this free item.'));
    details.append(success);
  }
  root.append(details);

  if ((view.orders || []).length > 0) {
    const orders = el(document, 'section'); orders.className = 'tmrw-v3-shop-orders'; orders.append(el(document, 'h3', 'Orders'));
    const ul = el(document, 'ul'); for (const order of view.orders) { const li = el(document, 'li', `${order.status}: ${order.quantity} × ${Number(order.unitPrice)} ${order.currency}`); li.dataset.shopOrderId = order.recordId; ul.append(li); } orders.append(ul); root.append(orders);
  }
  return root;
}
