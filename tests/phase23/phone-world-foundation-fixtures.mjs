import { CanonicalEventEngine } from '../../domain/events/event-transaction.mjs';
import { createPhase23EventTypeRegistry } from '../../domain/utilities/phone-world-event-types.mjs';
import { createPhoneWorldProjector } from '../../domain/utilities/phone-world-projector.mjs';
import { PhoneWorldService } from '../../domain/utilities/phone-world-service.mjs';
import { setupPhase17 } from '../phase17/notification-fixtures.mjs';

export const utilitySource = recordId => Object.freeze({ authority: 'phase23-foundation-test', kind: 'test', recordId, version: '1' });

export async function setupPhoneWorldFoundation(options = {}) {
  const context = await setupPhase17({ castSize: options.castSize || 2, manifestId: options.manifestId || 'phase23-phone-world-foundation' });
  const engine = new CanonicalEventEngine({
    database: context.database,
    eventTypes: createPhase23EventTypeRegistry(),
    projectors: [createPhoneWorldProjector(), ...(options.additionalProjectors || [])],
    now: () => '2026-08-31T03:30:00.000Z',
  });
  await engine.catchUp(context.scope);
  const phoneWorld = new PhoneWorldService({ database: context.database, eventEngine: engine });
  return { ...context, utilityEngine: engine, phoneWorld };
}

export function ownedInput(person, overrides = {}) {
  return {
    deviceId: person.deviceId,
    ownerActorId: person.actorId,
    ownerInstanceId: person.instanceId,
    ownerAccountId: person.accountId,
    ...overrides,
  };
}
