const ICONS = Object.freeze({
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
  const markup = ICONS[name] || ICONS.calls;
  if ('innerHTML' in wrapper) wrapper.innerHTML = `<svg class="tmrw-phone-svg" viewBox="0 0 24 24" width="${Number(size) || 24}" height="${Number(size) || 24}" aria-hidden="true" focusable="false">${markup}</svg>`;
  else wrapper.textContent = FALLBACK[name] || '?';
  return wrapper;
}
