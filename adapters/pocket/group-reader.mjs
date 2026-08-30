export function pocketGroupRows(config) {
  const groups = Array.isArray(config?.groups) ? config.groups : []; const threads = config?.threads && typeof config.threads === 'object' ? config.threads : {}; const rows = [];
  for (const group of groups) { const groupId = String(group?.id || '').trim(); if (!groupId) { rows.push(Object.freeze({ unsupported: true, reason: 'Pocket Group lacks stable id.' })); continue; } const messages = threads[groupId]; if (!Array.isArray(messages)) { rows.push(Object.freeze({ unsupported: true, groupId, group, reason: 'Pocket Group Thread is not an array.' })); continue; } for (const [index, message] of messages.entries()) rows.push(Object.freeze({ groupId, group, index, message })); }
  return Object.freeze(rows);
}
