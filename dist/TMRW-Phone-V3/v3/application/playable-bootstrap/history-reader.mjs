const clean = value => String(value ?? '').replace(/\r\n?/g, '\n').trim();

async function digest(value) {
  const bytes = new TextEncoder().encode(String(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function readPlayableHistory(context = {}, { startOrdinal = 0, endOrdinal = null, chunkMessages = 24, chunkCharacters = 12_000 } = {}) {
  const chat = Array.isArray(context?.chat) ? context.chat : [];
  const start = Math.max(0, Math.trunc(Number(startOrdinal) || 0));
  const end = Math.max(start, Math.min(chat.length, endOrdinal == null ? chat.length : Math.trunc(Number(endOrdinal) || 0)));
  const maxMessages = Math.max(1, Math.min(100, Math.trunc(Number(chunkMessages) || 24)));
  const maxCharacters = Math.max(1000, Math.min(30_000, Math.trunc(Number(chunkCharacters) || 12_000)));
  const entries = [];
  for (let ordinal = start; ordinal < end; ordinal += 1) {
    const message = chat[ordinal]; if (!message) continue;
    const role = message.is_user ? 'user' : 'assistant'; const content = clean(message.mes);
    const version = `${Number(message.swipe_id || 0)}:${(await digest(content)).slice(0, 16)}`;
    entries.push(Object.freeze({ ordinal, role, speaker: clean(message.name || message.extra?.name) || role, content, version, sourceMessageId: `${String(context.chatId || context.getCurrentChatId?.() || 'current')}:${ordinal}` }));
  }
  const chunks = []; let current = []; let characters = 0;
  for (const entry of entries) {
    const size = entry.content.length + entry.speaker.length + 24;
    if (current.length && (current.length >= maxMessages || characters + size > maxCharacters)) { chunks.push(current); current = []; characters = 0; }
    current.push(entry); characters += size;
  }
  if (current.length) chunks.push(current);
  const frozenChunks = [];
  for (const rows of chunks) frozenChunks.push(Object.freeze({ startOrdinal: rows[0].ordinal, endOrdinal: rows.at(-1).ordinal + 1, entries: Object.freeze(rows), fingerprint: (await digest(rows.map(row => `${row.sourceMessageId}:${row.version}`).join('|'))).slice(0, 24) }));
  return Object.freeze({ startOrdinal: start, endOrdinal: end, totalMessages: chat.length, scannedMessages: entries.length, chunks: Object.freeze(frozenChunks), headFingerprint: (await digest(entries.map(row => `${row.sourceMessageId}:${row.version}`).join('|'))).slice(0, 24) });
}

export function recentHistoryWindow(totalMessages, size = 48) {
  const total = Math.max(0, Math.trunc(Number(totalMessages) || 0)); const bounded = Math.max(1, Math.min(200, Math.trunc(Number(size) || 48)));
  return Object.freeze({ startOrdinal: Math.max(0, total - bounded), endOrdinal: total });
}
