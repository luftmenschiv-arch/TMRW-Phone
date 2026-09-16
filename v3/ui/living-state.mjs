const copy = Object.freeze({
  loading: Object.freeze({ mark: '•••', title: 'กำลังจัดของให้เข้าที่', detail: 'อีกนิดเดียว มือถือกำลังตามเรื่องให้ทัน' }),
  empty: Object.freeze({ mark: '✦', title: 'ตรงนี้กำลังรอเรื่องราว', detail: 'กดอัปเดตมือถือ หรือเล่นต่ออีกนิด แล้วกลับมาดูใหม่ได้เลย' }),
  error: Object.freeze({ mark: '↻', title: 'สะดุดนิดหนึ่ง', detail: 'ข้อมูลเดิมยังอยู่ ลองเปิดใหม่ได้โดยไม่ต้องเริ่มตั้งแต่ต้น' }),
  offline: Object.freeze({ mark: '⌁', title: 'ตอนนี้ยังเชื่อมต่อไม่ได้', detail: 'ของที่อยู่ในเครื่องยังเปิดดูได้ และจะอัปเดตเมื่อกลับมาออนไลน์' }),
  ready: Object.freeze({ mark: '✓', title: 'พร้อมแล้ว', detail: 'ข้อมูลบนมือถือเป็นปัจจุบัน' }),
});

export function renderLivingState({ document, state = 'empty', title = null, detail = null, actionLabel = null, onAction = null } = {}) {
  if (!document?.createElement) throw new TypeError('renderLivingState requires a DOM document');
  const preset = copy[state] || copy.empty; const root = document.createElement('section'); root.className = `tmrw-phone-living-state is-${state}`; root.dataset.state = state;
  const mark = document.createElement('i'); mark.textContent = preset.mark; mark.setAttribute('aria-hidden', 'true');
  const heading = document.createElement('strong'); heading.textContent = title || preset.title;
  const paragraph = document.createElement('p'); paragraph.textContent = detail || preset.detail;
  root.append(mark, heading, paragraph);
  if (actionLabel && typeof onAction === 'function') { const button = document.createElement('button'); button.type = 'button'; button.textContent = actionLabel; button.addEventListener('click', onAction); root.append(button); }
  if (state === 'loading') root.setAttribute('role', 'status'); else if (state === 'error') root.setAttribute('role', 'alert');
  return root;
}
