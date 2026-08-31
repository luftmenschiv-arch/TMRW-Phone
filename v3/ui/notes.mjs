const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };

export function renderNotes({ document, items = [], authorizationGranted = true, error = null, selectedRecordId = null, formMode = null, pendingDeleteRecordId = null, onOpen, onStartCreate, onStartEdit, onCancelForm, onSave, onRequestDelete, onCancelDelete, onConfirmDelete }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-notes';
  if (!authorizationGranted) { root.append(el(document, 'p', 'Notes are unavailable until access to this phone is granted.')); return root; }
  if (error) { const alert = el(document, 'p', `Notes error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); return root; }
  const selected = items.find(item => item.recordId === selectedRecordId) || null;

  const actions = el(document, 'div'); actions.className = 'tmrw-v3-notes-actions'; const create = el(document, 'button', 'New note'); create.type = 'button'; create.dataset.noteAction = 'new'; create.setAttribute('aria-label', 'Create a new private note'); create.addEventListener('click', () => onStartCreate?.()); actions.append(create); root.append(actions);

  if (formMode) {
    const editing = formMode === 'edit' && selected;
    const form = el(document, 'section'); form.className = 'tmrw-v3-note-form'; form.dataset.noteForm = editing ? 'edit' : 'new'; form.append(el(document, 'h3', editing ? 'Edit note' : 'New note'));
    const title = el(document, 'input'); title.type = 'text'; title.value = editing ? (selected.title || '') : ''; title.placeholder = 'Title'; title.setAttribute('aria-label', 'Note title');
    const body = el(document, 'textarea'); body.value = editing ? (selected.text || '') : ''; body.placeholder = 'Write a note…'; body.setAttribute('aria-label', 'Note text');
    const controls = el(document, 'div'); controls.className = 'tmrw-v3-note-form-controls'; const cancel = el(document, 'button', 'Cancel'); cancel.type = 'button'; cancel.dataset.noteAction = 'cancel-form'; cancel.addEventListener('click', () => onCancelForm?.()); const save = el(document, 'button', editing ? 'Save changes' : 'Create note'); save.type = 'button'; save.dataset.noteAction = 'save'; const sync = () => { save.disabled = !String(title.value || '').trim() && !String(body.value || '').trim(); }; title.addEventListener('input', sync); body.addEventListener('input', sync); sync(); let busy = false; save.addEventListener('click', () => { if (busy || save.disabled) return; busy = true; save.disabled = true; void Promise.resolve(onSave?.({ recordId: editing ? selected.recordId : null, title: String(title.value || '').trim(), text: String(body.value || '').trim() })).finally(() => { busy = false; }); }); controls.append(cancel, save); form.append(title, body, controls); root.append(form);
  }

  if (items.length === 0) { root.append(el(document, 'p', 'No private notes on this phone yet.')); return root; }
  const list = el(document, 'ul'); list.className = 'tmrw-v3-notes-list';
  for (const item of items) { const row = el(document, 'li'); const button = el(document, 'button', item.title || 'Untitled note'); button.type = 'button'; button.dataset.noteRecordId = item.recordId; button.setAttribute('aria-label', `Open note ${item.title || 'Untitled note'}`); button.addEventListener('click', () => onOpen?.(item.recordId)); row.append(button); list.append(row); }
  root.append(list);
  if (!selected) return root;

  const detail = el(document, 'section'); detail.className = 'tmrw-v3-note-details'; detail.dataset.noteDetailsId = selected.recordId; detail.append(el(document, 'h3', selected.title || 'Untitled note')); const body = el(document, 'pre', selected.text || ''); detail.append(body);
  if (pendingDeleteRecordId === selected.recordId) {
    detail.append(el(document, 'p', 'Delete this note from this phone? Canonical history remains immutable and recoverable by event history.'));
    const cancel = el(document, 'button', 'Cancel'); cancel.type = 'button'; cancel.dataset.noteAction = 'cancel-delete'; cancel.addEventListener('click', () => onCancelDelete?.()); const confirm = el(document, 'button', 'Delete note'); confirm.type = 'button'; confirm.dataset.noteAction = 'confirm-delete'; confirm.setAttribute('aria-label', `Delete note ${selected.title || 'Untitled note'}`); let busy = false; confirm.addEventListener('click', () => { if (busy || confirm.disabled) return; busy = true; confirm.disabled = true; void Promise.resolve(onConfirmDelete?.(selected)).finally(() => { busy = false; }); }); detail.append(cancel, confirm);
  } else {
    const edit = el(document, 'button', 'Edit'); edit.type = 'button'; edit.dataset.noteAction = 'edit'; edit.addEventListener('click', () => onStartEdit?.()); const remove = el(document, 'button', 'Delete'); remove.type = 'button'; remove.dataset.noteAction = 'request-delete'; remove.setAttribute('aria-label', `Delete note ${selected.title || 'Untitled note'}`); remove.addEventListener('click', () => onRequestDelete?.(selected.recordId)); detail.append(edit, remove);
  }
  root.append(detail); return root;
}
