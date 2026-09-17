import { createPreviewIcon } from './app-icons.mjs';

const node = (document, tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };

export function renderImageProviderSettings({ document, capability = {}, configured = false, onSave = null } = {}) {
  const root = node(document, 'section'); root.className = 'tmrw-v3-provider-card'; root.dataset.providerArea = 'image';
  const header = node(document, 'header'); const mark = node(document, 'i'); mark.append(createPreviewIcon({ document, name: 'gallery', size: 21 })); const copy = node(document, 'span'); copy.append(node(document, 'small', 'IMAGE API'), node(document, 'strong', 'รูปประกอบจากบริบท'), node(document, 'p', configured && capability.available ? 'พร้อมค้นหารูปที่มีอยู่แล้ว' : 'ไม่บังคับ • มือถือยังใช้ได้โดยไม่ใส่ API')); header.append(mark, copy); root.append(header);
  const safe = node(document, 'p', 'ค้นหาและคัดรูปเท่านั้น — ไม่สร้างภาพ และเลี่ยงรูปคนเป็นค่าเริ่มต้น'); safe.className = 'tmrw-v3-provider-safe'; root.append(safe);
  const field = node(document, 'div'); field.className = 'tmrw-v3-provider-field'; const input = node(document, 'input'); input.type = 'password'; input.autocomplete = 'off'; input.setAttribute('aria-label', 'Image API key'); input.placeholder = configured ? 'ตั้งค่าแล้ว • ใส่ใหม่เพื่อเปลี่ยน' : 'Pixabay API key'; const save = node(document, 'button', configured ? 'อัปเดต' : 'บันทึก'); save.type = 'button'; save.dataset.providerAction = 'save-image-api'; save.addEventListener('click', () => onSave?.(input.value)); field.append(input, save); root.append(field);
  const status = node(document, 'footer', configured ? `${capability.providerId || 'Image provider'} • ${capability.available ? 'พร้อมใช้' : 'บันทึกแล้วแต่ยังเชื่อมไม่ได้'}` : 'ยังไม่ได้ตั้งค่า'); root.append(status); return root;
}

export function renderVoiceProviderHeading({ document, configured = false } = {}) {
  const root = node(document, 'section'); root.className = 'tmrw-v3-provider-heading'; root.dataset.providerArea = 'voice'; const mark = node(document, 'i'); mark.append(createPreviewIcon({ document, name: 'voice', size: 21 })); const copy = node(document, 'span'); copy.append(node(document, 'small', 'LOCAL VOICE'), node(document, 'strong', 'TMRW Local Voice'), node(document, 'p', configured ? 'ฟรีถาวร • ตั้งค่าเสียงและโปรไฟล์ตัวละครในเครื่อง' : 'โทรแบบข้อความยังใช้ได้แม้ยังไม่ติดตั้ง')); root.append(mark, copy); return root;
}
