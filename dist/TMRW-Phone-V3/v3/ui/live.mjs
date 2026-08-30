export function liveViewModel({ session, viewers, messages }) {
  if (!session) return Object.freeze({ empty: true, session: null, viewerCount: 0, messages: Object.freeze([]) });
  return Object.freeze({ empty: false, session: Object.freeze({ sessionId: session.sessionId, hostAccountId: session.hostAccountId, title: session.title, topic: session.topic, status: session.status, storyTimeRef: session.startedStoryTimeRef || session.createdStoryTimeRef }), viewerCount: viewers?.count || 0, messages: Object.freeze((messages?.items || []).map(message => Object.freeze({ messageId: message.messageId, authorAccountId: message.authorAccountId, text: message.text, storyTimeRef: message.storyTimeRef }))) });
}
