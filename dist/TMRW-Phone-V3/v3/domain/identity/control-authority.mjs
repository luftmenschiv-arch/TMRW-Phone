import { requireText } from './identity-record.mjs';

export const ACTOR_CONTROL = Object.freeze({ PLAYER: 'player', AI: 'ai' });

export function createControlAuthority({ kind, controlKey }) {
  if (!Object.values(ACTOR_CONTROL).includes(kind)) throw new TypeError(`Unsupported Actor control authority: ${String(kind)}`);
  return Object.freeze({ kind, controlKey: requireText(controlKey, 'controlKey') });
}

export function isPlayerControlled(actor) {
  return actor?.entityType === 'actor' && actor.control === ACTOR_CONTROL.PLAYER;
}
