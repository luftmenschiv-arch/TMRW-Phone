export function outgoingCallViewModel({ session, historyItem, canAct }) {
  if (!session || session.state !== 'ringing') return null;
  return Object.freeze({
    kind: 'outgoing',
    title: 'Calling…',
    callSessionId: session.callSessionId,
    counterpartAccountId: historyItem?.counterpartAccountId || session.calledAccountId,
    counterpartLabel: historyItem?.displayLabel || 'Unknown contact',
    state: session.state,
    actions: Object.freeze([Object.freeze({ id: 'cancel', label: 'Cancel', enabled: Boolean(canAct) })]),
  });
}
