import { PREVIEW37_MAX_ITEMS } from './constants.mjs';
import { boundedPreviewText, previewDigest } from './digest.mjs';

const objectEntries = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
const stable = value => String(value ?? '').trim();
const scopeKey = (cardKey, storyKey, branchKey) => `${cardKey}::${storyKey}::${branchKey}`;
const messageParts = raw => Array.isArray(raw)
  ? { senderId: stable(raw[0]), text: boundedPreviewText(raw[1]), displayedTime: raw[2] ?? null, messageId: stable(raw[3]), metadata: raw[4] && typeof raw[4] === 'object' ? structuredClone(raw[4]) : {} }
  : { senderId: stable(raw?.senderId || raw?.from), text: boundedPreviewText(raw?.text || raw?.body), displayedTime: raw?.time ?? raw?.createdAt ?? null, messageId: stable(raw?.id || raw?.eventId), metadata: raw && typeof raw === 'object' ? structuredClone(raw) : {} };

export async function inventoryPreview37(snapshot) {
  if (!snapshot?.available) return Object.freeze({ available: false, fatal: false, cards: Object.freeze([]), scopes: Object.freeze([]), sourceRecordCount: 0, issues: Object.freeze([]), deferredCounts: Object.freeze({}) });
  const root = snapshot.record; const issues = []; const cards = []; const scopes = []; let sourceRecordCount = 0;
  if (!root.cards || typeof root.cards !== 'object' || Array.isArray(root.cards)) return Object.freeze({ available: true, fatal: true, cards: Object.freeze([]), scopes: Object.freeze([]), sourceRecordCount: 0, issues: Object.freeze([{ code: 'unsupported-project-root', message: 'Preview 37 cards collection is missing or malformed.' }]), deferredCounts: Object.freeze({}) });
  const deferredCounts = { notes: 0, gallery: 0, search: 0, feed: 0, live: 0, wallet: 0, shop: 0, calendar: 0, maps: 0, otherPhoneRows: 0 };
  for (const [cardKeyRaw, cardRaw] of objectEntries(root.cards)) {
    if (sourceRecordCount >= PREVIEW37_MAX_ITEMS) { issues.push({ code: 'inventory-bound-reached', message: `Preview inventory stopped at ${PREVIEW37_MAX_ITEMS} records.` }); break; }
    const cardKey = stable(cardRaw?.cardKey || cardKeyRaw); const cast = Array.isArray(cardRaw?.cast) ? cardRaw.cast.map(member => Object.freeze({ sourceMemberId: stable(member?.id), sourceActorId: stable(member?.actorId), sourceInstanceId: stable(member?.instanceId), displayName: boundedPreviewText(member?.name, 256), aliases: Array.isArray(member?.aliases) ? member.aliases.map(value => boundedPreviewText(value, 256)) : [], hasPhone: member?.hasPhone !== false })) : [];
    cards.push(Object.freeze({ cardKey, displayName: boundedPreviewText(cardRaw?.cardName || cardKey, 256), cast: Object.freeze(cast) })); sourceRecordCount += 1;
    for (const [storyKeyRaw, storyRaw] of objectEntries(cardRaw?.stories)) for (const [branchKeyRaw, branchRaw] of objectEntries(storyRaw?.branches)) {
      const storyKey = stable(storyRaw?.storyId || storyKeyRaw); const branchKey = stable(branchRaw?.branchId || branchKeyRaw); const key = scopeKey(cardKey, storyKey, branchKey); const phones = branchRaw?.phones && typeof branchRaw.phones === 'object' && !Array.isArray(branchRaw.phones) ? structuredClone(branchRaw.phones) : {}; const shared = branchRaw?.shared && typeof branchRaw.shared === 'object' ? branchRaw.shared : {};
      const threads = [];
      for (const threadRaw of Array.isArray(shared.conversations) ? shared.conversations : []) {
        const threadId = stable(threadRaw?.id); const type = stable(threadRaw?.type); const participantIds = [...new Set((threadRaw?.participantIds || threadRaw?.memberIds || []).map(stable).filter(Boolean))]; const messages = [];
        for (const messageRaw of Array.isArray(threadRaw?.messages) ? threadRaw.messages : []) { const parsed = messageParts(messageRaw); const fingerprint = await previewDigest({ threadId, ...parsed }); messages.push(Object.freeze({ ...parsed, sourceFingerprint: fingerprint })); sourceRecordCount += 1; }
        threads.push(Object.freeze({ threadId, type, participantIds: Object.freeze(participantIds), name: boundedPreviewText(threadRaw?.name, 256), source: stable(threadRaw?.source), messages: Object.freeze(messages) })); sourceRecordCount += 1;
      }
      const calls = (Array.isArray(shared.callEvents) ? shared.callEvents : []).map(call => Object.freeze({ callId: stable(call?.id), callerId: stable(call?.callerId), calleeId: stable(call?.calleeId), status: stable(call?.status), durationSec: Number(call?.durationSec || 0), displayedTime: call?.clock ?? call?.time ?? null, source: stable(call?.source), transcript: Array.isArray(call?.transcript) ? structuredClone(call.transcript) : [] })); sourceRecordCount += calls.length;
      for (const phone of Object.values(phones)) { deferredCounts.notes += Array.isArray(phone?.notes) ? phone.notes.length : 0; deferredCounts.gallery += Array.isArray(phone?.gallery) ? phone.gallery.length : 0; deferredCounts.search += Array.isArray(phone?.search) ? phone.search.length : 0; deferredCounts.wallet += Array.isArray(phone?.wallet) ? phone.wallet.length : 0; deferredCounts.shop += Array.isArray(phone?.shop) ? phone.shop.length : 0; deferredCounts.calendar += Array.isArray(phone?.calendar) ? phone.calendar.length : 0; deferredCounts.maps += Array.isArray(phone?.maps) ? phone.maps.length : 0; deferredCounts.feed += Array.isArray(phone?.social?.feed) ? phone.social.feed.length : 0; deferredCounts.live += Array.isArray(phone?.social?.liveRooms) ? phone.social.liveRooms.length : 0; }
      deferredCounts.feed += Array.isArray(shared.feedPosts) ? shared.feedPosts.length : 0; deferredCounts.live += Array.isArray(shared.liveRooms) ? shared.liveRooms.length : 0;
      scopes.push(Object.freeze({ sourceScopeKey: key, cardKey, storyKey, branchKey, phones: Object.freeze(phones), threads: Object.freeze(threads), calls: Object.freeze(calls) }));
    }
  }
  return Object.freeze({ available: true, fatal: false, cards: Object.freeze(cards), scopes: Object.freeze(scopes), sourceRecordCount, issues: Object.freeze(issues), deferredCounts: Object.freeze(deferredCounts) });
}

export { scopeKey as previewScopeKey };

