const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };

export function renderFiles({ document, items = [], authorizationGranted = true, error = null, selectedRecordId = null, pendingRemovalRecordId = null, onOpen, onRequestRemove, onCancelRemove, onConfirmRemove }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-files';
  if (!authorizationGranted) { root.append(el(document, 'p', 'Files are unavailable until access to this phone is granted.')); return root; }
  if (error) { const alert = el(document, 'p', `Files error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); return root; }
  if (items.length === 0) { root.append(el(document, 'p', 'No phone-world files on this device yet. Files does not manufacture sample rows.')); return root; }

  const list = el(document, 'ul'); list.className = 'tmrw-v3-files-list';
  for (const item of items) {
    const row = el(document, 'li'); const button = el(document, 'button'); button.type = 'button'; button.dataset.fileRecordId = item.recordId; button.setAttribute('aria-label', `Open ${item.name}`);
    button.append(el(document, 'strong', item.name), el(document, 'small', `${item.folder || 'root'} · ${item.fileKind}`)); button.addEventListener('click', () => onOpen?.(item.recordId)); row.append(button); list.append(row);
  }
  root.append(list);

  const selected = items.find(item => item.recordId === selectedRecordId) || null;
  if (!selected) return root;
  const details = el(document, 'section'); details.className = 'tmrw-v3-file-details'; details.dataset.fileDetailsId = selected.recordId;
  details.append(el(document, 'h3', selected.name), el(document, 'p', `Source: ${selected.provenance?.source || selected.sourceKind || 'explicit phone-world state'}`));
  if (selected.fileKind === 'text') details.append(el(document, 'pre', selected.contentText || 'This text file is empty.'));
  else if (selected.fileKind === 'asset-ref' || selected.fileKind === 'export') {
    details.append(el(document, 'p', selected.fileKind === 'export' ? 'Explicit exported asset reference. Binary content is not duplicated into Files.' : 'Asset reference. Binary content is not duplicated into Files.'));
    const reference = el(document, 'p', `Asset reference: ${selected.assetRef}`); reference.className = 'tmrw-v3-asset-reference'; reference.dataset.assetRef = selected.assetRef; details.append(reference);
  } else {
    const unsupported = el(document, 'p', `Unsupported file type: ${selected.fileKind || 'unknown'}. This item cannot be opened in this build.`); unsupported.className = 'tmrw-v3-file-unsupported'; unsupported.setAttribute('role', 'status'); details.append(unsupported);
  }
  if (pendingRemovalRecordId === selected.recordId) {
    details.append(el(document, 'p', 'Remove this file from this phone? This does not delete a referenced canonical asset.'));
    const cancel = el(document, 'button', 'Cancel'); cancel.type = 'button'; cancel.dataset.fileAction = 'cancel-remove'; cancel.setAttribute('aria-label', `Cancel removing ${selected.name} from this phone`); cancel.addEventListener('click', () => onCancelRemove?.());
    const confirm = el(document, 'button', 'Remove file'); confirm.type = 'button'; confirm.dataset.fileAction = 'confirm-remove'; confirm.setAttribute('aria-label', `Remove ${selected.name} from this phone Files`); let busy = false; confirm.addEventListener('click', () => { if (busy || confirm.disabled) return; busy = true; confirm.disabled = true; void Promise.resolve(onConfirmRemove?.(selected)).finally(() => { busy = false; }); });
    details.append(cancel, confirm);
  } else {
    const remove = el(document, 'button', 'Remove file'); remove.type = 'button'; remove.dataset.fileAction = 'request-remove'; remove.setAttribute('aria-label', `Remove ${selected.name} from this phone Files`); remove.addEventListener('click', () => onRequestRemove?.(selected.recordId)); details.append(remove);
  }
  root.append(details); return root;
}
