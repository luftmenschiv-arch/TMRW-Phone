import { requireText } from '../identity/identity-record.mjs';

export const CALL_STATE = Object.freeze({ RINGING: 'ringing', ACTIVE: 'active', ENDED: 'ended', DECLINED: 'declined', CANCELLED: 'cancelled', MISSED: 'missed' });
export const CALL_ACTION = Object.freeze({ ACCEPT: 'accept', END: 'end', DECLINE: 'decline', CANCEL: 'cancel', MISS: 'miss' });
const TRANSITIONS = Object.freeze({
  [CALL_STATE.RINGING]: Object.freeze({ [CALL_ACTION.ACCEPT]: CALL_STATE.ACTIVE, [CALL_ACTION.DECLINE]: CALL_STATE.DECLINED, [CALL_ACTION.CANCEL]: CALL_STATE.CANCELLED, [CALL_ACTION.MISS]: CALL_STATE.MISSED }),
  [CALL_STATE.ACTIVE]: Object.freeze({ [CALL_ACTION.END]: CALL_STATE.ENDED }),
});

export function transitionCallState(currentState, action) {
  const from = requireText(currentState, 'call.currentState'); const normalizedAction = requireText(action, 'call.transition.action');
  const target = TRANSITIONS[from]?.[normalizedAction];
  if (!target) throw new TypeError(`Invalid Call lifecycle transition: ${from} -> ${normalizedAction}`);
  return target;
}

export function isTerminalCallState(state) { return [CALL_STATE.ENDED, CALL_STATE.DECLINED, CALL_STATE.CANCELLED, CALL_STATE.MISSED].includes(state); }
