const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };

export function renderWeather({ document, items = [], authorizationGranted = true, error = null }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-weather';
  if (!authorizationGranted) { root.append(el(document, 'p', 'Weather is unavailable until access to this phone is granted.')); return root; }
  if (error) { const alert = el(document, 'p', `Weather error: ${error}`); alert.setAttribute('role', 'alert'); root.append(alert); return root; }
  const truth = el(document, 'p', 'Weather shows explicit story-world or provider observations only. TMRW does not generate forecasts or claim device GPS.'); truth.className = 'tmrw-v3-observation-truth'; root.append(truth);
  if (items.length === 0) { root.append(el(document, 'p', 'No explicit weather observation is available for this phone.')); return root; }
  const list = el(document, 'ol'); list.className = 'tmrw-v3-weather-list';
  items.forEach((item, index) => {
    const row = el(document, 'li'); row.dataset.weatherRecordId = item.recordId;
    row.append(el(document, index === 0 ? 'h3' : 'strong', index === 0 ? 'Latest explicit observation' : 'Earlier explicit observation'));
    row.append(el(document, 'p', `${item.condition} · ${Number(item.temperatureC)} °C`), el(document, 'p', `Story/provider location: ${item.locationLabel}`));
    const source = [item.provider, item.sourceKind].filter(Boolean).join(' · ') || 'Explicit phone-world observation'; row.append(el(document, 'small', `Source: ${source}`));
    if (item.observedAt) row.append(el(document, 'small', `Observed: ${item.observedAt}`));
    list.append(row);
  });
  root.append(list); return root;
}
