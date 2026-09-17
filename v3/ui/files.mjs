import { renderAppEmptyState, renderInlineNotice } from './app-empty-state.mjs';

const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };

export function renderFiles({ document, items = [], authorizationGranted = true, error = null, selectedRecordId = null, pendingRemovalRecordId = null, onOpen, onRequestRemove, onCancelRemove, onConfirmRemove }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-files';
  if (!authorizationGranted) { root.append(renderAppEmptyState({ document, app: 'files', title: 'ไฟล์ของเครื่องนี้ถูกล็อกอยู่', detail: 'กลับไปยังโทรศัพท์ของผู้เล่นหรือปลดสิทธิ์การเข้าถึงก่อนเปิดไฟล์' })); return root; }
  if (error) { root.append(renderInlineNotice({ document, tone: 'error', title: 'เปิดไฟล์ยังไม่สำเร็จ', detail: 'ข้อมูลเดิมยังอยู่ ลองกลับเข้ามาใหม่อีกครั้ง' })); return root; }
  const selected = items.find(item => item.recordId === selectedRecordId) || null;
  if (!selected) {
    if (items.length === 0) { root.append(renderAppEmptyState({ document, app: 'files' })); return root; }
    const list = el(document, 'div'); list.className = 'tmrw-phone-utility-list tmrw-v3-files-list';
    for (const item of items) { const button = el(document, 'button'); button.type = 'button'; button.dataset.fileRecordId = item.recordId; button.setAttribute('aria-label', `Open ${item.name}`); const copy = el(document, 'span'); copy.append(el(document, 'strong', item.name), el(document, 'small', `${item.folder || 'root'} · ${item.fileKind}`)); button.append(copy); button.addEventListener('click', () => onOpen?.(item.recordId)); list.append(button); }
    root.append(list); return root;
  }
  const details = el(document, 'section'); details.className = 'tmrw-v3-file-details tmrw-phone-personal-detail'; details.dataset.fileDetailsId = selected.recordId; details.append(el(document, 'h3', selected.name));
  if (selected.fileKind === 'text') details.append(el(document, 'pre', selected.contentText || ''));
  else if (selected.fileKind === 'asset-ref' || selected.fileKind === 'export') { const reference = el(document, 'p', selected.assetRef || 'Asset reference unavailable'); reference.className = 'tmrw-v3-asset-reference'; reference.dataset.assetRef = selected.assetRef || ''; details.append(reference); }
  else { const unsupported = el(document, 'p', `Unsupported file type: ${selected.fileKind || 'unknown'}`); unsupported.className = 'tmrw-v3-file-unsupported'; unsupported.setAttribute('role', 'status'); details.append(unsupported); }
  if (pendingRemovalRecordId === selected.recordId) {
    details.append(el(document, 'p', 'Remove this file from this phone?'));
    const cancel = el(document, 'button', 'Cancel'); cancel.type = 'button'; cancel.dataset.fileAction = 'cancel-remove'; cancel.addEventListener('click', () => onCancelRemove?.());
    const confirm = el(document, 'button', 'Remove file'); confirm.type = 'button'; confirm.dataset.fileAction = 'confirm-remove'; confirm.setAttribute('aria-label', `Remove ${selected.name} from this phone Files`); let busy = false; confirm.addEventListener('click', () => { if (busy || confirm.disabled) return; busy = true; confirm.disabled = true; void Promise.resolve(onConfirmRemove?.(selected)).finally(() => { busy = false; }); }); details.append(cancel, confirm);
  } else { const remove = el(document, 'button', 'Remove file'); remove.type = 'button'; remove.dataset.fileAction = 'request-remove'; remove.setAttribute('aria-label', `Remove ${selected.name} from this phone Files`); remove.addEventListener('click', () => onRequestRemove?.(selected.recordId)); details.append(remove); }
  root.append(details); return root;
}
