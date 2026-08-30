import { canonicalJson } from '../../domain/events/idempotency.mjs';
export async function digest(value) { const bytes = new TextEncoder().encode(canonicalJson(value)); const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
export const boundedText = (value, maximum = 4096) => String(value ?? '').slice(0, maximum);
