import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { requireEventScope } from '../../domain/events/event-validator.mjs';
import { createActor } from '../../domain/identity/actor.mjs';
import { createCharacterInstance } from '../../domain/identity/character-instance.mjs';
import { createDevice } from '../../domain/identity/device.mjs';
import { createAccount } from '../../domain/identity/account.mjs';
import { ACTOR_CONTROL } from '../../domain/identity/control-authority.mjs';
import { deterministicIdentityId } from '../../domain/identity/id.mjs';
import { normalizeWorldSocialBible } from '../../ui/settings-beta.mjs';

const clean = value => String(value ?? '').replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim();
const bounded = (value, length) => clean(value).slice(0, length);
const unique = values => [...new Set((values || []).map(clean).filter(Boolean))];
const fallbackHandles = Object.freeze(['คนเฝ้าข่าว', 'เสียงจากตลาด', 'คนผ่านทาง', 'นักจดเรื่องเมือง', 'ผู้เห็นเหตุการณ์', 'คนนอกวง']);

async function shortHash(value, length = 20) {
  const bytes = new TextEncoder().encode(String(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, length);
}

function jsonCandidate(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
  const first = text.indexOf('{'); const last = text.lastIndexOf('}');
  return first >= 0 && last > first ? text.slice(first, last + 1) : null;
}

function cardContext(context) {
  const characters = Array.isArray(context?.characters) ? context.characters : [];
  const card = characters[Number(context?.characterId)] || null;
  const fields = [
    context?.name2, context?.scenario, context?.worldInfo, context?.world_info, context?.chatMetadata?.worldInfo,
    card?.description, card?.personality, card?.scenario, card?.first_mes, card?.mes_example,
    card?.data?.description, card?.data?.personality, card?.data?.scenario, card?.data?.first_mes, card?.data?.mes_example,
  ];
  return fields.map(value => typeof value === 'string' ? value.trim() : '').filter(Boolean).join('\n\n');
}

function historyContext(context, { recent = 80, maxCharacters = 18_000 } = {}) {
  const chat = Array.isArray(context?.chat) ? context.chat : [];
  const selected = [...chat.slice(0, 2), ...chat.slice(-recent)];
  const seen = new Set(); const rows = [];
  for (const message of selected) {
    if (!message || seen.has(message)) continue; seen.add(message);
    const body = clean(message?.mes ?? message?.content); if (!body) continue;
    rows.push(`${message?.is_user ? 'ผู้เล่น' : clean(message?.name || context?.name2 || 'ตัวละคร')}: ${body}`);
  }
  return rows.join('\n').slice(-maxCharacters);
}

function publicRecentContext(context, limit = 24) {
  const chat = Array.isArray(context?.chat) ? context.chat : [];
  return chat.slice(-limit).map(message => `${message?.is_user ? 'ผู้เล่น' : clean(message?.name || context?.name2 || 'ตัวละคร')}: ${clean(message?.mes ?? message?.content)}`).filter(row => !row.endsWith(': ')).join('\n').slice(-9000);
}

function fallbackBible(context, sourceFingerprint, now) {
  const corpus = clean(`${cardContext(context)} ${historyContext(context, { recent: 30, maxCharacters: 8000 })}`);
  const summary = corpus.slice(0, 1400) || 'โลกและสังคมของเรื่องปัจจุบันตามข้อมูลในการ์ดและบทสนทนา';
  return normalizeWorldSocialBible({ sourceFingerprint, worldSummary: summary, socialOrder: 'ยึดลำดับชนชั้น บทบาท และความสัมพันธ์ตามเรื่องปัจจุบัน', economyAndLaw: 'ยึดกฎ เศรษฐกิจ และสิ่งที่ซื้อขายได้ตามบริบทของเรื่อง', technologyAndMedia: 'ใช้รูปแบบสื่อที่เป็นไปได้ในโลกนี้เท่านั้น', languageStyle: 'ใช้ภาษาไทยธรรมชาติ โดยคงคำเฉพาะของโลกและน้ำเสียงของผู้คนแต่ละกลุ่ม', publicNorms: [summary.slice(0, 220)], institutions: [], tensions: [], currentPublicEvents: [], updatedAt: now });
}

function parseBible(value, sourceFingerprint, now) {
  try { const parsed = JSON.parse(jsonCandidate(value)); return parsed && typeof parsed === 'object' && clean(parsed.worldSummary) ? normalizeWorldSocialBible({ ...parsed, sourceFingerprint, updatedAt: now }) : null; }
  catch { return null; }
}

function parseBatch(value) {
  try {
    const parsed = JSON.parse(jsonCandidate(value));
    const posts = (Array.isArray(parsed?.posts) ? parsed.posts : []).slice(0, 12).map(post => ({
      author: bounded(post?.author, 64),
      text: String(post?.text || '').trim().slice(0, 1800),
      likes: Math.max(0, Math.min(12, Math.trunc(Number(post?.likes) || 0))),
      comments: (Array.isArray(post?.comments) ? post.comments : []).slice(0, 6).map(comment => ({ author: bounded(comment?.author, 64), text: String(comment?.text || '').trim().slice(0, 900) })).filter(comment => comment.author && comment.text),
    })).filter(post => post.author && post.text);
    return posts.length ? posts : null;
  } catch { return null; }
}

function parseReplies(value) {
  try {
    const parsed = JSON.parse(jsonCandidate(value));
    return (Array.isArray(parsed?.replies) ? parsed.replies : []).slice(0, 6).map(reply => ({ author: bounded(reply?.author, 64), text: String(reply?.text || '').trim().slice(0, 900) })).filter(reply => reply.author && reply.text);
  } catch { return []; }
}

function fallbackBatch(bible, startIndex) {
  const facts = unique([...(bible.currentPublicEvents || []), ...(bible.tensions || []), ...(bible.publicNorms || []), bible.worldSummary]).filter(Boolean);
  return Array.from({ length: 9 }, (_, offset) => {
    const index = startIndex + offset; const fact = facts[index % Math.max(1, facts.length)] || bible.worldSummary;
    const author = fallbackHandles[index % fallbackHandles.length];
    return Object.freeze({ author, text: `${bounded(fact, 360)} — คนในพื้นที่มองเรื่องนี้กันอย่างไรบ้าง?`, likes: 2 + (index % 5), comments: Object.freeze([{ author: fallbackHandles[(index + 1) % fallbackHandles.length], text: 'ประเด็นนี้ต้องมองตามกฎและค่านิยมของโลกนี้จริง ๆ' }, { author: fallbackHandles[(index + 2) % fallbackHandles.length], text: 'อยากฟังข้อมูลจากคนที่อยู่ในเหตุการณ์มากกว่านี้' }]) });
  });
}

export class AdaptiveWorldPulseService {
  #unit; #social; #settings; #getContext; #now; #buffers = new Map(); #worlds = new Map();
  constructor({ database, socialService, settingsService = null, getContext = () => ({}), now = () => new Date().toISOString() }) {
    if (!database || !socialService) throw new TypeError('AdaptiveWorldPulseService requires database and Social service');
    this.#unit = new V3UnitOfWork(database); this.#social = socialService; this.#settings = settingsService; this.#getContext = getContext; this.#now = now;
  }

  #scopeKey(scope) { return `${scope.storyId}:${scope.branchId}`; }

  async #generate(options) {
    const context = this.#getContext() || {};
    if (typeof context.generateQuietPrompt !== 'function') return null;
    return context.generateQuietPrompt({ quietPrompt: options.prompt, quietToLoud: false, skipWIAN: false, quietName: options.name || 'TMRW Social', responseLength: options.responseLength || 8192, forceChId: Number.isInteger(context.characterId) ? context.characterId : null, removeReasoning: true, trimToSentence: false, jsonSchema: options.jsonSchema });
  }

  async prepareWorld({ scope: inputScope, playerInstanceId = null, force = false } = {}) {
    const scope = requireEventScope(inputScope); const context = this.#getContext() || {}; const source = `${cardContext(context)}\n${historyContext(context)}`; const sourceFingerprint = await shortHash(source || this.#scopeKey(scope), 24); const key = this.#scopeKey(scope);
    if (!force && this.#worlds.get(key)?.sourceFingerprint === sourceFingerprint) return this.#worlds.get(key);
    if (!force && this.#settings && playerInstanceId) {
      const stored = (await this.#settings.get({ scope, playerInstanceId })).worldSocialBible;
      if (stored?.sourceFingerprint === sourceFingerprint && stored.worldSummary) { this.#worlds.set(key, stored); return stored; }
    }
    const prompt = [
      'สร้างคัมภีร์สังคมสำหรับฟีดโทรศัพท์ในโลกโรลเพลย์นี้ ตอบเป็น JSON เท่านั้น',
      'ต้องยึดโลกจริงของเรื่อง แม้มีระบบชนชั้น การค้าทาส เผ่าพันธุ์เหนือมนุษย์ กฎหมายหรือศีลธรรมที่ต่างจากโลกปัจจุบัน ห้ามทำให้กลายเป็นสังคมไทยยุคปัจจุบันโดยอัตโนมัติ',
      'แยกข้อเท็จจริงของโลกออกจากเหตุการณ์ส่วนตัว สิ่งที่จะเข้าฟีดได้ต้องเป็นเรื่องที่สาธารณะหรือเป็นกระแสที่คนในโลกมีเหตุผลจะรับรู้',
      'ใช้ภาษาไทยทั้งหมด ห้ามใส่ภาษาต่างประเทศแล้ววงเล็บคำแปลไทย',
      'JSON keys: worldSummary, socialOrder, economyAndLaw, technologyAndMedia, languageStyle, publicNorms[], institutions[], tensions[], currentPublicEvents[]',
      '', 'ข้อมูลการ์ดและลอว์บุ๊ก:', cardContext(context).slice(0, 14000), '', 'ประวัติเรื่อง:', historyContext(context),
    ].join('\n');
    const schema = { type: 'object', additionalProperties: false, required: ['worldSummary','socialOrder','economyAndLaw','technologyAndMedia','languageStyle','publicNorms','institutions','tensions','currentPublicEvents'], properties: { worldSummary:{type:'string'}, socialOrder:{type:'string'}, economyAndLaw:{type:'string'}, technologyAndMedia:{type:'string'}, languageStyle:{type:'string'}, publicNorms:{type:'array',items:{type:'string'}}, institutions:{type:'array',items:{type:'string'}}, tensions:{type:'array',items:{type:'string'}}, currentPublicEvents:{type:'array',items:{type:'string'}} } };
    let bible = null;
    try { bible = parseBible(await this.#generate({ prompt, jsonSchema: schema, name: 'TMRW World Social Bible' }), sourceFingerprint, this.#now()); } catch {}
    bible ||= fallbackBible(context, sourceFingerprint, this.#now()); this.#worlds.set(key, bible);
    if (this.#settings && playerInstanceId) await this.#settings.setWorldSocialBible({ scope, playerInstanceId, bible });
    return bible;
  }

  async #identity(scope, handle) {
    const authority = 'tmrw-world-social'; const stable = `${scope.storyId}:${clean(handle).normalize('NFKC').toLocaleLowerCase()}`; const now = this.#now(); const manifestId = `world-social:${scope.storyId}`;
    const actorId = await deterministicIdentityId('actor', { sourceAuthority: authority, stableSourceId: stable });
    const instanceId = await deterministicIdentityId('character-instance', { sourceAuthority: authority, stableSourceId: actorId, scopeParts: [scope.storyId, scope.branchId] });
    const deviceId = await deterministicIdentityId('device', { sourceAuthority: authority, stableSourceId: 'social', scopeParts: [instanceId] });
    const accountId = await deterministicIdentityId('account', { sourceAuthority: authority, stableSourceId: 'feed', scopeParts: [instanceId] });
    await this.#unit.readwrite({ stores: ['actors', 'instances', 'devices', 'accounts'], scope }, async repositories => {
      const actor = await repositories.actors.get(actorId); const instance = await repositories.instances.get(instanceId); const device = await repositories.devices.get(deviceId); const account = await repositories.accounts.get(accountId);
      await repositories.actors.put(createActor({ id: actorId, sourceAuthority: authority, sourceActorId: stable, displayName: handle, aliases: [], control: ACTOR_CONTROL.AI, controlKey: `${authority}:${stable}`, createdAt: actor?.createdAt || now, updatedAt: now, manifestId, existingManifestIds: actor?.manifestIds || [] }));
      await repositories.instances.put(createCharacterInstance({ id: instanceId, actorId, storyId: scope.storyId, branchId: scope.branchId, aliases: [], createdAt: instance?.createdAt || now, updatedAt: now, manifestId, existingManifestIds: instance?.manifestIds || [] }));
      await repositories.devices.put(createDevice({ id: deviceId, storyId: scope.storyId, branchId: scope.branchId, ownerInstanceId: instanceId, deviceKey: 'social', kind: 'social-simulation', label: `${handle} Social`, createdAt: device?.createdAt || now, updatedAt: now, manifestId, existingManifestIds: device?.manifestIds || [] }));
      await repositories.accounts.put(createAccount({ id: accountId, storyId: scope.storyId, branchId: scope.branchId, ownerInstanceId: instanceId, accountKey: 'feed', kind: 'social', label: handle, deviceIds: [deviceId], createdAt: account?.createdAt || now, updatedAt: now, manifestId, existingManifestIds: account?.manifestIds || [] }));
    });
    return Object.freeze({ actorId, instanceId, deviceId, accountId, handle });
  }

  async #existingCount(scope) {
    return this.#unit.readonly({ stores: ['socialPosts', 'accounts', 'instances', 'actors'], scope }, async repositories => {
      let count = 0;
      for (const post of await repositories.socialPosts.list()) {
        const account = await repositories.accounts.get(post.authorAccountId); const instance = account && await repositories.instances.get(account.ownerInstanceId); const actor = instance && await repositories.actors.get(instance.actorId);
        if (actor?.sourceAuthority === 'tmrw-world-social') count += 1;
      }
      return count;
    });
  }

  async #generateBatch(scope, bible, startIndex) {
    const context = this.#getContext() || {};
    const prompt = [
      'สร้างฟีดสังคมออนไลน์ที่เป็นส่วนหนึ่งของโลกโรลเพลย์ ตอบเป็น JSON เท่านั้น',
      'สร้าง 9 โพสต์ แต่ละโพสต์มีผู้เขียน เนื้อหา ยอดถูกใจโดยประมาณ และคอมเมนต์ 2-4 รายการ',
      'ผู้เขียนต้องเป็นชาวเมือง กลุ่มอาชีพ ผู้พบเห็น ลูกค้า คนงาน นักข่าว หรือผู้ใช้สื่อที่เหมาะกับโลก ไม่ใช้ชุดชื่อสำเร็จรูปซ้ำ ๆ',
      'น้ำเสียงและประเด็นต้องสอดคล้องกับกฎหมาย ชนชั้น เผ่าพันธุ์ เศรษฐกิจ เทคโนโลยี และศีลธรรมของโลกนี้ ไม่ยัดวัฒนธรรมไทยปัจจุบันหากไม่เข้ากับฉาก',
      'ห้ามให้ชาวเน็ตรู้ฉากส่วนตัว ความคิดในใจ หรือบทสนทนาปิด ใช้ได้เฉพาะข้อเท็จจริงสาธารณะ ข่าวลือที่มีที่มา และหัวข้อทั่วไปในโลก',
      'ใช้ภาษาไทยทั้งหมด ห้ามใส่ภาษาต่างประเทศแล้ววงเล็บคำแปลไทย หลีกเลี่ยงประโยคซ้ำและคอมเมนต์ลอย ๆ',
      'JSON: {"posts":[{"author":"ชื่อบัญชี","text":"โพสต์","likes":3,"comments":[{"author":"ชื่อบัญชี","text":"ความคิดเห็น"}]}]}',
      '', 'คัมภีร์สังคม:', JSON.stringify(bible), '', 'เหตุการณ์ช่วงล่าสุด (ใช้เฉพาะส่วนที่สมเหตุผลว่าจะเป็นสาธารณะ):', publicRecentContext(context), '', `ลำดับชุด: ${startIndex}`,
    ].join('\n');
    const schema = { type:'object', additionalProperties:false, required:['posts'], properties:{ posts:{ type:'array', minItems:6, maxItems:12, items:{ type:'object', additionalProperties:false, required:['author','text','likes','comments'], properties:{ author:{type:'string'}, text:{type:'string'}, likes:{type:'integer'}, comments:{type:'array',items:{type:'object',additionalProperties:false,required:['author','text'],properties:{author:{type:'string'},text:{type:'string'}}}} } } } } };
    try { const generated = parseBatch(await this.#generate({ prompt, jsonSchema: schema, name: 'TMRW Living Feed', responseLength: 12288 })); if (generated) return generated; } catch {}
    return fallbackBatch(bible, startIndex);
  }

  async #commitPost(scope, spec, index) {
    const author = await this.#identity(scope, spec.author); const prepared = [];
    for (const row of [...spec.comments, ...fallbackHandles.map(handle => ({ author: handle }))]) prepared.push(await this.#identity(scope, row.author));
    // The projection count can lag an already committed canonical Event after
    // an interrupted mobile refresh. Include the generated content in the
    // source identity so retrying that numerical slot with new copy cannot
    // reuse an older Event's idempotency key.
    const contentKey = await shortHash(JSON.stringify({ author: spec.author, text: spec.text, comments: spec.comments }), 16);
    const recordId = `${scope.branchId}:world-feed-v4:${index}:${contentKey}`;
    const result = await this.#social.createPost({ scope, authorAccountId: author.accountId, actualAuthorActorId: author.actorId, actualAuthorInstanceId: author.instanceId, deviceId: author.deviceId, text: spec.text, audience: { kind: 'public' }, source: { authority: 'tmrw-world-social', kind: 'world-grounded-simulation', recordId, version: '4' }, producer: 'adaptive-world-pulse', idempotencyKey: `world-feed-v4:${recordId}` });
    const reactors = [];
    for (const identity of prepared) { if (reactors.length >= Math.max(0, Math.min(spec.likes, 8))) break; if (identity.accountId !== author.accountId && !reactors.some(item => item.accountId === identity.accountId)) reactors.push(identity); }
    for (const [offset, reactor] of reactors.entries()) await this.#social.setEngagement({ scope, targetId: result.post.postId, actorAccountId: reactor.accountId, actualActorId: reactor.actorId, actualInstanceId: reactor.instanceId, active: true, source: { authority: 'tmrw-world-social', kind: 'world-grounded-simulation', recordId: `${recordId}:like:${offset}`, version: '4' }, producer: 'adaptive-world-pulse', idempotencyKey: `world-feed-v4:${recordId}:like:${offset}` });
    for (const [offset, item] of spec.comments.entries()) { const commenter = await this.#identity(scope, item.author); await this.#social.createComment({ scope, postId: result.post.postId, authorAccountId: commenter.accountId, actualAuthorActorId: commenter.actorId, actualAuthorInstanceId: commenter.instanceId, deviceId: commenter.deviceId, text: item.text, source: { authority: 'tmrw-world-social', kind: 'world-grounded-simulation', recordId: `${recordId}:comment:${offset}`, version: '4' }, producer: 'adaptive-world-pulse', idempotencyKey: `world-feed-v4:${recordId}:comment:${offset}` }); }
    return result.post;
  }

  async refresh({ scope: inputScope, count = 3, playerInstanceId = null } = {}) {
    const scope = requireEventScope(inputScope); const key = this.#scopeKey(scope); const bible = await this.prepareWorld({ scope, playerInstanceId }); const existing = await this.#existingCount(scope); let buffer = this.#buffers.get(key) || [];
    if (buffer.length < count) buffer = await this.#generateBatch(scope, bible, existing); this.#buffers.set(key, buffer);
    const selected = buffer.splice(0, Math.max(1, Math.min(6, Number(count) || 3))); const created = [];
    for (const [offset, spec] of selected.entries()) created.push(await this.#commitPost(scope, spec, existing + offset));
    return Object.freeze({ created: Object.freeze(created), remainingBuffered: buffer.length, refilledInBatch: buffer.length + selected.length >= 6, worldFingerprint: bible.sourceFingerprint });
  }

  async prime({ scope, minimum = 6, playerInstanceId = null } = {}) {
    const normalized = requireEventScope(scope); const existing = await this.#existingCount(normalized); const created = [];
    while (existing + created.length < minimum) created.push(...(await this.refresh({ scope: normalized, count: Math.min(3, minimum - existing - created.length), playerInstanceId })).created);
    return Object.freeze({ existing, created: Object.freeze(created), ready: existing + created.length >= minimum });
  }

  async respondToPlayerAction({ scope: inputScope, playerInstanceId = null, postId, parentCommentId = null, actionText = '', actionKind = 'comment', onProgress = null } = {}) {
    const scope = requireEventScope(inputScope); const bible = await this.prepareWorld({ scope, playerInstanceId }); const post = await this.#social.getPost({ scope, postId }); if (!post) throw new Error('ไม่พบโพสต์ที่ต้องการตอบ');
    const comments = await this.#social.listComments({ scope, viewerAccountId: post.authorAccountId, postId, limit: 30 });
    const eligible = await this.#unit.readonly({ stores:['accounts','instances','actors','devices'], scope }, async repositories => {
      const publicPost=post.audience?.kind==='public';const permitted=new Set(post.audience?.recipientAccountIds||[]);const accounts=publicPost?await repositories.accounts.list():await Promise.all([...permitted].map(id=>repositories.accounts.get(id)));const rows=[];for(const account of accounts){if(!account||(!publicPost&&!permitted.has(account.id)))continue;const instance=await repositories.instances.get(account.ownerInstanceId);const actor=instance&&await repositories.actors.get(instance.actorId);if(actor?.sourceAuthority!=='tmrw-world-social')continue;const deviceId=account.deviceIds?.[0];if(deviceId)rows.push(Object.freeze({actorId:actor.id,instanceId:instance.id,deviceId,accountId:account.id,handle:account.label||actor.displayName}));}return Object.freeze(rows);
    });
    if(!eligible.length)return Object.freeze({generated:0,comments:Object.freeze([])});
    const prompt = [
      'สร้างปฏิกิริยาของผู้ใช้อินเทอร์เน็ตในโลกโรลเพลย์ต่อการกระทำของผู้เล่น ตอบ JSON เท่านั้น',
      actionKind === 'post' ? 'สร้างคำตอบ 2-6 รายการต่อโพสต์ใหม่ของผู้เล่น' : 'สร้างคำตอบ 1-4 รายการต่อความคิดเห็นล่าสุดของผู้เล่น',
      'คำตอบต้องต่างบุคลิกกัน เป็นธรรมชาติ เข้ากับโลกและเนื้อหา ไม่พูดเหมือนบอท ไม่รู้ข้อมูลส่วนตัวที่ไม่ได้เปิดเผย',
      'ใช้ภาษาไทยทั้งหมด ห้ามใส่ภาษาต่างประเทศแล้ววงเล็บคำแปลไทย',
      'JSON: {"replies":[{"author":"ชื่อบัญชี","text":"คำตอบ"}]}',
      `เลือกชื่อผู้ตอบจากรายชื่อนี้เท่านั้น: ${eligible.map(row=>row.handle).join(' / ')}`,
      '', 'คัมภีร์สังคม:', JSON.stringify(bible), '', 'โพสต์:', post.text, '', 'ความคิดเห็นที่มีอยู่:', (comments.items || []).map(row => row.text).join('\n').slice(-5000), '', `การกระทำล่าสุดของผู้เล่น: ${actionText}`,
    ].join('\n');
    const schema = { type:'object', additionalProperties:false, required:['replies'], properties:{ replies:{type:'array',minItems:1,maxItems:6,items:{type:'object',additionalProperties:false,required:['author','text'],properties:{author:{type:'string'},text:{type:'string'}}}} } };
    let replies = []; try { replies = parseReplies(await this.#generate({ prompt, jsonSchema: schema, name: 'TMRW Social Replies', responseLength: 4096 })); } catch {}
    if(!replies.length)replies=[{author:eligible[0].handle,text:`เห็นข้อความแล้ว เรื่องนี้โยงกับ ${bounded((bible.currentPublicEvents||[])[0]||bible.worldSummary,180)}`}];
    const byHandle=new Map(eligible.map(row=>[clean(row.handle).normalize('NFKC').toLocaleLowerCase(),row]));
    const actionKey = await shortHash(`${postId}:${parentCommentId || ''}:${actionText}:${this.#now()}`, 16); const committed = [];
    for (const [index, reply] of replies.entries()) {
      const author = byHandle.get(clean(reply.author).normalize('NFKC').toLocaleLowerCase())||eligible[index%eligible.length]; const recordId = `${scope.branchId}:player-social-response:${actionKey}:${index}`;
      const result = await this.#social.createComment({ scope, postId, parentCommentId: actionKind === 'comment' ? parentCommentId : null, authorAccountId: author.accountId, actualAuthorActorId: author.actorId, actualAuthorInstanceId: author.instanceId, deviceId: author.deviceId, text: reply.text, source: { authority: 'tmrw-world-social', kind: 'player-triggered-response', recordId, version: '3' }, producer: 'adaptive-world-pulse', idempotencyKey: `player-social-response:${recordId}` });
      committed.push(result.comment); try { onProgress?.(Object.freeze({ index, total: replies.length, comment: result.comment })); } catch {}
    }
    return Object.freeze({ generated: replies.length, comments: Object.freeze(committed) });
  }
}
