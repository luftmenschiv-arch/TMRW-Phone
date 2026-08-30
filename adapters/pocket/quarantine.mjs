import { POCKET_MAX_QUARANTINE, POCKET_MATCH_STATE } from './constants.mjs';
export function quarantineRows(observations, maximum = POCKET_MAX_QUARANTINE) {
  const rows = []; for (const observation of observations) if (observation.matchState !== POCKET_MATCH_STATE.EXACT && rows.length < maximum) rows.push(Object.freeze({ id: `pocket-shadow-quarantine:${observation.sourceAuthority}:${observation.observationId}`, sourceAuthority: observation.sourceAuthority, observationId: observation.observationId, reasonCode: observation.matchState, reason: observation.reason, sourceMetadata: observation.sourceMetadata, current: true, nonCanonical: true, phase: 11 }));
  return Object.freeze(rows);
}
