const MAX_INPUT = 256;
const UNIT_MS = Object.freeze({ second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000 });

export function parseDeterministicTimeEvidence(input) {
  const text = String(input || '').trim();
  if (!text || text.length > MAX_INPUT) return Object.freeze({ status: 'unresolved', reason: 'empty-or-unbounded' });
  const dateTime = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(Z|[+-]\d{2}:\d{2}))?$/i);
  if (dateTime) return Object.freeze({ status: 'parsed', kind: 'anchor', value: { localDate: dateTime[1], localTime: `${dateTime[2].padStart(2, '0')}:${dateTime[3]}:${dateTime[4] || '00'}`, timezone: dateTime[5] || null, precision: 'date-time', sourceText: text } });
  const time = text.match(/^(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/i);
  if (time) return Object.freeze({ status: 'parsed', kind: 'anchor', value: { localDate: null, localTime: `${time[1].padStart(2, '0')}:${time[2]}:${time[3] || '00'}`, timezone: null, precision: 'time-only', sourceText: text } });
  const relative = text.match(/^(?:in\s+)?(\d+(?:\.\d+)?)\s*(seconds?|minutes?|hours?|days?)(?:\s+(?:later|after))?$/i);
  if (relative) {
    const unit = relative[2].toLowerCase().replace(/s$/, '');
    const durationMs = Number(relative[1]) * UNIT_MS[unit];
    if (Number.isSafeInteger(durationMs)) return Object.freeze({ status: 'parsed', kind: 'advance', value: { durationMs, basis: 'explicit-relative', confidence: 'explicit', sourceText: text } });
  }
  return Object.freeze({ status: 'unresolved', reason: 'ambiguous-or-unsupported' });
}

export const TIME_PARSER_MAX_INPUT = MAX_INPUT;
