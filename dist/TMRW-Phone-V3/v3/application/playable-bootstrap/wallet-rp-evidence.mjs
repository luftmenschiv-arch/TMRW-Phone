import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { requireEventScope } from '../../domain/events/event-validator.mjs';
import { isPlayerControlled } from '../../domain/identity/control-authority.mjs';

const MONEY = /(?:ได้รับ|ได้เงิน|รับเงิน|ค่าจ้าง|ให้เงิน|โอนให้|โอนเข้า|จ่าย|ซื้อ|เปย์|เสียเงิน|ชำระ)[^0-9]{0,48}([0-9][0-9,.]*)\s*(บาท|฿|เยน|円|jpy|ดอลลาร์|usd|วอน|krw)/iu;
const EXPENSE = /จ่าย|ซื้อ|เปย์|เสียเงิน|ชำระ/iu;
const ASSISTANT_TO_PLAYER = /(?:ให้|โอน|จ่าย).*?(?:คุณ|เธอ|นาย|ผู้เล่น)|(?:คุณ|เธอ|นาย|ผู้เล่น).*?(?:ได้รับ|ได้เงิน|รับเงิน)/iu;
const CURRENCIES = Object.freeze({ 'บาท': 'THB', '฿': 'THB', 'เยน': 'JPY', '円': 'JPY', 'jpy': 'JPY', 'ดอลลาร์': 'USD', 'usd': 'USD', 'วอน': 'KRW', 'krw': 'KRW' });
const amount = value => Number(String(value).replaceAll(',', ''));

export class WalletRpEvidenceService {
  #unit; #world;
  constructor({ database, phoneWorldService }) { if (!database || !phoneWorldService) throw new TypeError('WalletRpEvidenceService requires database and Phone World service'); this.#unit = new V3UnitOfWork(database); this.#world = phoneWorldService; }
  async #player(scope) {
    return this.#unit.readonly({ stores: ['actors', 'instances', 'devices', 'accounts'], scope }, async repositories => {
      for (const actor of await repositories.actors.list()) {
        if (!isPlayerControlled(actor)) continue;
        const instance = await repositories.instances.getByIndex('by_actor_scope', [actor.id, scope.storyId, scope.branchId]); if (!instance) continue;
        const devices = await repositories.devices.listByIndex('by_owner_scope', [scope.storyId, scope.branchId, instance.id]); const device = devices.find(row => row.isPrimary) || devices[0];
        const accounts = await repositories.accounts.listByIndex('by_owner_scope', [scope.storyId, scope.branchId, instance.id]); const account = accounts.find(row => row.isPrimary && row.deviceIds.includes(device?.id)) || accounts.find(row => row.deviceIds.includes(device?.id));
        if (device && account) return Object.freeze({ actor, instance, device, account });
      }
      return null;
    });
  }
  couldContainEvidence(text) { return MONEY.test(String(text || '')); }
  async evaluate({ scope: inputScope, source } = {}) {
    const scope = requireEventScope(inputScope); const text = String(source?.text || ''); MONEY.lastIndex = 0; const match = MONEY.exec(text);
    if (!match || (source?.role === 'assistant' && !ASSISTANT_TO_PLAYER.test(text))) return Object.freeze({ evaluated: false, applied: false, reason: 'no-explicit-player-money-evidence' });
    const value = amount(match[1]); if (!Number.isFinite(value) || value <= 0) return Object.freeze({ evaluated: true, applied: false, reason: 'invalid-amount' });
    const player = await this.#player(scope); if (!player) return Object.freeze({ evaluated: true, applied: false, reason: 'player-phone-unresolved' });
    const signed = EXPENSE.test(match[0]) ? -value : value; const sourceMessageId = String(source?.sourceMessageId || `ordinal:${source?.sourceOrdinal ?? 0}`); const sourceVersionId = String(source?.sourceVersionId || '1'); const recordId = `rp-wallet:${sourceMessageId}`;
    const result = await this.#world.recordWalletEntry({ scope, deviceId: player.device.id, ownerActorId: player.actor.id, ownerInstanceId: player.instance.id, ownerAccountId: player.account.id, recordId, entryKind: 'transaction', label: text.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 160) || 'รายการจากเนื้อเรื่อง', amount: signed, currency: CURRENCIES[String(match[2]).toLocaleLowerCase()] || 'THB', sourceKind: 'story-canon', source: { authority: source?.sourceAuthority || 'sillytavern-main-rp', kind: 'main-rp-wallet-evidence', recordId: `${sourceMessageId}:${sourceVersionId}`, version: sourceVersionId }, producer: 'wallet-rp-evidence', idempotencyKey: `wallet-rp:${sourceMessageId}:${sourceVersionId}` });
    return Object.freeze({ evaluated: true, applied: true, amount: signed, currency: CURRENCIES[String(match[2]).toLocaleLowerCase()] || 'THB', replayed: result.replayed === true });
  }
  async retractSource({ scope: inputScope, sourceMessageId }) {
    const scope = requireEventScope(inputScope); const player = await this.#player(scope); if (!player) return Object.freeze({ retracted: false }); const id = String(sourceMessageId || '').trim(); if (!id) return Object.freeze({ retracted: false });
    await this.#world.recordWalletEntry({ scope, deviceId: player.device.id, ownerActorId: player.actor.id, ownerInstanceId: player.instance.id, ownerAccountId: player.account.id, recordId: `rp-wallet:${id}`, entryKind: 'transaction', label: 'รายการจากข้อความที่ถูกลบ', amount: 0, currency: 'THB', sourceKind: 'story-canon', source: { authority: 'sillytavern-main-rp', kind: 'main-rp-wallet-retraction', recordId: id, version: 'retracted' }, producer: 'wallet-rp-evidence', idempotencyKey: `wallet-rp:${id}:retracted` });
    return Object.freeze({ retracted: true });
  }
}
