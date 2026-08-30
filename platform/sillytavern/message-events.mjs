import { requireText } from '../../domain/identity/identity-record.mjs';

const ROLES = new Set(['user', 'assistant']);
const MODES = new Set(['normal', 'quiet', 'impersonate']);
const ORIGINS = new Set(['main-rp', 'tmrw-phone-context']);
const CHANGE_KINDS = new Set(['new', 'reprocess', 'revision', 'swipe', 'replace', 'retracted']);

export function normalizeMainRpSource(input) {
  const text = String(input?.text || '');
  if (text.length > 16_000) throw new TypeError('Live Main RP source exceeds the bounded Phase 10 limit');
  const role = requireText(input?.role, 'mainRpSource.role'); if (!ROLES.has(role)) throw new TypeError(`Unsupported Main RP role: ${role}`);
  const mode = input?.mode || 'normal'; if (!MODES.has(mode)) throw new TypeError(`Unsupported Main RP generation mode: ${mode}`);
  const origin = input?.origin || 'main-rp'; if (!ORIGINS.has(origin)) throw new TypeError(`Unsupported Main RP source origin: ${origin}`);
  const sourceOrdinal = Number(input?.sourceOrdinal);
  if (!Number.isSafeInteger(sourceOrdinal) || sourceOrdinal < 0) throw new TypeError('mainRpSource.sourceOrdinal must be a non-negative safe integer');
  const changeKind = input?.changeKind || 'new'; if (!CHANGE_KINDS.has(changeKind)) throw new TypeError(`Unsupported Main RP source change kind: ${changeKind}`);
  return Object.freeze({
    sourceAuthority: requireText(input?.sourceAuthority || 'sillytavern-main-rp', 'mainRpSource.sourceAuthority'),
    sourceMessageId: requireText(input?.sourceMessageId, 'mainRpSource.sourceMessageId'),
    sourceVersionId: requireText(input?.sourceVersionId, 'mainRpSource.sourceVersionId'),
    sourceOrdinal, role, mode, origin, text,
    changeKind,
    actorBinding: input?.actorBinding ? Object.freeze(structuredClone(input.actorBinding)) : null,
    mentionBindings: Object.freeze(structuredClone(input?.mentionBindings || {})),
    explicitPhoneActions: Object.freeze(structuredClone(input?.explicitPhoneActions || [])),
  });
}

export function mainRpCanonicalSource(source, actionKey) {
  const normalized = normalizeMainRpSource(source);
  return Object.freeze({ authority: normalized.sourceAuthority, kind: 'main-rp', recordId: `${normalized.sourceMessageId}:${requireText(actionKey, 'actionKey')}`, version: normalized.sourceVersionId });
}

export function isHandoffEchoSource(source) { return normalizeMainRpSource(source).origin === 'tmrw-phone-context'; }
