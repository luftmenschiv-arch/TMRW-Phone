export function pocketDirectThreadRows(config) {
  const threads = config?.threads; const groups = new Set((Array.isArray(config?.groups) ? config.groups : []).map(group => String(group?.id || ''))); if (!threads || typeof threads !== 'object' || Array.isArray(threads)) return Object.freeze([]);
  const rows = []; for (const [threadKey, messages] of Object.entries(threads)) if (!groups.has(String(threadKey))) {
    if (!Array.isArray(messages)) { rows.push(Object.freeze({ unsupported: true, threadKey, reason: 'Pocket direct Thread is not an array.' })); continue; }
    const contactId = String(threadKey).split('::')[0]; for (const [index, message] of messages.entries()) rows.push(Object.freeze({ threadKey: String(threadKey), contactId, index, message }));
  } return Object.freeze(rows);
}
