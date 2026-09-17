import { renderAppEmptyState, renderInlineNotice } from './app-empty-state.mjs';
const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };

export function renderGallery({ document, items = [], authorizationGranted = true, error = null, selectedRecordId = null, pendingRemovalRecordId = null, onOpen, onRequestRemove, onCancelRemove, onConfirmRemove }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-gallery';
  if (!authorizationGranted) { root.append(renderAppEmptyState({ document, app:'gallery', title:'อัลบั้มของเครื่องนี้ถูกล็อกอยู่', detail:'กลับไปยังโทรศัพท์ของผู้เล่นหรือปลดสิทธิ์การเข้าถึงก่อนเปิดภาพ' })); return root; }
  if (error) { root.append(renderInlineNotice({ document, tone:'error', title:'เปิด Gallery ยังไม่สำเร็จ', detail:'ภาพเดิมยังอยู่ ลองกลับเข้ามาใหม่อีกครั้ง' })); return root; }
  const selected = items.find(item => item.recordId === selectedRecordId) || null;
  if (!selected) {
    if (items.length === 0) {
      const empty = el(document, 'section'); empty.className = 'tmrw-v3-gallery-empty'; empty.dataset.state = 'empty';
      const contactSheet = el(document, 'div'); contactSheet.className = 'tmrw-v3-gallery-empty-sheet'; contactSheet.setAttribute('aria-hidden', 'true');
      for (const tone of ['warm', 'sky', 'ink', 'mist', 'sun']) { const frame = el(document, 'i'); frame.className = `is-${tone}`; contactSheet.append(frame); }
      const copy = el(document, 'div'); copy.append(el(document, 'strong', 'อัลบั้มยังว่างอยู่'), el(document, 'p', 'ภาพที่ถูกบันทึกจากเรื่องราวจะค่อย ๆ มาอยู่ตรงนี้'));
      empty.append(contactSheet, copy); root.append(empty); return root;
    }
    const list = el(document, 'div'); list.className = 'tmrw-phone-utility-list tmrw-v3-gallery-grid';
    for (const item of items) {
      const button = el(document, 'button'); button.type = 'button'; button.className = 'tmrw-v3-gallery-item'; button.dataset.galleryRecordId = item.recordId; button.setAttribute('aria-label', `Open ${item.label || 'saved asset'}`);
      const copy = el(document, 'span'); copy.append(el(document, 'strong', item.label || 'Saved asset'), el(document, 'small', item.provenance?.locationLabel || item.provenance?.source || item.sourceKind || 'Saved asset')); button.append(copy); button.addEventListener('click', () => onOpen?.(item.recordId)); list.append(button);
    }
    root.append(list); return root;
  }
  const details = el(document, 'section'); details.className = 'tmrw-v3-gallery-details tmrw-phone-personal-detail'; details.dataset.galleryDetailsId = selected.recordId;
  details.append(el(document, 'h3', selected.label || 'Saved asset'));
  const provenance = [selected.provenance?.locationLabel, selected.provenance?.takenAt].filter(Boolean).join(' · '); if (provenance) details.append(el(document, 'p', provenance));
  if (selected.assetRef) { const reference = el(document, 'p', selected.assetRef); reference.className = 'tmrw-v3-asset-reference'; reference.dataset.assetRef = selected.assetRef; details.append(reference); }
  if (pendingRemovalRecordId === selected.recordId) {
    details.append(el(document, 'p', 'Remove this item from Gallery?'));
    const cancel = el(document, 'button', 'Cancel'); cancel.type = 'button'; cancel.dataset.galleryAction = 'cancel-remove'; cancel.addEventListener('click', () => onCancelRemove?.());
    const confirm = el(document, 'button', 'Remove'); confirm.type = 'button'; confirm.dataset.galleryAction = 'confirm-remove'; confirm.setAttribute('aria-label', `Remove ${selected.label || 'saved asset'} from this phone Gallery`); let busy = false; confirm.addEventListener('click', () => { if (busy || confirm.disabled) return; busy = true; confirm.disabled = true; void Promise.resolve(onConfirmRemove?.(selected)).finally(() => { busy = false; }); }); details.append(cancel, confirm);
  } else { const remove = el(document, 'button', 'Remove'); remove.type = 'button'; remove.dataset.galleryAction = 'request-remove'; remove.setAttribute('aria-label', `Remove ${selected.label || 'saved asset'} from this phone Gallery`); remove.addEventListener('click', () => onRequestRemove?.(selected.recordId)); details.append(remove); }
  root.append(details); return root;
}
