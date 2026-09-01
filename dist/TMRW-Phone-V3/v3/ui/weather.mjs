const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };

export function renderWeather({ document, items = [], authorizationGranted = true, error = null }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-weather';
  if (!authorizationGranted) { root.append(el(document, 'p', 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return root; }
  if (error) { const alert = el(document, 'p', `Weather error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); return root; }
  if (items.length === 0) { const empty = el(document, 'section'); empty.className = 'tmrw-phone-calendar-empty'; empty.append(el(document, 'strong', 'Weather unavailable'), el(document, 'small', 'ยังไม่มีข้อมูลสภาพอากาศ')); root.append(empty); return root; }
  const latest = items[0];
  const hero = el(document, 'section'); hero.className = 'tmrw-phone-weather-hero'; const copy = el(document, 'div'); copy.className = 'tmrw-phone-weather-copy'; copy.append(el(document, 'small', latest.locationLabel || 'Weather'), el(document, 'h1', latest.condition), el(document, 'strong', `${Number(latest.temperatureC)}°`)); if (latest.observedAt) copy.append(el(document, 'time', latest.observedAt)); const art = el(document, 'div'); art.className = 'tmrw-phone-weather-art'; art.setAttribute('aria-hidden', 'true'); art.append(el(document, 'i'), el(document, 'b'), el(document, 'em')); hero.append(copy, art); root.append(hero);
  if (items.length > 1) { const list = el(document, 'section'); list.className = 'tmrw-phone-weather-forecast'; const heading = el(document, 'header'); heading.append(el(document, 'h2', 'Observations')); list.append(heading); for (const item of items.slice(1, 8)) { const row = el(document, 'div'); row.dataset.weatherRecordId = item.recordId; row.append(el(document, 'b', item.condition), el(document, 'strong', `${Number(item.temperatureC)}°`), el(document, 'small', item.locationLabel || '')); list.append(row); } root.append(list); }
  return root;
}
