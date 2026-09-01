const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const METRICS = Object.freeze([['steps','Steps'],['calories','Calories'],['exercise-minutes','Exercise'],['sleep-minutes','Sleep'],['heart-rate','Heart rate']]);

export function renderHealth({ document, items = [], authorizationGranted = true, error = null }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-health';
  if (!authorizationGranted) { root.append(el(document, 'p', 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return root; }
  if (error) { const alert = el(document, 'p', `Health error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); return root; }
  const byMetric = new Map(); for (const item of items) if (!byMetric.has(item.metric)) byMetric.set(item.metric, item);
  const heading = el(document, 'div'); heading.className = 'tmrw-phone-health-heading'; heading.append(el(document, 'h1', 'Health')); if (items[0]?.observedAt) heading.append(el(document, 'time', items[0].observedAt)); root.append(heading);
  if (items.length === 0) { const empty = el(document, 'section'); empty.className = 'tmrw-phone-calendar-empty'; empty.append(el(document, 'strong', 'Health unavailable'), el(document, 'small', 'ยังไม่มีข้อมูลสุขภาพ')); root.append(empty); return root; }
  const metrics = el(document, 'div'); metrics.className = 'tmrw-phone-health-metrics';
  for (const [metric,label] of METRICS) { const observation = byMetric.get(metric); if (!observation) continue; const card = el(document, 'article'); card.className = 'tmrw-v3-health-metric'; card.dataset.healthMetric = metric; const copy = el(document, 'span'); copy.append(el(document, 'small', label), el(document, 'strong', `${Number(observation.value)} ${observation.unit}`)); card.append(copy); metrics.append(card); }
  root.append(metrics); return root;
}
