import { requireText } from './identity-record.mjs';

const PREFIXES = Object.freeze({
  'character-card': 'card',
  actor: 'actor',
  'character-instance': 'instance',
  story: 'story',
  branch: 'branch',
  device: 'device',
  account: 'account',
  'identity-mapping': 'mapping',
  'identity-batch': 'batch',
  'card-membership': 'membership',
});

function prefixFor(type) {
  const prefix = PREFIXES[type];
  if (!prefix) throw new TypeError(`Unknown identity ID type: ${String(type)}`);
  return prefix;
}

export async function deterministicIdentityId(type, { sourceAuthority, stableSourceId, scopeParts = [] }) {
  const prefix = prefixFor(type);
  const authority = requireText(sourceAuthority, 'sourceAuthority');
  const sourceId = requireText(stableSourceId, 'stableSourceId');
  const parts = scopeParts.map((part, index) => requireText(part, `scopeParts[${index}]`));
  const seed = JSON.stringify(['tmrw-phone-v3-identity-v1', type, authority, sourceId, ...parts]);
  const bytes = new TextEncoder().encode(seed);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex.slice(0, 32)}`;
}

export function newIdentityId(type, cryptoApi = globalThis.crypto) {
  const prefix = prefixFor(type);
  if (typeof cryptoApi?.randomUUID !== 'function') throw new Error('A cryptographic randomUUID implementation is required');
  return `${prefix}_${cryptoApi.randomUUID().replaceAll('-', '')}`;
}

export function assertIdentityId(type, id) {
  const prefix = `${prefixFor(type)}_`;
  const value = requireText(id, 'id');
  if (!value.startsWith(prefix)) throw new TypeError(`Expected a ${type} identity ID`);
  return value;
}
