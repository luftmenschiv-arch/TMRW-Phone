import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { requireEventScope } from '../../domain/events/event-validator.mjs';
import { createActor } from '../../domain/identity/actor.mjs';
import { createCharacterInstance } from '../../domain/identity/character-instance.mjs';
import { createDevice } from '../../domain/identity/device.mjs';
import { createAccount } from '../../domain/identity/account.mjs';
import { ACTOR_CONTROL } from '../../domain/identity/control-authority.mjs';
import { deterministicIdentityId } from '../../domain/identity/id.mjs';

const VOICES = Object.freeze([
  Object.freeze({ key: 'auntie-window', label: 'ป้าข้างบ้านท่านหนึ่ง', style: topic => `ไม่ได้อยากยุ่งนะ แต่เรื่อง “${topic}” นี่ขอเก้าอี้วงหนึ่งค่ะ 👀` }),
  Object.freeze({ key: 'tea-table', label: 'วงน้ำชาหน้าปากซอย', style: topic => `สรุปเรื่อง ${topic} มีใครเล่าตั้งแต่ต้นได้บ้าง ชั้นตามไม่ทันแต่พร้อมฟังมาก` }),
  Object.freeze({ key: 'night-owl', label: 'ชาวเน็ตไม่นอน', style: topic => `ตีไหนไม่รู้ แต่ประเด็น ${topic} ยังทำให้ฉันวางมือถือไม่ได้ 😭` }),
  Object.freeze({ key: 'detective', label: 'นักสืบโซเชียล', style: topic => `หลักฐานยังไม่ครบ ขออนุญาตจับตา ${topic} ต่อแบบมีมารยาทหนึ่งกรุบ` }),
  Object.freeze({ key: 'soft-heart', label: 'ทีมใจบาง', style: topic => `ใครไหวไปก่อนเลย เราแพ้ทางบรรยากาศ ${topic} แบบหมดรูปแล้วค่ะ` }),
  Object.freeze({ key: 'front-row', label: 'แถวหน้ามุง', style: topic => `มาถึงแล้วค่ะ จุดชมวิวเรื่อง ${topic} อยู่ตรงไหน ขอที่หนึ่ง` }),
]);
const clean = value => String(value ?? '').replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim();
function topicFrom(context) {
  const chat = Array.isArray(context?.chat) ? context.chat : [];
  const latest = [...chat].reverse().map(row => clean(row?.mes ?? row?.content)).find(Boolean);
  return (latest || clean(context?.name2) || 'เรื่องนี้').slice(0, 54);
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
    return this.#unit.readonly({ stores: ['socialPosts'], scope }, async repositories => (await repositories.socialPosts.list()).filter(row => accountIds.has(row.authorAccountId) && row.currentness === 'current').length);
  }

  #refill(scope, startIndex, topic) {
    const key = `${scope.storyId}:${scope.branchId}`; const batch = [];
    for (let offset = 0; offset < 9; offset += 1) {
      const index = startIndex + offset; const voiceIndex = index % VOICES.length; const voice = VOICES[voiceIndex];
      const suffix = ['ขอเกาะติดแบบเงียบ ๆ', 'ใครมีข้อมูลเพิ่มวางไว้ได้เลย', 'ยังไม่ฟันธงแต่ใจไปแล้ว'][Math.floor(index / VOICES.length) % 3];
      batch.push(Object.freeze({ index, voiceIndex, text: `${voice.style(topic)} ${suffix}` }));
    }
    this.#buffers.set(key, batch); return batch;
  }

  async refresh({ scope: inputScope, count = 3 } = {}) {
    const scope = requireEventScope(inputScope); const people = await this.#netizens(scope); const ids = new Set(people.map(row => row.accountId)); const existing = await this.#existingCount(scope, ids); const key = `${scope.storyId}:${scope.branchId}`; const context = this.#getContext() || {}; const topic = topicFrom(context);
    let buffer = this.#buffers.get(key) || []; if (buffer.length < count) buffer = this.#refill(scope, existing, topic);
    const selected = buffer.splice(0, Math.max(1, Math.min(6, Number(count) || 3))); const created = [];
    for (const item of selected) {
      const author = people[item.voiceIndex]; const recordId = `${scope.branchId}:pulse:${item.index}`;
      const result = await this.#social.createPost({ scope, authorAccountId: author.accountId, actualAuthorActorId: author.actorId, actualAuthorInstanceId: author.instanceId, deviceId: author.deviceId, text: item.text, audience: { kind: 'public' }, source: { authority: 'tmrw-adaptive-world-pulse', kind: 'plausible-simulation', recordId, version: '1' }, producer: 'adaptive-world-pulse', idempotencyKey: `adaptive-world-pulse:${recordId}` });
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
