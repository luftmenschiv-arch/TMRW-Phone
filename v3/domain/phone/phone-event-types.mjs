import { defineEventType } from '../events/event-types.mjs';
import { createPhase5EventTypeRegistry } from '../knowledge/knowledge-event-types.mjs';
import { normalizePhoneState } from './device-state.mjs';
import { normalizeAccountSession } from './account-session.mjs';

export const PHONE_EVENT_TYPES = Object.freeze({ DEVICE_STATE: 'phone.device-state.v1', ACCOUNT_SESSION: 'phone.account-session.v1' });

const definitions = Object.freeze([
  defineEventType({ id: PHONE_EVENT_TYPES.DEVICE_STATE, description: 'Canonical device/holder/lock state snapshot; never a phone app action.', validatePayload: payload => Boolean(normalizePhoneState(payload?.state)) }),
  defineEventType({ id: PHONE_EVENT_TYPES.ACCOUNT_SESSION, description: 'Canonical account/device/actual-author session snapshot; never message content.', validatePayload: payload => Boolean(normalizeAccountSession(payload?.session)) }),
]);

export function createPhase6EventTypeRegistry(additional = []) {
  return createPhase5EventTypeRegistry([...definitions, ...additional]);
}
