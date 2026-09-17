import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { requireEventScope } from '../../domain/events/event-validator.mjs';
import { isPlayerControlled } from '../../domain/identity/control-authority.mjs';

const clean = value => String(value ?? '').replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim();
async function shortHash(value) {
  const bytes = new TextEncoder().encode(String(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
function storyText(context) {
  const chat = Array.isArray(context?.chat) ? context.chat : [];
  const recent = chat.slice(-6).map(row => clean(row?.mes ?? row?.content)).filter(Boolean);
  return recent.slice(-3).join('\n').slice(0, 1800) || 'มือถือเครื่องนี้พร้อมติดตามสิ่งที่เกิดขึ้นในเรื่องแล้ว';
}
function worldText(context) {
  try { return clean(JSON.stringify({ name: context?.name2, scenario: context?.scenario, worldInfo: context?.worldInfo, characters: context?.characters })); }
  catch { return clean(context?.name2); }
}
function currencyFor(text) {
  if (/ญี่ปุ่น|japan|tokyo|東京|円|yen|jpy/iu.test(text)) return Object.freeze({ code: 'JPY', base: 18_000 });
  if (/เกาหลี|korea|seoul|서울|won|krw/iu.test(text)) return Object.freeze({ code: 'KRW', base: 65_000 });
  if (/america|usa|united states|dollar|usd/iu.test(text)) return Object.freeze({ code: 'USD', base: 220 });
  return Object.freeze({ code: 'THB', base: 4_500 });
}

export class InitialPhoneSeedService {
  #unit; #world; #now;
  constructor({ database, phoneWorldService, now = () => new Date().toISOString() }) {
    if (!database || !phoneWorldService) throw new TypeError('InitialPhoneSeedService requires database and Phone World service');
    this.#unit = new V3UnitOfWork(database); this.#world = phoneWorldService; this.#now = now;
  }

  async #owners(scope, deviceIds = null) {
    const selectedDeviceIds = Array.isArray(deviceIds) ? new Set(deviceIds.map(String)) : null;
    return this.#unit.readonly({ stores: ['devices', 'instances', 'actors', 'accounts'], scope }, async repositories => {
      const owners = [];
      for (const device of await repositories.devices.list()) {
        if (selectedDeviceIds && !selectedDeviceIds.has(device.id)) continue;
        const instance = await repositories.instances.get(device.ownerInstanceId); const actor = instance && await repositories.actors.get(instance.actorId);
        if (!instance || !actor) continue;
        const accounts = await repositories.accounts.listByIndex('by_owner_scope', [scope.storyId, scope.branchId, instance.id]);
        const account = accounts.find(row => row.isPrimary && row.deviceIds.includes(device.id)) || accounts.find(row => row.deviceIds.includes(device.id));
        if (account) owners.push(Object.freeze({ device, instance, actor, account, playerOwned: isPlayerControlled(actor) }));
      }
      return owners;
    });
  }

  async seed({ scope: inputScope, context = {}, fingerprint = 'initial', deviceIds = null } = {}) {
    const scope = requireEventScope(inputScope); const owners = await this.#owners(scope, deviceIds);
    const excerpt = storyText(context); const world = worldText(context); const currency = currencyFor(world); const fingerprintKey = clean(fingerprint) || 'initial';
    const observedAt = clean(Array.isArray(context?.chat) ? (context.chat.at(-1)?.send_date ?? context.chat.at(-1)?.timestamp) : '') || null;
    const appliedKeys = await this.#unit.readonly({ stores: ['eventIdempotency'], scope }, async repositories => new Set((await repositories.eventIdempotency.list()).filter(row => row.producer === 'playable-phone-initial-seed').map(row => row.idempotencyKey)));
    let writes = 0;
    for (const owner of owners) {
      const key = await shortHash(`${scope.storyId}:${scope.branchId}:${owner.device.id}:${fingerprintKey}`);
      const common = { scope, deviceId: owner.device.id, ownerActorId: owner.actor.id, ownerInstanceId: owner.instance.id, ownerAccountId: owner.account.id, sourceKind: 'plausible-simulation', producer: 'playable-phone-initial-seed' };
      const write = async (kind, method, recordId, body) => {
        const idempotencyKey = `initial-seed:${kind}:${owner.device.id}:${key}`;
        if (appliedKeys.has(idempotencyKey)) return;
        const source = Object.freeze({ authority: 'playable-phone-bootstrap', kind: 'plausible-simulation', recordId, version: '1' });
        await this.#world[method]({ ...common, ...body, recordId, source, idempotencyKey }); appliedKeys.add(idempotencyKey); writes += 1;
      };
      await write('note', 'saveNote', `bootstrap-current-story:${owner.device.id}:${key}`, { title: 'ตอนนี้ในเรื่อง', text: excerpt, pinned: true });
      await write('weather', 'recordWeather', `bootstrap-weather:${owner.device.id}:${key}`, { locationLabel: 'บริเวณตามฉากปัจจุบัน', condition: 'อากาศทั่วไป', temperatureC: 26, observedAt, provider: 'TMRW story estimate' });
      const number = Number.parseInt(key.slice(0, 6), 16);
      await write('health-steps', 'recordHealth', `bootstrap-health-steps:${owner.device.id}:${key}`, { metric: 'steps', value: 1200 + (number % 6200), unit: 'ก้าว', observedAt, sourceLabel: 'TMRW story estimate' });
      await write('health-sleep', 'recordHealth', `bootstrap-health-sleep:${owner.device.id}:${key}`, { metric: 'sleep-minutes', value: 360 + (number % 151), unit: 'นาที', observedAt, sourceLabel: 'TMRW story estimate' });
      await write('calendar', 'setCalendarItem', `bootstrap-reminder:${owner.device.id}:${key}`, { itemKind: 'reminder', title: 'กลับมาดูสิ่งที่เกิดขึ้นล่าสุด', due: null, participantActorIds: [owner.actor.id], participantInstanceIds: [owner.instance.id], response: 'accepted' });
      for (const [index, item] of [['เครื่องดื่มที่เข้ากับฉากนี้', 45], ['ของว่างสำหรับวันนี้', 65], ['ของใช้เล็ก ๆ ที่อาจจำเป็น', 120]].entries()) {
        await write(`shop-${index}`, 'setShopItem', `bootstrap-shop-${index}:${owner.device.id}:${key}`, { name: item[0], description: 'รายการแนะนำที่สร้างจากบรรยากาศของเรื่อง ปรับเปลี่ยนได้เมื่อบริบทอัปเดต', price: item[1], currency: currency.code, available: true });
      }
      if (!owner.playerOwned) await write('wallet', 'recordWalletEntry', `bootstrap-wallet:${owner.device.id}:${key}`, { entryKind: 'balance', label: 'ยอดโดยประมาณตามบริบท', amount: currency.base + (number % currency.base), currency: currency.code });
    }
    return Object.freeze({ devices: owners.length, writes, sourceKind: 'plausible-simulation' });
  }
}
