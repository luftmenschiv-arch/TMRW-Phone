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
  if (clock.displayLocalDate || clock.displayLocalTime) return `Story time: ${[clock.displayLocalDate, clock.displayLocalTime].filter(Boolean).join(' ')}`;
  return `Story time: ${clock.mode || 'unanchored'} · ordinal ${clock.ordinal ?? 0}`;
}

export function renderCalendar({ document, view, recipients = [], authorizationGranted = true, error = null, formMode = null, onStartForm, onCancelForm, onCreateReminder, onCreateInvitation, onAccept, onDecline }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-calendar';
  if (!authorizationGranted) { root.append(el(document, 'p', 'Calendar is unavailable until access to this phone is granted.')); return root; }
  if (error) { const alert = el(document, 'p', `Calendar error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); return root; }

  const clock = el(document, 'p', storyClockLabel(view?.clock)); clock.className = 'tmrw-v3-calendar-clock'; root.append(clock);
  const explanation = el(document, 'p', 'Calendar uses TMRW Story Clock and Pending World Events. Opening this app never advances story time.'); explanation.className = 'tmrw-v3-calendar-truth'; root.append(explanation);

  if (!formMode) {
    const actions = el(document, 'div'); actions.className = 'tmrw-v3-calendar-create-actions';
    const reminder = el(document, 'button', 'Add reminder'); reminder.type = 'button'; reminder.dataset.calendarAction = 'new-reminder'; reminder.setAttribute('aria-label', 'Create story-time reminder'); reminder.addEventListener('click', () => onStartForm?.('reminder'));
    const invitation = el(document, 'button', 'Add invitation'); invitation.type = 'button'; invitation.dataset.calendarAction = 'new-invitation'; invitation.setAttribute('aria-label', 'Create calendar invitation'); invitation.addEventListener('click', () => onStartForm?.('invitation'));
    actions.append(reminder, invitation); root.append(actions);
  } else {
    const form = el(document, 'section'); form.className = 'tmrw-v3-calendar-form'; form.dataset.calendarForm = formMode;
    form.append(el(document, 'h3', formMode === 'invitation' ? 'New invitation' : 'New reminder'));
    const title = el(document, 'input'); title.type = 'text'; title.setAttribute('aria-label', 'Calendar title'); title.setAttribute('placeholder', 'Title');
    const date = el(document, 'input'); date.type = 'text'; date.setAttribute('aria-label', 'Story date'); date.setAttribute('placeholder', 'YYYY-MM-DD (optional)');
    const time = el(document, 'input'); time.type = 'text'; time.setAttribute('aria-label', 'Story time'); time.setAttribute('placeholder', 'HH:MM');
    form.append(title, date, time);
    const selectedRecipients = new Set();
    if (formMode === 'invitation') {
      const recipientBox = el(document, 'div'); recipientBox.className = 'tmrw-v3-calendar-recipients'; recipientBox.setAttribute('aria-label', 'Invitation recipients');
      if (recipients.length === 0) recipientBox.append(el(document, 'p', 'No identified Contacts are available for invitations.'));
      for (const recipient of recipients) {
        const button = el(document, 'button', recipient.label); button.type = 'button'; button.dataset.calendarRecipientInstanceId = recipient.instanceId; button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', `Invite ${recipient.label}`);
        button.addEventListener('click', () => { if (selectedRecipients.has(recipient.instanceId)) selectedRecipients.delete(recipient.instanceId); else selectedRecipients.add(recipient.instanceId); button.setAttribute('aria-pressed', String(selectedRecipients.has(recipient.instanceId))); }); recipientBox.append(button);
      }
      form.append(recipientBox);
    }
    const status = el(document, 'p'); status.className = 'tmrw-v3-calendar-form-status'; status.setAttribute('role', 'alert');
    const controls = el(document, 'div'); controls.className = 'tmrw-v3-calendar-form-controls';
    const cancel = el(document, 'button', 'Cancel'); cancel.type = 'button'; cancel.dataset.calendarAction = 'cancel-create'; cancel.addEventListener('click', () => onCancelForm?.());
    const create = el(document, 'button', formMode === 'invitation' ? 'Create invitation' : 'Create reminder'); create.type = 'button'; create.dataset.calendarAction = 'submit-create'; let busy = false;
    create.addEventListener('click', () => {
      if (busy || create.disabled) return;
      const cleanTitle = String(title.value || '').trim(); const localDate = String(date.value || '').trim(); const localTime = String(time.value || '').trim();
      if (!cleanTitle || !localTime) { status.textContent = 'Title and story time are required.'; return; }
      if (formMode === 'invitation' && selectedRecipients.size === 0) { status.textContent = 'Choose at least one identified Contact.'; return; }
      busy = true; create.disabled = true;
      const due = { kind: 'absolute', localDate: localDate || null, localTime };
      const action = formMode === 'invitation' ? onCreateInvitation?.({ title: cleanTitle, due, participantInstanceIds: [...selectedRecipients] }) : onCreateReminder?.({ title: cleanTitle, due });
      void Promise.resolve(action).finally(() => { busy = false; });
    });
    controls.append(cancel, create); form.append(status, controls); root.append(form);
  }

  const items = view?.items || [];
  if (items.length === 0) { root.append(el(document, 'p', 'No calendar items on this phone yet.')); return root; }
  const list = el(document, 'ol'); list.className = 'tmrw-v3-calendar-list';
  for (const item of items) {
    const row = el(document, 'li'); row.dataset.calendarRecordId = item.recordId;
    const kind = item.itemKind === 'invitation' ? 'Invitation' : 'Reminder';
    row.append(el(document, 'strong', item.title), el(document, 'p', `${kind} · ${dueLabel(item.due)}`));
    if (item.itemKind === 'invitation') row.append(el(document, 'p', `Your response: ${item.response} · World event: ${item.pending?.status || item.pending?.lifecycleStatus || 'unavailable'}`));
    else row.append(el(document, 'p', `Reminder status: ${item.pending?.status || item.pending?.lifecycleStatus || 'unavailable'}`));
    if (item.itemKind === 'invitation' && item.response === 'pending') {
      const actions = el(document, 'div'); actions.className = 'tmrw-v3-calendar-invite-actions';
      const accept = el(document, 'button', 'Accept'); accept.type = 'button'; accept.dataset.calendarAction = 'accept'; accept.setAttribute('aria-label', `Accept ${item.title}`); let acceptBusy = false; accept.addEventListener('click', () => { if (acceptBusy || accept.disabled) return; acceptBusy = true; accept.disabled = true; void Promise.resolve(onAccept?.(item)).finally(() => { acceptBusy = false; }); });
      const decline = el(document, 'button', 'Decline'); decline.type = 'button'; decline.dataset.calendarAction = 'decline'; decline.setAttribute('aria-label', `Decline ${item.title}`); let declineBusy = false; decline.addEventListener('click', () => { if (declineBusy || decline.disabled) return; declineBusy = true; decline.disabled = true; void Promise.resolve(onDecline?.(item)).finally(() => { declineBusy = false; }); });
      actions.append(accept, decline); row.append(actions);
    }
    list.append(row);
  }
  root.append(list); return root;
}
