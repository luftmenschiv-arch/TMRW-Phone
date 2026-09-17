import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { requireEventScope } from '../../domain/events/event-validator.mjs';
import { createActor } from '../../domain/identity/actor.mjs';
import { createCharacterInstance } from '../../domain/identity/character-instance.mjs';
import { createDevice } from '../../domain/identity/device.mjs';
import { createAccount } from '../../domain/identity/account.mjs';
import { ACTOR_CONTROL } from '../../domain/identity/control-authority.mjs';
import { isPlayerControlled } from '../../domain/identity/control-authority.mjs';
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
    const seen = new Set(); const distinct = [];
    for (const post of posts) { const key = clean(post.text).normalize('NFKC').toLocaleLowerCase(); if (!key || seen.has(key)) continue; seen.add(key); const commentSeen = new Set(); post.comments = post.comments.filter(comment => { const commentKey = `${clean(comment.author).normalize('NFKC').toLocaleLowerCase()}:${clean(comment.text).normalize('NFKC').toLocaleLowerCase()}`; if (commentSeen.has(commentKey)) return false; commentSeen.add(commentKey); return true; }); distinct.push(post); }
    return distinct.length ? distinct : null;
  } catch { return null; }
}

function parseReplies(value) {
  try {
    const parsed = JSON.parse(jsonCandidate(value));
    return (Array.isArray(parsed?.replies) ? parsed.replies : []).slice(0, 6).map(reply => ({ author: bounded(reply?.author, 64), text: String(reply?.text || '').trim().slice(0, 900) })).filter(reply => reply.author && reply.text);
  } catch { return []; }
}

function parsePhoneActivity(value) {
  try {
    const parsed = JSON.parse(jsonCandidate(value));
    const conversations = (Array.isArray(parsed?.conversations) ? parsed.conversations : []).slice(0, 12).map(row => ({
      owner: bounded(row?.owner, 80),
      contact: bounded(row?.contact, 80),
      messages: (Array.isArray(row?.messages) ? row.messages : []).slice(0, 8).map(message => ({ sender: message?.sender === 'owner' ? 'owner' : 'contact', text: bounded(message?.text, 900) })).filter(message => message.text),
    })).filter(row => row.owner && row.contact && row.messages.length);
    const lives = (Array.isArray(parsed?.lives) ? parsed.lives : []).slice(0, 3).map(row => ({
      host: bounded(row?.host, 80), title: bounded(row?.title, 160), topic: bounded(row?.topic, 100), description: bounded(row?.description, 800),
      comments: (Array.isArray(row?.comments) ? row.comments : []).slice(0, 8).map(comment => ({ author: bounded(comment?.author, 80), text: bounded(comment?.text, 500) })).filter(comment => comment.author && comment.text),
    })).filter(row => row.host && row.title);
    return Object.freeze({ conversations: Object.freeze(conversations), lives: Object.freeze(lives) });
  } catch { return Object.freeze({ conversations: Object.freeze([]), lives: Object.freeze([]) }); }
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
  #unit; #social; #messages; #live; #settings; #getContext; #now; #buffers = new Map(); #worlds = new Map();
  constructor({ database, socialService, messageService = null, liveService = null, settingsService = null, getContext = () => ({}), now = () => new Date().toISOString() }) {
    if (!database || !socialService) throw new TypeError('AdaptiveWorldPulseService requires database and Social service');
    this.#unit = new V3UnitOfWork(database); this.#social = socialService; this.#messages = messageService; this.#live = liveService; this.#settings = settingsService; this.#getContext = getContext; this.#now = now;
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

  async #knownSocialHandles(scope) {
    return this.#unit.readonly({ stores:['actors'], scope }, async repositories => Object.freeze((await repositories.actors.list()).filter(actor => actor.sourceAuthority === 'tmrw-world-social').map(actor => clean(actor.displayName)).filter(Boolean).slice(-30)));
  }

  async #phoneOwners(scope, deviceIds = null) {
    const selected = Array.isArray(deviceIds) ? new Set(deviceIds.map(String)) : null;
    return this.#unit.readonly({ stores:['devices','accounts','instances','actors'], scope }, async repositories => {
      const rows=[];
      for(const device of await repositories.devices.list()){
        if(selected&&!selected.has(device.id))continue;
        const instance=await repositories.instances.get(device.ownerInstanceId);const actor=instance&&await repositories.actors.get(instance.actorId);
        if(!instance||!actor||isPlayerControlled(actor)||actor.sourceAuthority==='tmrw-world-social')continue;
        const accounts=await repositories.accounts.listByIndex('by_owner_scope',[scope.storyId,scope.branchId,instance.id]);const account=accounts.find(row=>row.isPrimary&&row.deviceIds.includes(device.id))||accounts.find(row=>row.deviceIds.includes(device.id));
        if(account)rows.push(Object.freeze({actorId:actor.id,instanceId:instance.id,deviceId:device.id,accountId:account.id,handle:actor.displayName||account.label}));
      }
      return Object.freeze(rows);
    });
  }

  async #appliedPhoneActivityKeys(scope) {
    return this.#unit.readonly({ stores:['eventIdempotency'], scope }, async repositories => new Set((await repositories.eventIdempotency.list()).filter(row=>row.producer==='adaptive-world-pulse').map(row=>row.idempotencyKey)));
  }

  async primePhoneActivity({ scope: inputScope, playerInstanceId = null, deviceIds = null, fingerprint = null } = {}) {
    const scope=requireEventScope(inputScope);
    if(!this.#messages&&!this.#live)return Object.freeze({conversations:0,lives:0,skipped:true});
    const owners=await this.#phoneOwners(scope,deviceIds);if(!owners.length)return Object.freeze({conversations:0,lives:0,skipped:true});
    const bible=await this.prepareWorld({scope,playerInstanceId});const activityFingerprint=clean(fingerprint)||bible.sourceFingerprint;const applied=await this.#appliedPhoneActivityKeys(scope);
    const pendingOwners=this.#messages?owners.filter(owner=>!applied.has(`phone-activity:${activityFingerprint}:${owner.accountId}:message:0`)):[];
    const liveKey=`phone-activity:${activityFingerprint}:live:0`;const needsLive=this.#live&&!applied.has(liveKey);
    if(!pendingOwners.length&&!needsLive)return Object.freeze({conversations:0,lives:0,replayed:true});
    const context=this.#getContext()||{};
    const prompt=[
      'สร้างกิจกรรมในโทรศัพท์ของตัวละครจากโลกโรลเพลย์นี้ ตอบเป็น JSON เท่านั้น',
      'สำหรับเจ้าของเครื่องทุกคนที่ระบุ ให้สร้างแชทส่วนตัวหนึ่งห้องกับคนอื่นในโลกที่สมเหตุผล มี 3-6 ข้อความ และสลับผู้ส่งอย่างเป็นธรรมชาติ',
      'บทสนทนาต้องเป็นสิ่งที่เจ้าของเครื่องและคู่สนทนารู้ได้จริง ห้ามใช้ความคิดในใจ ความลับ หรือบทสนทนาปิดที่พวกเขาไม่ได้เห็น',
      'สร้างไลฟ์ 1-2 ห้อง เน้นคนในโลกหรือชาวเน็ตเป็นผู้จัด ถ้าตัวละครหลักไลฟ์เองต้องเข้ากับนิสัยและสถานการณ์ มีความคิดเห็นสด 3-6 ข้อความ',
      'ใช้ภาษาไทยทั้งหมด ห้ามใส่ภาษาต่างประเทศแล้ววงเล็บคำแปลไทย ห้ามเขียนข้อความอธิบายระบบ',
      'sender ใช้ได้เฉพาะ owner หรือ contact',
      'JSON: {"conversations":[{"owner":"ชื่อเจ้าของเครื่อง","contact":"ชื่อคู่สนทนา","messages":[{"sender":"owner","text":"ข้อความ"}]}],"lives":[{"host":"ชื่อบัญชี","title":"ชื่อไลฟ์","topic":"หัวข้อ","description":"คำอธิบาย","comments":[{"author":"ชื่อบัญชี","text":"ข้อความสด"}]}]}',
      '',`เจ้าของเครื่อง: ${pendingOwners.map(row=>row.handle).join(', ')}`,'','คัมภีร์สังคม:',JSON.stringify(bible),'','เหตุการณ์ช่วงล่าสุด:',publicRecentContext(context,36),
    ].join('\n');
    const schema = {
      type: 'object', additionalProperties: false, required: ['conversations', 'lives'], properties: {
        conversations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['owner', 'contact', 'messages'], properties: {
          owner: { type: 'string' }, contact: { type: 'string' }, messages: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['sender', 'text'], properties: { sender: { type: 'string', enum: ['owner', 'contact'] }, text: { type: 'string' } } } },
        } } },
        lives: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['host', 'title', 'topic', 'description', 'comments'], properties: {
          host: { type: 'string' }, title: { type: 'string' }, topic: { type: 'string' }, description: { type: 'string' }, comments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['author', 'text'], properties: { author: { type: 'string' }, text: { type: 'string' } } } },
        } } },
      },
    };
    let activity=Object.freeze({conversations:Object.freeze([]),lives:Object.freeze([])});
    try { activity=parsePhoneActivity(await this.#generate({prompt,jsonSchema:schema,name:'TMRW Phone Activity',responseLength:12288})); } catch {}
    const byOwner=new Map(owners.map(owner=>[clean(owner.handle).normalize('NFKC').toLocaleLowerCase(),owner]));let conversations=0;let lives=0;
    for(const owner of pendingOwners){
      let spec=activity.conversations.find(row=>clean(row.owner).normalize('NFKC').toLocaleLowerCase()===clean(owner.handle).normalize('NFKC').toLocaleLowerCase());
      if(!spec)spec={owner:owner.handle,contact:fallbackHandles[(conversations+2)%fallbackHandles.length],messages:[{sender:'contact',text:`ช่วงนี้คนแถวนี้กำลังพูดถึงเรื่องนี้กันเยอะ: ${bounded(bible.currentPublicEvents?.[0]||bible.worldSummary,220)}`},{sender:'owner',text:'ไว้ฉันจะลองดูสถานการณ์อีกที'}]};
      const contact=await this.#identity(scope,spec.contact);const thread=await this.#messages.createThread({scope,kind:'dm',participantAccountIds:[owner.accountId,contact.accountId],source:{authority:'tmrw-world-social',kind:'contextual-phone-activity',recordId:`${activityFingerprint}:${owner.accountId}:${contact.accountId}:thread`,version:'1'},producer:'adaptive-world-pulse',idempotencyKey:`phone-activity:${activityFingerprint}:${owner.accountId}:thread`});
      for(const [index,message] of spec.messages.entries()){const sender=message.sender==='owner'?owner:contact;await this.#messages.sendMessage({scope,threadId:thread.thread.threadId,senderAccountId:sender.accountId,actualAuthorActorId:sender.actorId,actualAuthorInstanceId:sender.instanceId,deviceId:sender.deviceId,text:message.text,source:{authority:'tmrw-world-social',kind:'contextual-phone-activity',recordId:`${activityFingerprint}:${owner.accountId}:message:${index}`,version:'1'},producer:'adaptive-world-pulse',idempotencyKey:`phone-activity:${activityFingerprint}:${owner.accountId}:message:${index}`});}conversations+=1;
    }
    if(needsLive){
      const liveSpecs=activity.lives.length?activity.lives:[{host:fallbackHandles[1],title:bounded(bible.currentPublicEvents?.[0]||'คุยข่าวจากพื้นที่',120),topic:'เรื่องที่กำลังเกิดขึ้น',description:bounded(bible.worldSummary,360),comments:[{author:fallbackHandles[2],text:'เข้ามาฟังแล้ว เล่าต่อได้เลย'},{author:fallbackHandles[3],text:'ตรงนี้คนพูดถึงกันเยอะจริง'}]}];
      for(const [liveIndex,spec] of liveSpecs.slice(0,2).entries()){
        const host=byOwner.get(clean(spec.host).normalize('NFKC').toLocaleLowerCase())||await this.#identity(scope,spec.host);const key=`phone-activity:${activityFingerprint}:live:${liveIndex}`;
        const created=await this.#live.createSession({scope,hostAccountId:host.accountId,actualActorId:host.actorId,actualInstanceId:host.instanceId,deviceId:host.deviceId,title:spec.title,topic:spec.topic||'กำลังเกิดขึ้น',description:spec.description||'',audience:{kind:'public'},startImmediately:true,source:{authority:'tmrw-world-social',kind:'contextual-phone-activity',recordId:`${activityFingerprint}:live:${liveIndex}`,version:'1'},producer:'adaptive-world-pulse',idempotencyKey:key});
        for(const [commentIndex,comment] of spec.comments.entries()){const author=clean(comment.author).normalize('NFKC').toLocaleLowerCase()===clean(host.handle).normalize('NFKC').toLocaleLowerCase()?host:await this.#identity(scope,comment.author);if(author.accountId!==host.accountId)await this.#live.join({scope,sessionId:created.session.sessionId,viewerAccountId:author.accountId,viewerActorId:author.actorId,viewerInstanceId:author.instanceId,source:{authority:'tmrw-world-social',kind:'contextual-phone-activity',recordId:`${activityFingerprint}:live:${liveIndex}:viewer:${commentIndex}`,version:'1'},producer:'adaptive-world-pulse',idempotencyKey:`${key}:viewer:${commentIndex}`});await this.#live.createMessage({scope,sessionId:created.session.sessionId,authorAccountId:author.accountId,actualAuthorActorId:author.actorId,actualAuthorInstanceId:author.instanceId,deviceId:author.deviceId,text:comment.text,source:{authority:'tmrw-world-social',kind:'contextual-phone-activity',recordId:`${activityFingerprint}:live:${liveIndex}:message:${commentIndex}`,version:'1'},producer:'adaptive-world-pulse',idempotencyKey:`${key}:message:${commentIndex}`});}lives+=1;
      }
    }
    return Object.freeze({conversations,lives,replayed:false});
  }

  async #generateBatch(scope, bible, startIndex) {
    const context = this.#getContext() || {};
    const knownHandles = await this.#knownSocialHandles(scope);
    const prompt = [
      'สร้างฟีดสังคมออนไลน์ที่เป็นส่วนหนึ่งของโลกโรลเพลย์ ตอบเป็น JSON เท่านั้น',
      'สร้าง 9 โพสต์ แต่ละโพสต์มีผู้เขียน เนื้อหา ยอดถูกใจโดยประมาณ และคอมเมนต์ 2-4 รายการ',
      'ผู้เขียนต้องเป็นชาวเมือง กลุ่มอาชีพ ผู้พบเห็น ลูกค้า คนงาน นักข่าว หรือผู้ใช้สื่อที่เหมาะกับโลก ไม่ใช้ชุดชื่อสำเร็จรูปซ้ำ ๆ',
      'ให้แต่ละบัญชีมีน้ำเสียง จุดยืน อาชีพ และระดับความรู้ต่างกัน บางคนถาม บางคนแย้ง บางคนเมาท์ บางคนให้ข้อมูล ห้ามให้ทุกคนพูดเป็นบทความหรือเห็นตรงกันหมด',
      'นำบัญชีเดิมบางคนกลับมาคุยต่อเพื่อให้รู้สึกว่าเป็นชุมชนเดิม และเพิ่มบัญชีใหม่เท่าที่จำเป็น',
      'น้ำเสียงและประเด็นต้องสอดคล้องกับกฎหมาย ชนชั้น เผ่าพันธุ์ เศรษฐกิจ เทคโนโลยี และศีลธรรมของโลกนี้ ไม่ยัดวัฒนธรรมไทยปัจจุบันหากไม่เข้ากับฉาก',
      'ห้ามให้ชาวเน็ตรู้ฉากส่วนตัว ความคิดในใจ หรือบทสนทนาปิด ใช้ได้เฉพาะข้อเท็จจริงสาธารณะ ข่าวลือที่มีที่มา และหัวข้อทั่วไปในโลก',
      'ใช้ภาษาไทยทั้งหมด ห้ามใส่ภาษาต่างประเทศแล้ววงเล็บคำแปลไทย หลีกเลี่ยงประโยคซ้ำและคอมเมนต์ลอย ๆ',
      'JSON: {"posts":[{"author":"ชื่อบัญชี","text":"โพสต์","likes":3,"comments":[{"author":"ชื่อบัญชี","text":"ความคิดเห็น"}]}]}',
      '', `บัญชีที่เคยปรากฏ: ${knownHandles.join(' / ') || 'ยังไม่มี'}`, '', 'คัมภีร์สังคม:', JSON.stringify(bible), '', 'เหตุการณ์ช่วงล่าสุด (ใช้เฉพาะส่วนที่สมเหตุผลว่าจะเป็นสาธารณะ):', publicRecentContext(context), '', `ลำดับชุด: ${startIndex}`,
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
    const likers=eligible.slice(0,Math.max(1,Math.min(6,replies.length+1)));for(const [index,liker] of likers.entries()){try{await this.#social.setEngagement({scope,targetId:postId,targetKind:'post',kind:'like',actorAccountId:liker.accountId,actualActorId:liker.actorId,actualInstanceId:liker.instanceId,active:true,source:{authority:'tmrw-world-social',kind:'player-triggered-response',recordId:`${scope.branchId}:player-social-like:${actionKey}:${index}`,version:'3'},producer:'adaptive-world-pulse',idempotencyKey:`player-social-like:${actionKey}:${index}`});}catch{}}
    return Object.freeze({ generated: replies.length, comments: Object.freeze(committed) });
  }

  async respondToDirectMessage({ scope: inputScope, threadId, playerAccountId, playerInstanceId = null, messageText = '' } = {}) {
    const scope = requireEventScope(inputScope); if (!this.#messages) throw new Error('Messaging is unavailable');
    const thread = await this.#messages.getThread({ scope, threadId }); if (!thread || thread.kind !== 'dm') return Object.freeze({ generated: 0, messages: Object.freeze([]) });
    const counterpartId = (thread.participantAccountIds || []).find(accountId => accountId !== playerAccountId); if (!counterpartId) return Object.freeze({ generated: 0, messages: Object.freeze([]) });
    const counterpart = await this.#unit.readonly({ stores:['accounts','instances','actors','devices'], scope }, async repositories => { const account=await repositories.accounts.get(counterpartId);const instance=account&&await repositories.instances.get(account.ownerInstanceId);const actor=instance&&await repositories.actors.get(instance.actorId);const device=account&&await Promise.all((account.deviceIds||[]).map(id=>repositories.devices.get(id))).then(rows=>rows.find(Boolean));return account&&instance&&actor&&device?Object.freeze({accountId:account.id,instanceId:instance.id,actorId:actor.id,deviceId:device.id,label:actor.displayName||account.label}):null; });
    if (!counterpart) return Object.freeze({ generated: 0, messages: Object.freeze([]) });
    const history = await this.#messages.listMessages({ scope, viewerAccountId: playerAccountId, threadId, limit: 24 }); const context=this.#getContext()||{};
    const prompt = [
      `ตอบข้อความส่วนตัวในบทบาท ${counterpart.label} เป็นภาษาไทย ตอบ JSON เท่านั้น`,
      'รักษานิสัย วิธีพูด ความสัมพันธ์ และความรู้ของตัวละครตามการ์ด ลอว์บุ๊ก และโรลเพลย์ปัจจุบัน',
      'ตอบเหมือนแชทมือถือจริง กระชับ เป็นธรรมชาติ ไม่บรรยายท่าทางด้วยวงเล็บ ไม่อธิบายระบบ และไม่พูดแทนผู้เล่น',
      'สร้าง 1-3 ข้อความสั้นต่อเนื่องตามจังหวะที่เหมาะสม',
      'JSON: {"messages":["ข้อความ"]}',
      '', 'ข้อมูลตัวละครและโลก:', cardContext(context).slice(0,12000), '', 'บริบทโรลเพลย์ล่าสุด:', historyContext(context,{recent:50,maxCharacters:12000}), '', 'ประวัติห้องนี้:', history.map(row=>`${row.senderAccountId===counterpartId?counterpart.label:'ผู้เล่น'}: ${row.text}`).join('\n').slice(-6000), '', `ข้อความล่าสุดของผู้เล่น: ${clean(messageText)}`,
    ].join('\n');
    const schema={type:'object',additionalProperties:false,required:['messages'],properties:{messages:{type:'array',minItems:1,maxItems:3,items:{type:'string'}}}};let replies=[];
    try{const parsed=JSON.parse(jsonCandidate(await this.#generate({prompt,jsonSchema:schema,name:'TMRW Direct Message Reply',responseLength:3072})));replies=(Array.isArray(parsed?.messages)?parsed.messages:[]).map(value=>bounded(value,900)).filter(Boolean).slice(0,3);}catch{}
    if(!replies.length)replies=[clean(messageText).includes('?')?'ขอคิดก่อนนะ เดี๋ยวตอบให้ชัด ๆ':'อือ เราเห็นแล้ว'];
    const actionKey=await shortHash(`${threadId}:${messageText}:${this.#now()}`,16);const committed=[];
    for(const [index,text] of replies.entries()){const result=await this.#messages.sendMessage({scope,threadId,senderAccountId:counterpart.accountId,actualAuthorActorId:counterpart.actorId,actualAuthorInstanceId:counterpart.instanceId,deviceId:counterpart.deviceId,text,source:{authority:'tmrw-world-social',kind:'direct-message-reply',recordId:`${actionKey}:${index}`,version:'1'},producer:'adaptive-world-pulse',idempotencyKey:`direct-message-reply:${actionKey}:${index}`});committed.push(result.message);}
    return Object.freeze({generated:committed.length,messages:Object.freeze(committed)});
  }
}
