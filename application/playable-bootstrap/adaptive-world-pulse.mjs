import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { requireEventScope } from '../../domain/events/event-validator.mjs';
import { createActor } from '../../domain/identity/actor.mjs';
import { createCharacterInstance } from '../../domain/identity/character-instance.mjs';
import { createDevice } from '../../domain/identity/device.mjs';
import { createAccount } from '../../domain/identity/account.mjs';
import { ACTOR_CONTROL } from '../../domain/identity/control-authority.mjs';
import { deterministicIdentityId } from '../../domain/identity/id.mjs';

const VOICES = Object.freeze([
  Object.freeze({ key: 'auntie-window', label: 'ป้าข้างบ้านท่านหนึ่ง', style: scene => `ไม่ได้อยากยุ่งนะ แต่แถว${scene}มีพิรุธจริง ใครผ่านไปผ่านมาเล่าซิคะ 👀` }),
  Object.freeze({ key: 'tea-table', label: 'วงน้ำชาหน้าปากซอย', style: scene => `วงน้ำชาขอเปิดประเด็น: วันนี้${scene}คึกคักเกินปกติ ใครมีข้อมูลจริงเชิญค่ะ` }),
  Object.freeze({ key: 'night-owl', label: 'ชาวเน็ตไม่นอน', style: scene => `นอนไม่หลับเลยมาเช็กข่าวแถว${scene} สรุปเราใกล้ตกข่าวอะไรอยู่หรือเปล่า 😭` }),
  Object.freeze({ key: 'detective', label: 'นักสืบโซเชียล', style: scene => `ยังไม่ฟันธง แต่ไทม์ไลน์แถว${scene}น่าสนใจมาก ขอรวบรวมหลักฐานก่อนหนึ่งกรุบ` }),
  Object.freeze({ key: 'soft-heart', label: 'ทีมใจบาง', style: scene => `บรรยากาศแถว${scene}วันนี้ทำคนใจบางทำงานหนักมาก ใครไหวไปก่อนเลยค่ะ` }),
  Object.freeze({ key: 'front-row', label: 'แถวหน้ามุง', style: scene => `มาถึงแถว${scene}แล้วค่ะ ขอพิกัดวงมุงแบบสุภาพหนึ่งที่ 🪑` }),
]);
const COMMENT_LINES = Object.freeze(['จริง เห็นคนพูดถึงเหมือนกัน', 'ขอหลักฐานเพิ่มค่ะ แต่เก้าอี้พร้อมแล้ว', 'โอ๊ย ฉันตกข่าวอะไรอีกเนี่ย', 'ฟังหูไว้หูก่อนนะทุกคน', 'มาตามอ่านเงียบ ๆ แต่ใจไม่เงียบเลย']);
const clean = value => String(value ?? '').replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim();
function topicFrom(context) {
  const chat = Array.isArray(context?.chat) ? context.chat : [];
  const latest = [...chat].reverse().map(row => clean(row?.mes ?? row?.content)).find(Boolean);
  const combined = `${latest || ''} ${clean(context?.scenario)} ${clean(context?.name2)}`;
  const scene = [
    [/โรงเรียน|มหาวิทยาลัย|ห้องเรียน|school|college|academy/iu, 'โรงเรียน'],
    [/คาเฟ่|กาแฟ|ร้านอาหาร|cafe|coffee|restaurant/iu, 'ร้านกาแฟ'],
    [/โรงพยาบาล|คลินิก|hospital|clinic/iu, 'โรงพยาบาล'],
    [/สนาม|กีฬา|บาส|ฟุตบอล|basket|sport/iu, 'สนามกีฬา'],
    [/บ้าน|ห้อง|คอนโด|home|apartment/iu, 'ละแวกบ้าน'],
    [/ฝน|พายุ|rain|storm/iu, 'ย่านนี้ตอนฝนตก'],
    [/กลางคืน|ดึก|night|midnight/iu, 'ย่านนี้เมื่อคืน'],
  ].find(([pattern]) => pattern.test(combined))?.[1];
  return scene || (clean(context?.name2) ? `เรื่องของ ${clean(context.name2).slice(0, 30)}` : 'ละแวกนี้');
}

export class AdaptiveWorldPulseService {
  #unit; #social; #getContext; #now; #buffers = new Map();
  constructor({ database, socialService, getContext = () => ({}), now = () => new Date().toISOString() }) {
    if (!database || !socialService) throw new TypeError('AdaptiveWorldPulseService requires database and Social service');
    this.#unit = new V3UnitOfWork(database); this.#social = socialService; this.#getContext = getContext; this.#now = now;
  }

  async #netizens(scope) {
    const authority = 'tmrw-thai-netizen-simulation'; const manifestId = `adaptive-world-pulse:${scope.storyId}`; const now = this.#now(); const result = [];
    for (const voice of VOICES) {
      const actorId = await deterministicIdentityId('actor', { sourceAuthority: authority, stableSourceId: `${scope.storyId}:${voice.key}` });
      const instanceId = await deterministicIdentityId('character-instance', { sourceAuthority: authority, stableSourceId: actorId, scopeParts: [scope.storyId, scope.branchId] });
      const deviceId = await deterministicIdentityId('device', { sourceAuthority: authority, stableSourceId: 'social', scopeParts: [instanceId] });
      const accountId = await deterministicIdentityId('account', { sourceAuthority: authority, stableSourceId: 'insungram', scopeParts: [instanceId] });
      result.push(Object.freeze({ voice, actorId, instanceId, deviceId, accountId }));
    }
    await this.#unit.readwrite({ stores: ['actors', 'instances', 'devices', 'accounts'], scope }, async repositories => {
      for (const row of result) {
        const actor = await repositories.actors.get(row.actorId); const instance = await repositories.instances.get(row.instanceId); const device = await repositories.devices.get(row.deviceId); const account = await repositories.accounts.get(row.accountId);
        await repositories.actors.put(createActor({ id: row.actorId, sourceAuthority: authority, sourceActorId: `${scope.storyId}:${row.voice.key}`, displayName: row.voice.label, aliases: [], control: ACTOR_CONTROL.AI, controlKey: `${authority}:${row.voice.key}`, createdAt: actor?.createdAt || now, updatedAt: now, manifestId, existingManifestIds: actor?.manifestIds || [] }));
        await repositories.instances.put(createCharacterInstance({ id: row.instanceId, actorId: row.actorId, storyId: scope.storyId, branchId: scope.branchId, aliases: [], createdAt: instance?.createdAt || now, updatedAt: now, manifestId, existingManifestIds: instance?.manifestIds || [] }));
        await repositories.devices.put(createDevice({ id: row.deviceId, storyId: scope.storyId, branchId: scope.branchId, ownerInstanceId: row.instanceId, deviceKey: 'social', kind: 'social-simulation', label: `${row.voice.label} Social`, createdAt: device?.createdAt || now, updatedAt: now, manifestId, existingManifestIds: device?.manifestIds || [] }));
        await repositories.accounts.put(createAccount({ id: row.accountId, storyId: scope.storyId, branchId: scope.branchId, ownerInstanceId: row.instanceId, accountKey: 'insungram', kind: 'social', label: row.voice.label, deviceIds: [row.deviceId], createdAt: account?.createdAt || now, updatedAt: now, manifestId, existingManifestIds: account?.manifestIds || [] }));
      }
    });
    return result;
  }

  async #existingCount(scope, accountIds) {
    return this.#unit.readonly({ stores: ['socialPosts'], scope }, async repositories => (await repositories.socialPosts.list()).filter(row => accountIds.has(row.authorAccountId) && row.currentness === 'current' && !/เรื่อง “|สรุปเรื่อง |ประเด็น .*ยังทำให้|จับตา .*ต่อ|บรรยากาศ .*แบบหมดรูป|จุดชมวิวเรื่อง/u.test(row.text || '')).length);
  }

  #refill(scope, startIndex, topic) {
    const key = `${scope.storyId}:${scope.branchId}`; const batch = [];
    for (let offset = 0; offset < 9; offset += 1) {
      const index = startIndex + offset; const voiceIndex = index % VOICES.length; const voice = VOICES[voiceIndex];
      const suffix = ['ใครรู้จริงค่อยเล่านะ', 'ไม่รับข่าวลือ รับแต่รายละเอียดค่ะ', 'ขอพื้นที่ให้ชาวบ้านใส่ใจนิดหนึ่ง'][Math.floor(index / VOICES.length) % 3];
      batch.push(Object.freeze({ index, voiceIndex, text: `${voice.style(topic)} ${suffix}` }));
    }
    this.#buffers.set(key, batch); return batch;
  }

  async refresh({ scope: inputScope, count = 3 } = {}) {
    const scope = requireEventScope(inputScope); const people = await this.#netizens(scope); const ids = new Set(people.map(row => row.accountId)); const existing = await this.#existingCount(scope, ids); const key = `${scope.storyId}:${scope.branchId}`; const context = this.#getContext() || {}; const topic = topicFrom(context);
    let buffer = this.#buffers.get(key) || []; if (buffer.length < count) buffer = this.#refill(scope, existing, topic);
    const selected = buffer.splice(0, Math.max(1, Math.min(6, Number(count) || 3))); const created = [];
    for (const item of selected) {
      const author = people[item.voiceIndex]; const recordId = `${scope.branchId}:pulse-v2:${item.index}`;
      const result = await this.#social.createPost({ scope, authorAccountId: author.accountId, actualAuthorActorId: author.actorId, actualAuthorInstanceId: author.instanceId, deviceId: author.deviceId, text: item.text, audience: { kind: 'public' }, source: { authority: 'tmrw-adaptive-world-pulse', kind: 'plausible-simulation', recordId, version: '1' }, producer: 'adaptive-world-pulse', idempotencyKey: `adaptive-world-pulse:${recordId}` });
      const reactors = [1, 2, 3].map(step => people[(item.voiceIndex + step) % people.length]).filter(row => row.accountId !== author.accountId);
      for (const [offset, reactor] of reactors.entries()) {
        const reactionRecord = `${recordId}:like:${offset}`;
        await this.#social.setEngagement({ scope, targetId: result.post.postId, actorAccountId: reactor.accountId, actualActorId: reactor.actorId, actualInstanceId: reactor.instanceId, active: true, source: { authority: 'tmrw-adaptive-world-pulse', kind: 'plausible-simulation', recordId: reactionRecord, version: '1' }, producer: 'adaptive-world-pulse', idempotencyKey: `adaptive-world-pulse:${reactionRecord}` });
      }
      for (const [offset, commenter] of reactors.slice(0, 2).entries()) {
        const commentRecord = `${recordId}:comment:${offset}`;
        await this.#social.createComment({ scope, postId: result.post.postId, authorAccountId: commenter.accountId, actualAuthorActorId: commenter.actorId, actualAuthorInstanceId: commenter.instanceId, deviceId: commenter.deviceId, text: COMMENT_LINES[(item.index + offset) % COMMENT_LINES.length], source: { authority: 'tmrw-adaptive-world-pulse', kind: 'plausible-simulation', recordId: commentRecord, version: '1' }, producer: 'adaptive-world-pulse', idempotencyKey: `adaptive-world-pulse:${commentRecord}` });
      }
      created.push(result.post);
    }
    return Object.freeze({ created: Object.freeze(created), remainingBuffered: buffer.length, refilledInBatch: buffer.length + selected.length === 9, topic });
  }

  async prime({ scope, minimum = 6 } = {}) {
    const normalized = requireEventScope(scope); const people = await this.#netizens(normalized); const existing = await this.#existingCount(normalized, new Set(people.map(row => row.accountId))); const created = [];
    while (existing + created.length < minimum) created.push(...(await this.refresh({ scope: normalized, count: Math.min(3, minimum - existing - created.length) })).created);
    return Object.freeze({ existing, created: Object.freeze(created), ready: existing + created.length >= minimum });
  }
}
