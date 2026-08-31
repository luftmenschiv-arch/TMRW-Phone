const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };

export function renderGallery({ document, items = [], authorizationGranted = true, error = null, selectedRecordId = null, pendingRemovalRecordId = null, onOpen, onRequestRemove, onCancelRemove, onConfirmRemove }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-gallery';
  if (!authorizationGranted) { root.append(el(document, 'p', 'Gallery is unavailable until access to this phone is granted.')); return root; }
  if (error) { const alert = el(document, 'p', `Gallery error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); return root; }
  if (items.length === 0) { root.append(el(document, 'p', 'No saved assets on this phone yet. Gallery never invents sample photos.')); return root; }

  const grid = el(document, 'div'); grid.className = 'tmrw-v3-gallery-grid';
  for (const item of items) {
    const button = el(document, 'button'); button.type = 'button'; button.className = 'tmrw-v3-gallery-item'; button.dataset.galleryRecordId = item.recordId;
    button.setAttribute('aria-label', `Open ${item.label || 'saved asset'}`);
    button.append(el(document, 'strong', item.label || 'Saved asset'), el(document, 'small', item.provenance?.source || item.sourceKind || 'Explicit asset'));
    button.addEventListener('click', () => onOpen?.(item.recordId)); grid.append(button);
  }
  root.append(grid);

  const selected = items.find(item => item.recordId === selectedRecordId) || null;
  if (!selected) return root;
  const details = el(document, 'section'); details.className = 'tmrw-v3-gallery-details'; details.dataset.galleryDetailsId = selected.recordId;
  details.append(el(document, 'h3', selected.label || 'Saved asset'));
  const provenance = [selected.provenance?.source, selected.provenance?.locationLabel, selected.provenance?.takenAt].filter(Boolean).join(' · ');
  details.append(el(document, 'p', provenance ? `Provenance: ${provenance}` : 'Provenance: explicit phone-world asset reference.'));
  const reference = el(document, 'p', `Asset reference: ${selected.assetRef}`); reference.className = 'tmrw-v3-asset-reference'; reference.dataset.assetRef = selected.assetRef; details.append(reference);
  if (pendingRemovalRecordId === selected.recordId) {
    details.append(el(document, 'p', 'Remove this asset from this phone Gallery? The canonical/shared asset itself will not be deleted.'));
    const cancel = el(document, 'button', 'Cancel'); cancel.type = 'button'; cancel.dataset.galleryAction = 'cancel-remove'; cancel.setAttribute('aria-label', `Cancel removing ${selected.label || 'saved asset'} from this phone`); cancel.addEventListener('click', () => onCancelRemove?.());
    const confirm = el(document, 'button', 'Remove from this phone'); confirm.type = 'button'; confirm.dataset.galleryAction = 'confirm-remove'; confirm.setAttribute('aria-label', `Remove ${selected.label || 'saved asset'} from this phone Gallery`); let busy = false; confirm.addEventListener('click', () => { if (busy || confirm.disabled) return; busy = true; confirm.disabled = true; void Promise.resolve(onConfirmRemove?.(selected)).finally(() => { busy = false; }); });
    details.append(cancel, confirm);
  } else {
    const remove = el(document, 'button', 'Remove from this phone'); remove.type = 'button'; remove.dataset.galleryAction = 'request-remove'; remove.setAttribute('aria-label', `Remove ${selected.label || 'saved asset'} from this phone Gallery`); remove.addEventListener('click', () => onRequestRemove?.(selected.recordId)); details.append(remove);
  }
  root.append(details); return root;
}
