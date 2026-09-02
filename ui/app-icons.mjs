const ICONS = Object.freeze({
  phone: '<path d="M7.2 3.5 9.3 3l2 4-1.8 1.4a14.5 14.5 0 0 0 6.1 6.1l1.4-1.8 4 2-.5 2.1c-.4 1.8-2.1 3-4 2.8C9.8 18.8 5.2 14.2 4.4 7.5c-.2-1.9 1-3.6 2.8-4Z"/>',
  sparkle: '<path d="m12 3 1.1 3.1L16 7.3l-2.9 1.1L12 11.5l-1.1-3.1L8 7.3l2.9-1.2L12 3ZM18 13l.7 2 2 .7-2 .8-.7 2-.8-2-2-.8 2-.7.8-2ZM5 13l.7 2 2 .7-2 .8-.7 2-.8-2-2-.8 2-.7.8-2Z"/>',
  message: '<path d="M4 5.5h16v11H9l-5 4v-15Z"/>',
  location: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  bag: '<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
  send: '<path d="m3 11 18-8-7 18-3-7-8-3Z"/><path d="m11 14 4-4"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  heart: '<path d="M20.8 4.8a5.5 5.5 0 0 0-7.8 0L12 5.9l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.4a5.5 5.5 0 0 0 0-7.8Z"/>',
  comment: '<path d="M4 5h16v11H9l-5 4V5Z"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  play: '<path d="m9 7 8 5-8 5V7Z"/>',
  pause: '<path d="M9 7v10M15 7v10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3.5 12h17M12 3c2.3 2.5 3.5 5.5 3.5 9S14.3 18.5 12 21c-2.3-2.5-3.5-5.5-3.5-9S9.7 5.5 12 3Z"/>',
  camera: '<rect x="3" y="6.5" width="18" height="13" rx="2.5"/><path d="m8 6.5 1.2-2h5.6l1.2 2"/><circle cx="12" cy="13" r="3.25"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  userPlus: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20c.4-4 2.2-6 5.5-6s5.1 2 5.5 6M18 8v6M15 11h6"/>',
  trend: '<path d="m4 17 5-5 4 3 7-8"/><path d="M15 7h5v5"/>',
  refresh: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6.1 6.1L4 8M5.5 15A7 7 0 0 0 17.9 17.9L20 16"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 0-4H12a1.7 1.7 0 0 1 0-3.4h2.8A6.2 6.2 0 0 0 21 7.4C21 4.9 17 3 12 3Z"/><circle cx="7.5" cy="9" r="1"/><circle cx="10.5" cy="6.5" r="1"/><circle cx="15" cy="7" r="1"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 8.6 4.7 4.7 0 0 0 7 18Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  rain: '<path d="M7 15h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 5.6 4.7 4.7 0 0 0 7 15Z"/><path d="m8 18-1 2M13 18l-1 2M18 18l-1 2"/>',
  wind: '<path d="M3 8h11c3 0 3-4 0-4-1.3 0-2.1.7-2.4 1.5M3 12h16c3 0 3 4 0 4-1.3 0-2.1-.7-2.4-1.5M3 16h8"/>',
  droplet: '<path d="M12 3s6 6.2 6 11a6 6 0 1 1-12 0c0-4.8 6-11 6-11Z"/>',
  navigation: '<path d="m4 10 16-7-7 16-2-6-7-3Z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M3 12h18M10 12v2h4v-2"/>',
  runner: '<circle cx="14" cy="4.5" r="2"/><path d="m11 8 3 2 3 1M13 9l-3 5-4 2M14 11l2 4 4 2M10 14l2 3-2 4"/>',
  flame: '<path d="M13 3c1 4-2 5-2 8 0 2 1 3 2 3 2 0 3-2 2-4 3 2 5 5 5 8a8 8 0 0 1-16 0c0-4 2-7 6-10-1 5 2 6 3 7 0-4 1-7 5-9Z"/>',
  moon: '<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>',
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3M21 12h-3M12 21v-3M3 12h3"/>',
  tasks: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="m7 8 1.5 1.5L11 7M13 8h4M7 14l1.5 1.5L11 13M13 14h4"/>',
  agenda: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v18M11 8h6M11 12h6M11 16h4"/>',
  flashlight: '<path d="m8 3 8 3-2 5v8l-4 2v-10L8 3Z"/><path d="M9 6h6M10 11h4"/>',
  voice: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M8.5 21h7"/>',
  contacts: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-3.6 2.3-5.4 5.5-5.4s5 1.8 5.5 5.4M17 7h4M19 5v4"/>',
  messages: '<path d="M4 5.5h16v11H9l-5 4v-15Z"/>',
  calls: '<path d="M7.2 3.5 9.3 3l2 4-1.8 1.4a14.5 14.5 0 0 0 6.1 6.1l1.4-1.8 4 2-.5 2.1c-.4 1.8-2.1 3-4 2.8C9.8 18.8 5.2 14.2 4.4 7.5c-.2-1.9 1-3.6 2.8-4Z"/>',
  feed: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  insungram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/>',
  live: '<rect x="4" y="5" width="16" height="14" rx="3"/><path d="m10 9 5 3-5 3V9Z"/>',
  notifications: '<path d="M6 17h12l-1.4-2.2V10a4.6 4.6 0 0 0-9.2 0v4.8L6 17Z"/><path d="M10 19a2.2 2.2 0 0 0 4 0"/>',
  gallery: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m5 18 5-5 3 3 2-2 4 4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  maps: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/><path d="M8 14h3M13 14h3M8 17h3"/>',
  notes: '<path d="M6 3h9l3 3v15H6V3Z"/><path d="M15 3v4h4M9 11h6M9 15h6"/>',
  files: '<path d="M3 6h7l2 2h9v11H3V6Z"/><path d="M3 6V4h7l2 2"/>',
  wallet: '<path d="M4 6.5h14a2 2 0 0 1 2 2v10H6a2 2 0 0 1-2-2v-10Z"/><path d="M4 8V6a2 2 0 0 1 2-2h11"/><path d="M15 11h5v4h-5a2 2 0 1 1 0-4Z"/>',
  shop: '<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  weather: '<path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 8.6 4.7 4.7 0 0 0 7 18Z"/>',
  health: '<path d="M20.8 5.2a5.1 5.1 0 0 0-7.2 0L12 6.8l-1.6-1.6a5.1 5.1 0 1 0-7.2 7.2L12 21l8.8-8.6a5.1 5.1 0 0 0 0-7.2Z"/><path d="M6.5 12h3l1.5-3 2.2 6 1.3-3H18"/>',
  theme: '<path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 0-4H12a1.7 1.7 0 0 1 0-3.4h2.8A6.2 6.2 0 0 0 21 7.4C21 4.9 17 3 12 3Z"/><circle cx="7.5" cy="9" r="1"/><circle cx="10.5" cy="6.5" r="1"/><circle cx="15" cy="7" r="1"/>',
  guide: '<path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H12v18H7.5A3.5 3.5 0 0 0 4 23V5.5Z"/><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H12v18h4.5A3.5 3.5 0 0 1 20 23V5.5Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7a7 7 0 0 0-.6-1.4l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.4-.6L11.2 3h-3l-.7 2a7 7 0 0 0-1.4.6l-1.9-.9-2.1 2.1.9 1.9a7 7 0 0 0-.6 1.4l-2 .7v3l2 .7a7 7 0 0 0 .6 1.4l-.9 1.9 2.1 2.1 1.9-.9a7 7 0 0 0 1.4.6l.7 2h3l.7-2a7 7 0 0 0 1.4-.6l1.9.9 2.1-2.1-.9-1.9a7 7 0 0 0 .6-1.4l2-.7Z"/>',
  diagnostics: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.7-5 3.4-7 8-7s7.3 2 8 7"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  home: '<path d="m3 11 9-8 9 8"/><path d="M5.5 10.5V21h13V10.5M10 21v-6h4v6"/>',
});

const FALLBACK = Object.freeze({ contacts: 'C', messages: 'M', calls: 'P', feed: 'F', insungram: 'I', live: 'L', notifications: 'N', gallery: 'G', search: 'S', maps: 'M', calendar: 'C', notes: 'N', files: 'F', wallet: 'W', shop: 'S', weather: 'W', health: 'H', theme: 'T', guide: '?', settings: 'S', diagnostics: 'D', back: '‹', close: '×', chevron: '›', more: '⋯', user: 'U', lock: '⌑', home: 'H' });

export function createHomeAppIcon({ document, appId }) {
  const wrapper = document.createElement('span');
  wrapper.className = 'tmrw-v3-home-app-icon';
  wrapper.dataset.icon = appId;
  wrapper.setAttribute?.('aria-hidden', 'true');
  const markup = ICONS[appId] || ICONS.guide;
  if ('innerHTML' in wrapper) {
    wrapper.innerHTML = `<svg class="tmrw-phone-svg" viewBox="0 0 24 24" width="25" height="25" aria-hidden="true" focusable="false">${markup}</svg>`;
  } else {
    wrapper.textContent = FALLBACK[appId] || String(appId || '?').slice(0, 1).toUpperCase();
  }
  return wrapper;
}

export function createPreviewIcon({ document, name, size = 24, className = '' }) {
  const wrapper = document.createElement('span');
  wrapper.className = ['tmrw-v3-preview-icon', className].filter(Boolean).join(' ');
  wrapper.dataset.icon = name;
  wrapper.setAttribute?.('aria-hidden', 'true');
  const markup = ICONS[name] || ICONS.grid;
  if (!ICONS[name]) wrapper.dataset.fallback = 'neutral';
  if ('innerHTML' in wrapper) wrapper.innerHTML = `<svg class="tmrw-phone-svg" viewBox="0 0 24 24" width="${Number(size) || 24}" height="${Number(size) || 24}" aria-hidden="true" focusable="false">${markup}</svg>`;
  else wrapper.textContent = FALLBACK[name] || '?';
  return wrapper;
}
