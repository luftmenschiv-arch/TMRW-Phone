const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };

export const APP_EMPTY_COPY = Object.freeze({
  files: Object.freeze({ title: 'ยังไม่มีไฟล์ในเครื่องนี้', detail: 'ไฟล์จากเรื่องราวและรายการที่บันทึกไว้จะมารวมอยู่ตรงนี้' }),
  notifications: Object.freeze({ title: 'ทุกอย่างยังเงียบอยู่', detail: 'ข้อความ สายโทร และความเคลื่อนไหวใหม่จะมารวมอยู่ตรงนี้' }),
  messages: Object.freeze({ title: 'ยังไม่มีบทสนทนา', detail: 'เมื่อมีคนเริ่มคุย ห้องแชทจะปรากฏตรงนี้เอง' }),
  calls: Object.freeze({ title: 'ยังไม่มีประวัติสาย', detail: 'สายที่โทรออก รับสาย หรือพลาดรับจะเรียงอยู่ตรงนี้' }),
  contacts: Object.freeze({ title: 'ยังไม่มีชื่อที่บันทึกไว้', detail: 'รายชื่อที่พบจากเรื่องราวจะค่อย ๆ เข้ามาอยู่ในเครื่องนี้' }),
  feed: Object.freeze({ title: 'ฟีดยังเงียบอยู่แป๊บหนึ่ง', detail: 'อัปเดตมือถือเพื่อชวนเรื่องราวล่าสุดและชาวเน็ตเข้ามาในฟีด' }),
  live: Object.freeze({ title: 'ตอนนี้ยังไม่มีใครกำลังไลฟ์', detail: 'เมื่อโลกในเรื่องเริ่มคึกคัก ไลฟ์ใหม่จะเด้งขึ้นมาตรงนี้' }),
  gallery: Object.freeze({ title: 'อัลบั้มนี้ยังว่างอยู่', detail: 'ภาพที่บันทึกจากเรื่องราวจะค่อย ๆ เติมลงในอัลบั้มนี้' }),
  maps: Object.freeze({ title: 'ยังไม่มีสถานที่ที่บันทึกไว้', detail: 'สถานที่จากเรื่องราวและจุดที่แชร์จะปรากฏตรงนี้' }),
  calendar: Object.freeze({ title: 'ตารางยังว่างอยู่', detail: 'นัดหมาย เตือนความจำ และเหตุการณ์จากเรื่องราวจะอยู่ตรงนี้' }),
  wallet: Object.freeze({ title: 'ยังไม่มีรายการเคลื่อนไหว', detail: 'รายรับ รายจ่าย และสิ่งที่เกิดขึ้นในเรื่องจะเรียงอยู่ตรงนี้' }),
  shop: Object.freeze({ title: 'ชั้นวางกำลังรอสินค้า', detail: 'สินค้าและข้อเสนอที่เหมาะกับโลกของเรื่องจะมาอยู่ตรงนี้' }),
  weather: Object.freeze({ title: 'ยังไม่มีสภาพอากาศล่าสุด', detail: 'เมื่อเรื่องราวระบุตำแหน่งหรือสภาพอากาศ ข้อมูลจะปรากฏตรงนี้' }),
  health: Object.freeze({ title: 'ยังไม่มีข้อมูลสุขภาพ', detail: 'กิจกรรม การนอน และสัญญาณชีพที่มีหลักฐานจะมารวมตรงนี้' }),
  notes: Object.freeze({ title: 'สมุดโน้ตยังว่างอยู่', detail: 'โน้ตจากเจ้าของเครื่องและเรื่องราวจะถูกเก็บไว้ตรงนี้' }),
  search: Object.freeze({ title: 'ยังไม่มีอะไรให้ค้นหา', detail: 'เมื่อมือถือมีข้อมูลมากขึ้น ผลลัพธ์จะรวมอยู่ตรงนี้' }),
  voice: Object.freeze({ title: 'ยังไม่มีตัวละครให้ตั้งค่าเสียง', detail: 'ตัวละครที่พบในเรื่องจะปรากฏให้ตั้งค่าแยกกันตรงนี้' }),
  generic: Object.freeze({ title: 'ตรงนี้ยังว่างอยู่', detail: 'ข้อมูลใหม่จะค่อย ๆ เข้ามาเมื่อเรื่องราวดำเนินต่อ' }),
});

export function renderAppEmptyState({ document, app = 'generic', title = null, detail = null, compact = false, actionLabel = null, onAction = null } = {}) {
  if (!document?.createElement) throw new TypeError('renderAppEmptyState requires a DOM document');
  const copy = APP_EMPTY_COPY[app] || APP_EMPTY_COPY.generic;
  const root = el(document, 'section');
  root.className = `tmrw-phone-app-empty is-${app}${compact ? ' is-compact' : ''}`;
  root.dataset.emptyApp = app;
  const art = el(document, 'div'); art.className = 'tmrw-phone-app-empty-art'; art.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 5; index += 1) { const shape = el(document, 'i'); shape.dataset.emptyShape = String(index + 1); art.append(shape); }
  const words = el(document, 'div'); words.className = 'tmrw-phone-app-empty-copy';
  words.append(el(document, 'strong', title || copy.title), el(document, 'p', detail || copy.detail));
  root.append(art, words);
  if (actionLabel && typeof onAction === 'function') { const action = el(document, 'button', actionLabel); action.type = 'button'; action.addEventListener('click', onAction); root.append(action); }
  return root;
}

export function renderInlineNotice({ document, tone = 'info', title, detail = '', actionLabel = null, onAction = null } = {}) {
  const root = el(document, 'section'); root.className = `tmrw-phone-inline-notice is-${tone}`; root.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  const mark = el(document, 'i', tone === 'error' ? '!' : '✦'); mark.setAttribute('aria-hidden', 'true');
  const copy = el(document, 'span'); copy.append(el(document, 'strong', title || 'แจ้งเตือน'));
  if (detail) copy.append(el(document, 'small', detail));
  root.append(mark, copy);
  if (actionLabel && typeof onAction === 'function') { const action = el(document, 'button', actionLabel); action.type = 'button'; action.addEventListener('click', onAction); root.append(action); }
  return root;
}
