const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };

const METRICS = Object.freeze([
  ['steps', 'Steps'],
  ['calories', 'Calories'],
  ['exercise-minutes', 'Exercise'],
  ['sleep-minutes', 'Sleep'],
  ['heart-rate', 'Heart rate'],
]);

export function renderHealth({ document, items = [], authorizationGranted = true, error = null }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-health';
  if (!authorizationGranted) { root.append(el(document, 'p', 'Health is unavailable until access to this phone is granted.')); return root; }
  if (error) { const alert = el(document, 'p', `Health error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); return root; }
  const truth = el(document, 'p', 'Health shows explicit phone-world observations only. It does not claim real-device sensor readings or medical validity.'); truth.className = 'tmrw-v3-observation-truth'; root.append(truth);
  if (items.length === 0) root.append(el(document, 'p', 'No explicit Health observations are available on this phone.'));
  const byMetric = new Map(); for (const item of items) if (!byMetric.has(item.metric)) byMetric.set(item.metric, item);
  const list = el(document, 'div'); list.className = 'tmrw-v3-health-metrics';
  for (const [metric, label] of METRICS) {
    const row = el(document, 'article'); row.className = 'tmrw-v3-health-metric'; row.dataset.healthMetric = metric; row.append(el(document, 'h3', label));
    const observation = byMetric.get(metric) || null;
    if (!observation) row.append(el(document, 'p', 'Unavailable — no explicit observation.'));
    else {
      row.append(el(document, 'strong', `${Number(observation.value)} ${observation.unit}`));
      row.append(el(document, 'small', `Source: ${observation.sourceLabel || observation.sourceKind || 'Explicit phone-world observation'}`));
      if (observation.observedAt) row.append(el(document, 'small', `Observed: ${observation.observedAt}`));
    }
    list.append(row);
  }
  root.append(list); return root;
}
