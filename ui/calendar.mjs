import { createPreviewIcon } from './app-icons.mjs';

const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const icon = (document, name, size) => createPreviewIcon({ document, name, size });
import { renderAppEmptyState, renderInlineNotice } from './app-empty-state.mjs';
const emptyState = (document, text) => renderAppEmptyState({ document, app: 'calendar', title: text, compact: true });

function dueLabel(due) {
  if (!due) return 'ยังไม่มีเวลาในเรื่อง';
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
function absoluteDate(item) { return item?.due?.kind === 'absolute' && item.due.localDate ? String(item.due.localDate) : null; }

export function renderCalendar({ document, view, recipients = [], authorizationGranted = true, error = null, activeTab = 'today', formMode = null, onStartForm, onCancelForm, onCreateReminder, onCreateInvitation, onAccept, onDecline }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-calendar';
  if (!authorizationGranted) { root.append(emptyState(document, 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return root; }
  if (error) { root.append(renderInlineNotice({ document, tone:'error', title:'เปิด Calendar ยังไม่สำเร็จ', detail:'ข้อมูลเดิมยังอยู่ ลองกลับเข้ามาใหม่อีกครั้ง' })); return root; }

  const items = view?.items || [];
  const heading = el(document, 'section'); heading.className = 'tmrw-phone-calendar-heading'; const title = el(document, 'span'); title.append(el(document, 'h1', 'Calendar'), el(document, 'b', storyClockLabel(view?.clock))); heading.append(title); const add = el(document, 'button'); add.type = 'button'; add.dataset.calendarAction = 'new-reminder'; add.setAttribute('aria-label', 'เพิ่มรายการใน Calendar'); add.append(icon(document, 'plus', 20)); add.addEventListener('click', () => onStartForm?.('reminder')); heading.append(add); root.append(heading);

  const absoluteDates = [...new Set(items.map(absoluteDate).filter(Boolean))].slice(0, 7);
  const strip = el(document, 'div'); strip.className = 'tmrw-phone-calendar-strip';
  for (let index = 0; index < 7; index += 1) { const date = absoluteDates[index] || null; const button = el(document, 'button'); button.type = 'button'; button.disabled = true; if (index === 0) button.className = 'is-active'; const parts = date ? date.split('-') : []; button.append(el(document, 'small', date ? 'Story' : '—'), el(document, 'b', date ? String(Number(parts.at(-1) || 0)) : '—')); if (date && items.some(item => absoluteDate(item) === date)) button.append(el(document, 'i')); strip.append(button); }
  root.append(strip);

  if (formMode) {
    const form = el(document, 'section'); form.className = 'tmrw-v3-calendar-form tmrw-phone-calendar-task-summary'; form.dataset.calendarForm = formMode; form.append(el(document, 'h3', formMode === 'invitation' ? 'New invitation' : 'New reminder'));
    const titleInput = el(document, 'input'); titleInput.type = 'text'; titleInput.setAttribute('aria-label', 'Calendar title'); titleInput.placeholder = 'Title';
    const date = el(document, 'input'); date.type = 'text'; date.setAttribute('aria-label', 'Story date'); date.placeholder = 'YYYY-MM-DD';
    const time = el(document, 'input'); time.type = 'text'; time.setAttribute('aria-label', 'Story time'); time.placeholder = 'HH:MM'; form.append(titleInput, date, time);
    const selectedRecipients = new Set();
    if (formMode === 'invitation') { const recipientBox = el(document, 'div'); recipientBox.className = 'tmrw-v3-calendar-recipients tmrw-phone-filter-chips'; if (recipients.length === 0) recipientBox.append(emptyState(document, 'ยังไม่มี Contacts ที่เชิญได้')); for (const recipient of recipients) { const button = el(document, 'button', recipient.label); button.type = 'button'; button.dataset.calendarRecipientInstanceId = recipient.instanceId; button.setAttribute('aria-pressed', 'false'); button.addEventListener('click', () => { if (selectedRecipients.has(recipient.instanceId)) selectedRecipients.delete(recipient.instanceId); else selectedRecipients.add(recipient.instanceId); button.className = selectedRecipients.has(recipient.instanceId) ? 'is-active' : ''; button.setAttribute('aria-pressed', String(selectedRecipients.has(recipient.instanceId))); }); recipientBox.append(button); } form.append(recipientBox); }
    const status = el(document, 'p'); status.className = 'tmrw-v3-calendar-form-status'; status.setAttribute('role', 'alert'); const controls = el(document, 'div'); controls.className = 'tmrw-v3-calendar-form-controls'; const cancel = el(document, 'button', 'ยกเลิก'); cancel.type = 'button'; cancel.dataset.calendarAction = 'cancel-create'; cancel.addEventListener('click', () => onCancelForm?.()); const create = el(document, 'button', formMode === 'invitation' ? 'สร้างคำเชิญ' : 'สร้างเตือนความจำ'); create.type = 'button'; create.dataset.calendarAction = 'submit-create'; let busy = false; create.addEventListener('click', () => { if (busy || create.disabled) return; const cleanTitle = String(titleInput.value || '').trim(); const localDate = String(date.value || '').trim(); const localTime = String(time.value || '').trim(); if (!cleanTitle || !localTime) { status.textContent = 'กรอกชื่อและเวลาในเรื่อง'; return; } if (formMode === 'invitation' && selectedRecipients.size === 0) { status.textContent = 'เลือก Contact อย่างน้อยหนึ่งคน'; return; } busy = true; create.disabled = true; const due = { kind: 'absolute', localDate: localDate || null, localTime }; const action = formMode === 'invitation' ? onCreateInvitation?.({ title: cleanTitle, due, participantInstanceIds: [...selectedRecipients] }) : onCreateReminder?.({ title: cleanTitle, due }); void Promise.resolve(action).finally(() => { busy = false; }); }); controls.append(cancel, create); form.append(status, controls); root.append(form);
  } else {
    const actions = el(document, 'div'); actions.className = 'tmrw-v3-calendar-create-actions tmrw-phone-filter-chips'; const invite = el(document, 'button'); invite.type = 'button'; invite.dataset.calendarAction = 'new-invitation'; invite.append(icon(document, 'plus', 15), el(document, 'span', 'Invitation')); invite.addEventListener('click', () => onStartForm?.('invitation')); actions.append(invite); root.append(actions);
  }

  const appendResponseActions = (row, item) => {
    if (item.itemKind !== 'invitation' || item.response !== 'pending') return;
    const response = el(document, 'div'); response.className = 'tmrw-v3-calendar-invite-actions';
    const accept = el(document, 'button', 'Accept'); accept.type = 'button'; accept.dataset.calendarAction = 'accept'; let acceptBusy = false; accept.addEventListener('click', () => { if (acceptBusy || accept.disabled) return; acceptBusy = true; accept.disabled = true; void Promise.resolve(onAccept?.(item)).finally(() => { acceptBusy = false; }); });
    const decline = el(document, 'button', 'Decline'); decline.type = 'button'; decline.dataset.calendarAction = 'decline'; let declineBusy = false; decline.addEventListener('click', () => { if (declineBusy || decline.disabled) return; declineBusy = true; decline.disabled = true; void Promise.resolve(onDecline?.(item)).finally(() => { declineBusy = false; }); });
    response.append(accept, decline); row.append(response);
  };
  const appendAgendaRow = (parent, item, { button = false } = {}) => { const row = el(document, button ? 'button' : 'article'); if (button) row.type = 'button'; row.className = 'tmrw-v3-calendar-row'; row.dataset.calendarRecordId = item.recordId; const when = el(document, 'time', dueLabel(item.due)); const copy = el(document, 'span'); copy.append(el(document, 'strong', item.title), el(document, 'small', item.itemKind === 'invitation' ? `Invitation · ${item.response}` : 'Reminder')); row.append(when, copy, icon(document, 'chevron', 14)); appendResponseActions(row, item); parent.append(row); return row; };

  if (activeTab === 'calendar') {
    const dates = items.map(absoluteDate).filter(Boolean).sort(); const anchor = dates[0] ? new Date(`${dates[0]}T12:00:00`) : null;
    const month = el(document, 'section'); month.className = 'tmrw-phone-calendar-month-grid';
    if (!anchor || Number.isNaN(anchor.getTime())) month.append(emptyState(document, 'ยังไม่มีวันที่แบบปฏิทินในข้อมูลจริง'));
    else { const labels = el(document, 'div'); labels.className = 'tmrw-phone-calendar-week-labels'; for (const day of ['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.']) labels.append(el(document, 'span', day)); month.append(labels); const grid = el(document, 'div'); grid.className = 'tmrw-phone-calendar-grid'; const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12); const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate(); for (let i=0;i<first.getDay();i+=1) grid.append(el(document,'span')); for (let day=1;day<=daysInMonth;day+=1) { const button=el(document,'button');button.type='button';button.disabled=true;button.append(el(document,'b',String(day)));const key=`${anchor.getFullYear()}-${String(anchor.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;if(items.some(item=>absoluteDate(item)===key))button.append(el(document,'i'));grid.append(button); } month.append(grid); }
    root.append(month);
    const upcoming=el(document,'section');upcoming.className='tmrw-phone-calendar-agenda';const h=el(document,'header');h.append(el(document,'h2','นัดหมายที่กำลังจะมาถึง'),el(document,'small',`${items.length} รายการ`));upcoming.append(h);for(const item of items.slice(0,6))appendAgendaRow(upcoming,item);if(!items.length)upcoming.append(emptyState(document,'ยังไม่มีรายการ'));root.append(upcoming);return root;
  }

  if (activeTab === 'tasks') {
    const summary=el(document,'section');summary.className='tmrw-phone-calendar-task-summary';const text=el(document,'span');text.append(el(document,'small','งานวันนี้'),el(document,'strong',`0/${items.length}`));const progress=el(document,'div');const bar=el(document,'i');bar.style.setProperty?.('--task-progress','0%');progress.append(bar);summary.append(text,progress);root.append(summary);
    const list=el(document,'section');list.className='tmrw-phone-calendar-task-list';for(const item of items){const row=el(document,'button');row.type='button';row.disabled=true;const state=el(document,'i');const copy=el(document,'span');copy.append(el(document,'strong',item.title),el(document,'small',`${dueLabel(item.due)} · ${item.itemKind === 'invitation' ? item.response : 'Reminder'}`));row.append(state,copy);list.append(row);}if(!items.length)list.append(emptyState(document,'ยังไม่มีงาน'));root.append(list);return root;
  }

  const agenda = el(document, 'section'); agenda.className = activeTab === 'agenda' ? 'tmrw-phone-calendar-agenda is-full' : 'tmrw-phone-calendar-day';
  if (activeTab === 'today') {
    const dayHeader=el(document,'header');const dayCopy=el(document,'span');dayCopy.append(el(document,'strong','วันนี้'),el(document,'small',storyClockLabel(view?.clock)));const plus=el(document,'button');plus.type='button';plus.append(icon(document,'plus',18));plus.addEventListener('click',()=>onStartForm?.('reminder'));dayHeader.append(dayCopy,plus);agenda.append(dayHeader);
    const timeline=el(document,'div');timeline.className='tmrw-phone-calendar-timeline';for(let hour=8;hour<=18;hour+=1){const slot=el(document,'div');slot.className='tmrw-phone-calendar-hour';slot.append(el(document,'time',`${String(hour).padStart(2,'0')}:00`),el(document,'span'));const content=el(document,'div');for(const item of items.filter(row=>row.due?.kind==='absolute' && Number(String(row.due.localTime||'').split(':')[0])===hour))appendAgendaRow(content,item);slot.append(content);timeline.append(slot);}agenda.append(timeline);const floating=items.filter(row=>row.due?.kind!=='absolute');for(const item of floating)appendAgendaRow(agenda,item);if(!items.length){const empty=el(document,'div');empty.className='tmrw-phone-calendar-empty';empty.append(icon(document,'calendar',27),el(document,'strong','วันนี้ยังว่าง'),el(document,'small','แตะ + เพื่อเพิ่มนัดหมายใหม่'));agenda.append(empty);}
  } else {
    const agendaHeader = el(document, 'header'); agendaHeader.append(el(document, 'h2', 'กำหนดการทั้งหมด'), el(document, 'small', `${items.length} รายการ`)); agenda.append(agendaHeader); for (const item of items) appendAgendaRow(agenda, item); if (!items.length) agenda.append(emptyState(document, 'ยังไม่มีนัดหมายหรือเตือนความจำ'));
  }
  root.append(agenda); return root;
}
