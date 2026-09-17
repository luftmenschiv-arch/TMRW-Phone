import { createPreviewIcon } from './app-icons.mjs';

const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const icon = (document, name, size) => createPreviewIcon({ document, name, size });
import { renderAppEmptyState, renderInlineNotice } from './app-empty-state.mjs';
const emptyState = (document, text) => renderAppEmptyState({ document, app: 'weather', title: text, compact: true });

export function renderWeather({ document, items = [], authorizationGranted = true, error = null }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-weather';
  if (!authorizationGranted) { root.append(emptyState(document, 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return root; }
  if (error) { root.append(renderInlineNotice({ document, tone:'error', title:'เปิด Weather ยังไม่สำเร็จ', detail:'ข้อมูลเดิมยังอยู่ ลองกลับเข้ามาใหม่อีกครั้ง' })); return root; }

  const latest = items[0] || null;
  const hero = el(document, 'section'); hero.className = 'tmrw-phone-weather-hero';
  const copy = el(document, 'div'); copy.className = 'tmrw-phone-weather-copy';
  copy.append(el(document, 'small', latest?.locationLabel || 'ยังไม่มีตำแหน่งสภาพอากาศ'), el(document, 'h1', latest?.condition || 'ยังไม่มีข้อมูล'), el(document, 'time', latest?.observedAt || ''));
  copy.append(el(document, 'strong', latest ? `${Number(latest.temperatureC)}°` : '—'), el(document, 'b', latest?.condition || 'Weather unavailable'), el(document, 'span', latest?.provider ? `จาก ${latest.provider}` : 'ไม่มีข้อมูลพยากรณ์เพิ่มเติม'));
  const art = el(document, 'div'); art.className = 'tmrw-phone-weather-art'; art.setAttribute('aria-hidden', 'true'); art.append(el(document, 'i'), el(document, 'b'), el(document, 'em')); hero.append(copy, art); root.append(hero);

  const summary = el(document, 'section'); summary.className = 'tmrw-phone-weather-summary';
  for (const [value, label] of [['—','ต่ำสุด'],['—','สูงสุด'],['—','ความชื้น'],['—','UV']]) { const span = el(document, 'span'); span.append(el(document, 'strong', value), el(document, 'small', label)); summary.append(span); }
  root.append(summary);

  const hourly = el(document, 'section'); hourly.className = 'tmrw-phone-weather-hourly';
  for (let index = 0; index < 6; index += 1) { const span = el(document, 'span'); span.append(el(document, 'small', index === 0 ? 'ล่าสุด' : '—'), icon(document, index === 0 && latest ? 'cloud' : 'cloud', 18), el(document, 'strong', index === 0 && latest ? `${Number(latest.temperatureC)}°` : '—')); hourly.append(span); }
  root.append(hourly);

  const forecast = el(document, 'section'); forecast.className = 'tmrw-phone-weather-forecast'; const heading = el(document, 'header'); heading.append(el(document, 'h2', 'พยากรณ์ 7 วัน')); const unavailable = el(document, 'button', '—'); unavailable.type = 'button'; unavailable.disabled = true; heading.append(unavailable); forecast.append(heading);
  for (let index = 0; index < 7; index += 1) { const row = el(document, 'div'); row.append(el(document, 'b', '—'), icon(document, 'cloud', 17), el(document, 'small', '—')); const bar = el(document, 'span'); bar.append(el(document, 'em')); row.append(bar, el(document, 'strong', '—')); forecast.append(row); }
  forecast.append(emptyState(document, items.length ? 'ข้อมูลปัจจุบันมีเฉพาะการสังเกตจริง ไม่มีพยากรณ์ 7 วัน' : 'ยังไม่มีข้อมูลสภาพอากาศ'));
  root.append(forecast);

  if (items.length > 1) { const observations = el(document, 'section'); observations.className = 'tmrw-phone-commerce-section'; const h = el(document, 'header'); h.append(el(document, 'h2', 'การสังเกตล่าสุด')); observations.append(h); for (const item of items.slice(0, 8)) { const row = el(document, 'div'); row.className = 'tmrw-phone-wallet-transaction'; row.dataset.weatherRecordId = item.recordId; const text = el(document, 'span'); text.append(el(document, 'strong', item.condition), el(document, 'small', item.locationLabel || item.observedAt || '')); row.append(text, el(document, 'b', `${Number(item.temperatureC)}°`)); observations.append(row); } root.append(observations); }
  return root;
}
