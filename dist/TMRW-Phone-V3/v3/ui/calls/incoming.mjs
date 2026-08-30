export function incomingCallViewModel({ session, historyItem, canAct }) {
  if (!session || session.state !== 'ringing') return null;
  return Object.freeze({
    kind: 'incoming',
    title: 'Incoming call',
    callSessionId: session.callSessionId,
    counterpartAccountId: historyItem?.counterpartAccountId || session.callingAccountId,
    counterpartLabel: historyItem?.displayLabel || 'Unknown caller',
    state: session.state,
    actions: Object.freeze([
      Object.freeze({ id: 'accept', label: 'Accept', enabled: Boolean(canAct) }),
      Object.freeze({ id: 'decline', label: 'Decline', enabled: Boolean(canAct) }),
    ]),
  });
}
