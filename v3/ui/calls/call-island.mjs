import { incomingCallViewModel } from './incoming.mjs';
import { outgoingCallViewModel } from './outgoing.mjs';
import { activeCallViewModel } from './active.mjs';
import { endedCallViewModel } from './ended.mjs';

function chooseSession(sessions, selectedCallSessionId) {
  return sessions.find(row => row.state === 'active')
    || sessions.find(row => row.state === 'ringing')
    || (selectedCallSessionId ? sessions.find(row => row.callSessionId === selectedCallSessionId) : null)
    || null;
}

export function callIslandViewModel({ sessions = [], history = [], transcript = [], viewerAccountId, selectedCallSessionId = null, canAct = false }) {
  const session = chooseSession(sessions, selectedCallSessionId);
  if (!session) return Object.freeze({ kind: 'empty', title: 'No calls yet', callSessionId: null, actions: Object.freeze([]) });
  const historyItem = history.find(row => row.callSessionId === session.callSessionId) || null;
  if (session.state === 'active') return activeCallViewModel({ session, historyItem, transcript, canAct });
  if (session.state === 'ringing' && session.calledAccountId === viewerAccountId) return incomingCallViewModel({ session, historyItem, canAct });
  if (session.state === 'ringing' && session.callingAccountId === viewerAccountId) return outgoingCallViewModel({ session, historyItem, canAct });
  return endedCallViewModel({ session, historyItem }) || Object.freeze({ kind: 'unknown', title: 'Call', callSessionId: session.callSessionId, state: session.state, actions: Object.freeze([]) });
}
