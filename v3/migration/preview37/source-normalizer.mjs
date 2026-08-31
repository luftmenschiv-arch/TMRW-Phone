const objectValues = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.values(value) : [];

function deleteUndefinedOwn(object, key) {
  if (!object || typeof object !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(object, key) || object[key] !== undefined) return false;
  delete object[key];
  return true;
}

function normalizeMessageMembership(messageRaw) {
  if (Array.isArray(messageRaw)) {
    const metadata = messageRaw[4];
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) deleteUndefinedOwn(metadata, 'memberIds');
    return;
  }
  if (messageRaw && typeof messageRaw === 'object') deleteUndefinedOwn(messageRaw, 'memberIds');
}

export function normalizePreview37MigrationSource(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('Preview 37 source root must be an object');
  const normalized = structuredClone(record);
  for (const card of objectValues(normalized.cards)) {
    for (const story of objectValues(card?.stories)) {
      for (const branch of objectValues(story?.branches)) {
        const conversations = branch?.shared?.conversations;
        if (!Array.isArray(conversations)) continue;
        for (const conversation of conversations) {
          if (!conversation || typeof conversation !== 'object' || Array.isArray(conversation)) continue;
          deleteUndefinedOwn(conversation, 'participantIds');
          deleteUndefinedOwn(conversation, 'memberIds');
          if (Array.isArray(conversation.messages)) {
            for (const messageRaw of conversation.messages) normalizeMessageMembership(messageRaw);
          }
        }
      }
    }
  }
  return normalized;
}
