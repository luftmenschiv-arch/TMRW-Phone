export const POCKET_SOURCE_AUTHORITY = 'pocket-phone';
export const POCKET_MATCH_STATE = Object.freeze({ EXACT: 'exact', POSSIBLE: 'possible', AMBIGUOUS: 'ambiguous', UNRESOLVED: 'unresolved', CONFLICT: 'conflict', UNSUPPORTED: 'unsupported' });
export const POCKET_COMPARISON = Object.freeze({ EQUIVALENT: 'equivalent', POCKET_ONLY: 'pocket-only', V3_ONLY: 'v3-only', CONFLICTING: 'conflicting', AMBIGUOUS: 'ambiguous', UNSUPPORTED: 'unsupported' });
export const POCKET_OBSERVATION_TYPE = Object.freeze({ CONTACT: 'contact', DM_MESSAGE: 'dm-message', GROUP_MESSAGE: 'group-message', CALL_LOG: 'completed-call-log' });
export const POCKET_MAX_OBSERVATIONS = 500;
export const POCKET_MAX_QUARANTINE = 100;
