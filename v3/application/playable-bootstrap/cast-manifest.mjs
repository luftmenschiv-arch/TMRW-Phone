const text = value => String(value ?? '').replace(/\r\n?/g, '\n').trim();
const compact = value => text(value).replace(/\s+/gu, ' ');
const unique = values => [...new Set(values.map(compact).filter(Boolean))];
const CARD_FIELD_LABELS = new Set([
  'age', 'animal features', 'appearance', 'background', 'body', 'build', 'clothing', 'description', 'eyes', 'eye color',
  'gender', 'hair', 'hair color', 'height', 'history', 'likes', 'dislikes', 'name', 'note', 'notes', 'occupation', 'ooc',
  'personality', 'profile', 'pronouns', 'race', 'role', 'scenario', 'sex', 'skin', 'species', 'speech', 'status',
  'summary', 'traits', 'weight', 'world', 'setting', 'context', 'metadata', 'example dialogue', 'dialogue examples',
  'อายุ', 'รูปร่าง', 'ลักษณะ', 'ลักษณะภายนอก', 'เสื้อผ้า', 'ดวงตา', 'สีตา', 'เพศ', 'ผม', 'สีผม', 'ส่วนสูง',
  'ประวัติ', 'สิ่งที่ชอบ', 'สิ่งที่ไม่ชอบ', 'ชื่อ', 'โน้ต', 'หมายเหตุ', 'อาชีพ', 'นิสัย', 'บุคลิก', 'เผ่าพันธุ์',
  'สถานะ', 'บทบาท', 'บริบท', 'ฉาก', 'โลก', 'ข้อมูล', 'รายละเอียด', 'ตัวอย่างบทสนทนา',
]);
const fieldKey = value => compact(value).normalize('NFKC').toLocaleLowerCase().replace(/[：:]+$/u, '');
const GENERIC_FIELD_LABEL = /^(?:(?:character|personal|basic|physical|additional|other)\s+)?(?:info(?:rmation)?|details?|profile|prompt|instructions?|attributes?|features?|abilities|skills?|powers?|strengths?|weakness(?:es)?|goals?|motivation|relationships?|inventory|summary|description|history|background|personality|appearance|scenario|setting|context|metadata|examples?|dialogue|speech|style|tone)$/iu;
const CURRENT_CAST_WINDOW = 160;

function isMetadataLabel(value) {
  const key = fieldKey(value);
  return CARD_FIELD_LABELS.has(key) || GENERIC_FIELD_LABEL.test(key);
}

function recentChat(context, limit = CURRENT_CAST_WINDOW) {
  const chat = Array.isArray(context?.chat) ? context.chat : [];
  return chat.slice(Math.max(0, chat.length - limit));
}

function cardFromContext(context) {
  const characters = Array.isArray(context?.characters) ? context.characters : [];
  return context?.groupId ? null : (characters[Number(context?.characterId)] || null);
}

function declaredCast(context) {
  const card = cardFromContext(context);
  const candidates = [
    context?.tmrwCast,
    context?.chatMetadata?.tmrwCast,
    card?.tmrwCast,
    card?.data?.extensions?.tmrw_phone?.cast,
    card?.data?.extensions?.tmrwPhone?.cast,
  ].find(Array.isArray) || [];
  return candidates.map(row => typeof row === 'string' ? { name: row } : row).filter(row => row && compact(row.name || row.displayName));
}

function groupCast(context) {
  if (!context?.groupId) return [];
  const characters = Array.isArray(context.characters) ? context.characters : [];
  const group = Array.isArray(context.groups) ? context.groups.find(row => String(row?.id) === String(context.groupId)) : null;
  return (Array.isArray(group?.members) ? group.members : []).map(member => {
    const token = typeof member === 'object' && member ? (member.avatar ?? member.name ?? member.id) : member;
    const character = characters.find(row => String(row?.avatar ?? '') === String(token) || String(row?.name ?? '') === String(token) || String(row?.id ?? '') === String(token));
    return character ? { name: character.name, avatar: character.avatar, sourceId: character.avatar || character.id } : { name: token, sourceId: token };
  });
}

function contextCorpus(context) {
  const card = cardFromContext(context);
  const fields = [
    card?.description, card?.personality, card?.scenario, card?.first_mes, card?.mes_example,
    card?.data?.description, card?.data?.personality, card?.data?.scenario, card?.data?.first_mes, card?.data?.mes_example,
    context?.worldInfo, context?.world_info, context?.chatMetadata?.worldInfo,
  ];
  return fields.map(value => typeof value === 'string' ? value : '').filter(Boolean).join('\n');
}

function structuredNames(corpus) {
  const rows = [];
  for (const line of text(corpus).split('\n')) {
    const match = line.match(/^\s*(?:[-*•]\s*)?(?:#{1,4}\s*)?([\p{L}\p{N}][\p{L}\p{N} ._'’\-]{1,48})\s*(?::|—|–|\|)\s*\S/u);
    if (!match) continue;
    const name = compact(match[1]).replace(/^(?:name|character|ตัวละคร|ชื่อ)\s*[:：]?\s*/iu, '');
    if (name.length >= 2 && name.length <= 50 && !/[.!?。！？]$/u.test(name) && !isMetadataLabel(name)) rows.push(name);
  }
  return rows;
}

function dialogueNames(context) {
  const counts = new Map();
  for (const message of recentChat(context)) {
    const body = text(message?.mes);
    for (const match of body.matchAll(/(?:^|\n)\s*([\p{L}\p{N}][\p{L}\p{N} ._'’\-]{1,40})\s*[:：]\s*\S/gu)) {
      const name = compact(match[1]); counts.set(name, (counts.get(name) || 0) + 1);
    }
    const speaker = compact(message?.name || message?.extra?.name);
    if (speaker && !message?.is_user) counts.set(speaker, (counts.get(speaker) || 0) + 2);
  }
  return [...counts].filter(([, count]) => count >= 2).map(([name, count]) => ({ name, evidenceCount: count }));
}

function recentMentionCount(context, value) {
  const needle = compact(value).normalize('NFKC').toLocaleLowerCase();
  if (!needle) return 0;
  let count = 0;
  for (const message of recentChat(context)) {
    const body = compact(message?.mes).normalize('NFKC').toLocaleLowerCase();
    if (body.includes(needle)) count += 1;
  }
  return count;
}

function sceneRosterNames(context, primaryCharacterName) {
  const counts = new Map();
  const anchors = new Set(unique([
    primaryCharacterName,
    context?.name1,
    context?.name2,
    'คุณ', 'you', '{{user}}', '{{char}}',
  ]).map(value => fieldKey(value)));
  for (const message of recentChat(context)) {
    const header = text(message?.mes).match(/^\s*<([^>\n]{1,1200})>/u)?.[1];
    if (!header) continue;
    const foundThisTurn = new Set();
    for (const field of header.split('|')) {
      const tokens = field.split(/[,，]/u).map(compact).filter(Boolean);
      if (tokens.length < 2 || tokens.length > 8 || !tokens.some(token => anchors.has(fieldKey(token)))) continue;
      for (const token of tokens) {
        if (anchors.has(fieldKey(token)) || /\d|[<>|]/u.test(token) || token.length > 40 || isMetadataLabel(token)) continue;
        foundThisTurn.add(token);
      }
    }
    for (const name of foundThisTurn) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts].filter(([, evidenceCount]) => evidenceCount >= 5).map(([name, evidenceCount]) => ({ name, evidenceCount }));
}

const RECURRING_ROLE_PATTERNS = Object.freeze([
  ['ชายเจ้าของบ้าน', /ชายเจ้าของบ้าน/gu],
  ['หญิงเจ้าของบ้าน', /หญิงเจ้าของบ้าน/gu],
  ['เจ้าของบ้าน', /เจ้าของบ้าน/gu],
  ['เจ้าหน้าที่ชุดกาวน์', /เจ้าหน้าที่(?:ใน)?ชุดกาวน์/gu],
  ['เจ้าหน้าที่', /เจ้าหน้าที่/gu],
  ['เจ้าของร้าน', /เจ้าของร้าน/gu],
  ['ผู้จัดการ', /ผู้จัดการ/gu],
  ['เลขานุการ', /เลขานุการ/gu],
  ['บอดี้การ์ด', /บอดี้การ์ด/gu],
  ['คนขับรถ', /คนขับรถ/gu],
  ['นักสืบ', /นักสืบ/gu],
  ['ตำรวจ', /ตำรวจ/gu],
  ['พยาบาล', /พยาบาล/gu],
  ['คุณหมอ', /คุณหมอ/gu],
  ['ผู้คุม', /ผู้คุม/gu],
  ['อาจารย์', /อาจารย์/gu],
  ['the homeowner', /\bthe\s+homeowner\b/giu],
  ['the landlord', /\bthe\s+landlord\b/giu],
  ['the landlady', /\bthe\s+landlady\b/giu],
  ['the shopkeeper', /\bthe\s+shopkeeper\b/giu],
  ['the doctor', /\bthe\s+doctor\b/giu],
  ['the nurse', /\bthe\s+nurse\b/giu],
  ['the guard', /\bthe\s+guard\b/giu],
  ['the manager', /\bthe\s+manager\b/giu],
  ['the officer', /\bthe\s+officer\b/giu],
  ['the bartender', /\bthe\s+bartender\b/giu],
  ['the driver', /\bthe\s+driver\b/giu],
]);

function recurringRoleNames(context) {
  const counts = new Map();
  for (const message of recentChat(context)) {
    if (message?.is_user) continue;
    const body = text(message?.mes);
    if (!body) continue;
    const matchedThisTurn = [];
    for (const [name, pattern] of RECURRING_ROLE_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(body)) matchedThisTurn.push(name);
    }
    const mostSpecific = matchedThisTurn.filter(name => !matchedThisTurn.some(other => other !== name && other.includes(name)));
    for (const name of mostSpecific) counts.set(name, (counts.get(name) || 0) + 1);
  }
  const recurring = [...counts].filter(([, count]) => count >= 5).map(([name, evidenceCount]) => ({ name, evidenceCount }));
  return recurring.filter(row => !recurring.some(other => other !== row && other.name.includes(row.name)));
}

async function shortDigest(value) {
  const bytes = new TextEncoder().encode(String(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

function safeName(value) {
  const name = compact(value).replace(/^['"“”]+|['"“”]+$/gu, '');
  if (!name || name.length > 64 || isMetadataLabel(name) || /^(?:user|you|assistant|narrator|system|ผู้ใช้|คุณ|ฉัน|ผม|เรา)$/iu.test(name)) return null;
  return name;
}

export function collectPlayableCardContext(context = {}) {
  const card = cardFromContext(context);
  return Object.freeze({
    cardName: compact((context?.groupId && Array.isArray(context.groups) ? context.groups.find(row => String(row?.id) === String(context.groupId))?.name : null) || card?.name || context?.name2 || 'Character card'),
    primaryCharacterName: compact(card?.name || context?.name2),
    corpus: contextCorpus(context),
    declaredCast: Object.freeze(declaredCast(context).map(row => Object.freeze({ ...row }))),
    groupCast: Object.freeze(groupCast(context).map(row => Object.freeze({ ...row }))),
  });
}

export async function extractPlayableCastManifest(context = {}) {
  const source = collectPlayableCardContext(context);
  const candidates = [];
  const add = (row, evidence, confidence, evidenceCount = 1) => {
    const name = safeName(row?.name || row?.displayName); if (!name) return;
    candidates.push({ name, avatar: compact(row?.avatar), explicitSourceId: compact(row?.sourceId || row?.id), evidence, confidence, evidenceCount });
  };
  for (const row of source.declaredCast) add(row, 'declared-cast', 'confirmed', 10);
  for (const row of source.groupCast) add(row, 'sillytavern-group', 'confirmed', 10);
  if (!context?.groupId && source.primaryCharacterName && source.declaredCast.length === 0) add({ name: source.primaryCharacterName, sourceId: context?.characters?.[context?.characterId]?.avatar }, 'active-card', 'confirmed', 10);
  for (const name of unique(structuredNames(source.corpus))) {
    const evidenceCount = recentMentionCount(context, name);
    if (evidenceCount >= 2) add({ name }, 'card-structure', evidenceCount >= 5 ? 'probable' : 'candidate', evidenceCount);
  }
  for (const row of dialogueNames(context)) add(row, 'recurring-dialogue', row.evidenceCount >= 4 ? 'probable' : 'candidate', row.evidenceCount);
  for (const row of sceneRosterNames(context, source.primaryCharacterName)) add(row, 'scene-roster', row.evidenceCount >= 5 ? 'probable' : 'candidate', row.evidenceCount);
  for (const row of recurringRoleNames(context)) add(row, 'recurring-role', row.evidenceCount >= 5 ? 'probable' : 'candidate', row.evidenceCount);

  const merged = new Map();
  const rank = { candidate: 1, probable: 2, confirmed: 3 };
  for (const row of candidates) {
    const key = row.name.normalize('NFKC').toLocaleLowerCase(); const current = merged.get(key);
    if (!current) merged.set(key, { ...row, evidence: [row.evidence] });
    else { current.evidenceCount += row.evidenceCount; current.evidence = unique([...current.evidence, row.evidence]); if (rank[row.confidence] > rank[current.confidence]) current.confidence = row.confidence; current.avatar ||= row.avatar; current.explicitSourceId ||= row.explicitSourceId; }
  }
  const rows = [];
  for (const row of merged.values()) {
    const stable = row.explicitSourceId || await shortDigest(`${source.cardName}\u0000${row.name.normalize('NFKC').toLocaleLowerCase()}`);
    rows.push(Object.freeze({ sourceActorId: `cast:${stable}`, displayName: row.name, aliases: Object.freeze([]), avatar: row.avatar || null, confidence: row.confidence, evidence: Object.freeze(row.evidence), evidenceCount: row.evidenceCount, approved: row.confidence === 'confirmed' }));
  }
  rows.sort((left, right) => (rank[right.confidence] - rank[left.confidence]) || right.evidenceCount - left.evidenceCount || left.displayName.localeCompare(right.displayName));
  return Object.freeze({ version: 1, cardName: source.cardName, cast: Object.freeze(rows), approvedCast: Object.freeze(rows.filter(row => row.approved)), candidates: Object.freeze(rows.filter(row => !row.approved)) });
}
