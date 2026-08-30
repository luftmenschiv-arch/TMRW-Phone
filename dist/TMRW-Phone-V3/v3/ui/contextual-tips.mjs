export function blockedAccessTip(authorization) {
  if (!authorization?.needsChoice) return null;
  return Object.freeze({ title: 'Phone locked', text: 'You can discover access naturally or choose a player-only override. An override does not change canon.', actions: Object.freeze(authorization.choices || []) });
}
