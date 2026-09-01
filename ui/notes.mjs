const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const TONES = Object.freeze(['peach', 'cream', 'mint', 'sky', 'sand', 'rose', 'lavender']);

export function renderNotes({ document, items = [], authorizationGranted = true, error = null, selectedRecordId = null, formMode = null, pendingDeleteRecordId = null, onOpen, onStartCreate, onStartEdit, onCancelForm, onSave, onRequestDelete, onCancelDelete, onConfirmDelete }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-notes tmrw-phone-personal-app tmrw-phone-notes-board';
  if (!authorizationGranted) { root.append(el(document, 'p', 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return root; }
  if (error) { const alert = el(document, 'p', `Notes error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); return root; }
  const selected = items.find(item => item.recordId === selectedRecordId) || null;

  if (formMode) {
    const editing = formMode === 'edit' && selected;
    const form = el(document, 'section'); form.className = 'tmrw-v3-note-form tmrw-phone-personal-detail'; form.dataset.noteForm = editing ? 'edit' : 'new'; form.append(el(document, 'h3', editing ? 'Edit note' : 'New note'));
    const title = el(document, 'input'); title.type = 'text'; title.value = editing ? (selected.title || '') : ''; title.placeholder = 'Title'; title.setAttribute('aria-label', 'Note title');
    const body = el(document, 'textarea'); body.value = editing ? (selected.text || '') : ''; body.placeholder = 'Write a note…'; body.setAttribute('aria-label', 'Note text');
    const controls = el(document, 'div'); controls.className = 'tmrw-v3-note-form-controls';
    const cancel = el(document, 'button', 'Cancel'); cancel.type = 'button'; cancel.dataset.noteAction = 'cancel-form'; cancel.addEventListener('click', () => onCancelForm?.());
    const save = el(document, 'button', editing ? 'Save changes' : 'Create note'); save.type = 'button'; save.dataset.noteAction = 'save';
    const sync = () => { save.disabled = !String(title.value || '').trim() && !String(body.value || '').trim(); }; title.addEventListener('input', sync); body.addEventListener('input', sync); sync();
    let busy = false; save.addEventListener('click', () => { if (busy || save.disabled) return; busy = true; save.disabled = true; void Promise.resolve(onSave?.({ recordId: editing ? selected.recordId : null, title: String(title.value || '').trim(), text: String(body.value || '').trim() })).finally(() => { busy = false; }); });
    controls.append(cancel, save); form.append(title, body, controls); root.append(form); return root;
  }

  if (selected) {
    const detail = el(document, 'section'); detail.className = 'tmrw-v3-note-details tmrw-phone-personal-detail'; detail.dataset.noteDetailsId = selected.recordId;
    detail.append(el(document, 'h3', selected.title || 'Untitled note'));
    const body = el(document, 'div', selected.text || ''); body.className = 'tmrw-phone-note-body'; detail.append(body);
    if (pendingDeleteRecordId === selected.recordId) {
      detail.append(el(document, 'p', 'Delete this note?'));
      const cancel = el(document, 'button', 'Cancel'); cancel.type = 'button'; cancel.dataset.noteAction = 'cancel-delete'; cancel.addEventListener('click', () => onCancelDelete?.());
      const confirm = el(document, 'button', 'Delete note'); confirm.type = 'button'; confirm.dataset.noteAction = 'confirm-delete'; confirm.setAttribute('aria-label', `Delete note ${selected.title || 'Untitled note'}`); let busy = false; confirm.addEventListener('click', () => { if (busy || confirm.disabled) return; busy = true; confirm.disabled = true; void Promise.resolve(onConfirmDelete?.(selected)).finally(() => { busy = false; }); }); detail.append(cancel, confirm);
    } else {
      const edit = el(document, 'button', 'Edit'); edit.type = 'button'; edit.dataset.noteAction = 'edit'; edit.addEventListener('click', () => onStartEdit?.());
      const remove = el(document, 'button', 'Delete'); remove.type = 'button'; remove.dataset.noteAction = 'request-delete'; remove.setAttribute('aria-label', `Delete note ${selected.title || 'Untitled note'}`); remove.addEventListener('click', () => onRequestDelete?.(selected.recordId)); detail.append(edit, remove);
    }
    root.append(detail); return root;
  }

  if (items.length === 0) root.append(el(document, 'p', 'ยังไม่มีโน้ต'));
  else {
    const board = el(document, 'div'); board.className = 'tmrw-phone-note-board';
    items.forEach((item, index) => {
      const button = el(document, 'button'); button.type = 'button'; button.className = `tmrw-phone-note-board-card tone-${TONES[index % TONES.length]}`; button.dataset.noteRecordId = item.recordId; button.setAttribute('aria-label', `Open note ${item.title || 'Untitled note'}`);
      const meta = el(document, 'div'); meta.className = 'tmrw-phone-note-board-meta'; meta.append(el(document, 'span', 'NOTE'));
      button.append(meta, el(document, 'h3', item.title || 'Untitled note'), el(document, 'p', item.text || ''));
      button.addEventListener('click', () => onOpen?.(item.recordId)); board.append(button);
    }); root.append(board);
  }
  const create = el(document, 'button', '+'); create.type = 'button'; create.className = 'tmrw-phone-personal-fab'; create.dataset.noteAction = 'new'; create.setAttribute('aria-label', 'Create a new private note'); create.addEventListener('click', () => onStartCreate?.()); root.append(create);
  return root;
}
