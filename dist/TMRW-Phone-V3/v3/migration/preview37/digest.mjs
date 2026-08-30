import { canonicalJson } from '../../domain/events/idempotency.mjs';

export async function previewDigest(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function boundedPreviewText(value, maximum = 4096) {
  return String(value ?? '').slice(0, maximum);
}

