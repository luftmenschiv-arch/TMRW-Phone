const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };

function dueLabel(due) {
  if (!due) return 'No story-time due point';
  if (due.kind === 'absolute') return [due.localDate, due.localTime].filter(Boolean).join(' ') || 'Story-local time';
  if (due.kind === 'relative-offset') return `Story elapsed ${Math.round(due.targetElapsedMs / 60000)} min`;
  if (due.kind === 'ordinal') return `Story ordinal ${due.targetOrdinal}`;
  return 'Story-time due point';
}
function storyClockLabel(clock) {
  if (!clock) return 'Story time unavailable';
  if (clock.displayLocalDate || clock.displayLocalTime) return [clock.displayLocalDate, clock.displayLocalTime].filter(Boolean).join(' ');
  return `${clock.mode || 'Story'} · ${clock.ordinal ?? 0}`;
}

export function renderCalendar({ document, view, recipients = [], authorizationGranted = true, error = null, formMode = null, onStartForm, onCancelForm, onCreateReminder, onCreateInvitation, onAccept, onDecline }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-calendar';
  if (!authorizationGranted) { root.append(el(document, 'p', 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return root; }
  if (error) { const alert = el(document, 'p', `Calendar error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); return root; }

  const heading = el(document, 'header'); heading.className = 'tmrw-phone-calendar-heading'; const title = el(document, 'span'); title.append(el(document, 'h1', 'Calendar'), el(document, 'b', storyClockLabel(view?.clock))); heading.append(title);
  if (!formMode) { const add = el(document, 'button', '+'); add.type = 'button'; add.dataset.calendarAction = 'new-reminder'; add.setAttribute('aria-label', 'Create story-time reminder'); add.addEventListener('click', () => onStartForm?.('reminder')); heading.append(add); } root.append(heading);

  if (formMode) {
    const form = el(document, 'section'); form.className = 'tmrw-v3-calendar-form tmrw-phone-calendar-task-summary'; form.dataset.calendarForm = formMode; form.append(el(document, 'h3', formMode === 'invitation' ? 'New invitation' : 'New reminder'));
    const titleInput = el(document, 'input'); titleInput.type = 'text'; titleInput.setAttribute('aria-label', 'Calendar title'); titleInput.placeholder = 'Title';
    const date = el(document, 'input'); date.type = 'text'; date.setAttribute('aria-label', 'Story date'); date.placeholder = 'YYYY-MM-DD';
    const time = el(document, 'input'); time.type = 'text'; time.setAttribute('aria-label', 'Story time'); time.placeholder = 'HH:MM'; form.append(titleInput, date, time);
    const selectedRecipients = new Set();
    if (formMode === 'invitation') { const recipientBox = el(document, 'div'); recipientBox.className = 'tmrw-v3-calendar-recipients tmrw-phone-filter-chips'; if (recipients.length === 0) recipientBox.append(el(document, 'p', 'No contacts available')); for (const recipient of recipients) { const button = el(document, 'button', recipient.label); button.type = 'button'; button.dataset.calendarRecipientInstanceId = recipient.instanceId; button.setAttribute('aria-pressed', 'false'); button.addEventListener('click', () => { if (selectedRecipients.has(recipient.instanceId)) selectedRecipients.delete(recipient.instanceId); else selectedRecipients.add(recipient.instanceId); button.setAttribute('aria-pressed', String(selectedRecipients.has(recipient.instanceId))); }); recipientBox.append(button); } form.append(recipientBox); }
    const status = el(document, 'p'); status.className = 'tmrw-v3-calendar-form-status'; status.setAttribute('role', 'alert'); const controls = el(document, 'div'); controls.className = 'tmrw-v3-calendar-form-controls';
    const cancel = el(document, 'button', 'Cancel'); cancel.type = 'button'; cancel.dataset.calendarAction = 'cancel-create'; cancel.addEventListener('click', () => onCancelForm?.());
    const create = el(document, 'button', formMode === 'invitation' ? 'Create invitation' : 'Create reminder'); create.type = 'button'; create.dataset.calendarAction = 'submit-create'; let busy = false; create.addEventListener('click', () => { if (busy || create.disabled) return; const cleanTitle = String(titleInput.value || '').trim(); const localDate = String(date.value || '').trim(); const localTime = String(time.value || '').trim(); if (!cleanTitle || !localTime) { status.textContent = 'Title and story time are required.'; return; } if (formMode === 'invitation' && selectedRecipients.size === 0) { status.textContent = 'Choose at least one Contact.'; return; } busy = true; create.disabled = true; const due = { kind: 'absolute', localDate: localDate || null, localTime }; const action = formMode === 'invitation' ? onCreateInvitation?.({ title: cleanTitle, due, participantInstanceIds: [...selectedRecipients] }) : onCreateReminder?.({ title: cleanTitle, due }); void Promise.resolve(action).finally(() => { busy = false; }); }); controls.append(cancel, create); form.append(status, controls); root.append(form);
  } else {
    const secondary = el(document, 'div'); secondary.className = 'tmrw-v3-calendar-create-actions'; const invite = el(document, 'button', 'Add invitation'); invite.type = 'button'; invite.dataset.calendarAction = 'new-invitation'; invite.addEventListener('click', () => onStartForm?.('invitation')); secondary.append(invite); root.append(secondary);
  }

  const items = view?.items || [];
  if (items.length === 0) { const empty = el(document, 'section'); empty.className = 'tmrw-phone-calendar-empty'; empty.append(el(document, 'strong', 'No calendar items'), el(document, 'small', 'ยังไม่มีนัดหมายหรือเตือนความจำ')); root.append(empty); return root; }
  const agenda = el(document, 'section'); agenda.className = 'tmrw-phone-calendar-agenda'; const agendaHeader = el(document, 'header'); agendaHeader.append(el(document, 'h2', 'Agenda'), el(document, 'small', `${items.length}`)); agenda.append(agendaHeader);
  for (const item of items) { const row = el(document, 'article'); row.className = 'tmrw-v3-calendar-row'; row.dataset.calendarRecordId = item.recordId; const when = el(document, 'time', dueLabel(item.due)); const copy = el(document, 'span'); copy.append(el(document, 'strong', item.title), el(document, 'small', item.itemKind === 'invitation' ? `Invitation · ${item.response}` : 'Reminder')); row.append(when, copy); if (item.itemKind === 'invitation' && item.response === 'pending') { const actions = el(document, 'div'); actions.className = 'tmrw-v3-calendar-invite-actions'; const accept = el(document, 'button', 'Accept'); accept.type = 'button'; accept.dataset.calendarAction = 'accept'; let acceptBusy = false; accept.addEventListener('click', () => { if (acceptBusy || accept.disabled) return; acceptBusy = true; accept.disabled = true; void Promise.resolve(onAccept?.(item)).finally(() => { acceptBusy = false; }); }); const decline = el(document, 'button', 'Decline'); decline.type = 'button'; decline.dataset.calendarAction = 'decline'; let declineBusy = false; decline.addEventListener('click', () => { if (declineBusy || decline.disabled) return; declineBusy = true; decline.disabled = true; void Promise.resolve(onDecline?.(item)).finally(() => { declineBusy = false; }); }); actions.append(accept, decline); row.append(actions); } agenda.append(row); }
  root.append(agenda); return root;
}
