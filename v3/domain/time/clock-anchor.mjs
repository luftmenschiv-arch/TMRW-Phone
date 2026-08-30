import { V3ChronologyError } from '../../storage/errors.mjs';
import { optionalText, requireText } from '../identity/identity-record.mjs';

export const CLOCK_AUTHORITY = Object.freeze({
  DIRECTOR: 'director',
  USER_EXPLICIT: 'user-explicit',
  ASSISTANT_ACCEPTED: 'assistant-accepted',
  EXTERNAL_EXPLICIT: 'external-explicit',
});

export const CLOCK_AUTHORITY_RANK = Object.freeze({
  [CLOCK_AUTHORITY.DIRECTOR]: 600,
  [CLOCK_AUTHORITY.USER_EXPLICIT]: 500,
  [CLOCK_AUTHORITY.ASSISTANT_ACCEPTED]: 400,
  [CLOCK_AUTHORITY.EXTERNAL_EXPLICIT]: 300,
});

export const CLOCK_PRECISION = Object.freeze({
  DATE_TIME: 'date-time',
  DATE: 'date',
  TIME_ONLY: 'time-only',
  RELATIVE: 'relative',
});

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const ZONE_PATTERN = /^(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;

function validCalendarDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function normalizeClockAnchor(input) {
  const authority = requireText(input?.authority, 'anchor.authority');
  if (!CLOCK_AUTHORITY_RANK[authority]) throw new V3ChronologyError(`Unsupported Clock Anchor authority: ${authority}`);
  const precision = requireText(input?.precision, 'anchor.precision');
  if (!Object.values(CLOCK_PRECISION).includes(precision)) throw new V3ChronologyError(`Unsupported Clock Anchor precision: ${precision}`);
  const localDate = optionalText(input?.localDate, 'anchor.localDate');
  const localTime = optionalText(input?.localTime, 'anchor.localTime');
  const timezone = optionalText(input?.timezone, 'anchor.timezone');
  if (localDate && !validCalendarDate(localDate)) throw new V3ChronologyError('Clock Anchor localDate must be a valid YYYY-MM-DD date');
  if (localTime && !TIME_PATTERN.test(localTime)) throw new V3ChronologyError('Clock Anchor localTime must be HH:mm or HH:mm:ss');
  if (timezone && !ZONE_PATTERN.test(timezone)) throw new V3ChronologyError('Clock Anchor timezone must be Z or an explicit UTC offset');
  if (precision === CLOCK_PRECISION.DATE_TIME && (!localDate || !localTime)) throw new V3ChronologyError('date-time precision requires localDate and localTime');
  if (precision === CLOCK_PRECISION.DATE && (!localDate || localTime)) throw new V3ChronologyError('date precision requires only localDate');
  if (precision === CLOCK_PRECISION.TIME_ONLY && (!localTime || localDate)) throw new V3ChronologyError('time-only precision requires only localTime');
  if (precision === CLOCK_PRECISION.RELATIVE && (localDate || localTime || timezone)) throw new V3ChronologyError('relative precision cannot invent date, time, or timezone');
  return Object.freeze({
    localDate,
    localTime: localTime && localTime.length === 5 ? `${localTime}:00` : localTime,
    timezone,
    precision,
    authority,
    confidence: 'explicit',
    sourceText: optionalText(input?.sourceText, 'anchor.sourceText'),
    narrativeSegment: optionalText(input?.narrativeSegment, 'anchor.narrativeSegment'),
  });
}

export function clockAuthorityRank(authority) {
  return CLOCK_AUTHORITY_RANK[authority] || 0;
}

export function localAnchorScalar(anchor) {
  if (!anchor?.localTime) return null;
  const [hour, minute, second = 0] = anchor.localTime.split(':').map(Number);
  if (!anchor.localDate) return ((hour * 60 + minute) * 60 + second) * 1000;
  const [year, month, day] = anchor.localDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

export function addLocalDuration(anchor, durationMs) {
  const scalar = localAnchorScalar(anchor);
  if (scalar === null) return { localDate: anchor?.localDate || null, localTime: anchor?.localTime || null, dayOffset: 0 };
  const next = scalar + durationMs;
  const date = new Date(next);
  const time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}`;
  if (anchor.localDate) {
    return { localDate: date.toISOString().slice(0, 10), localTime: time, dayOffset: 0 };
  }
  return { localDate: null, localTime: time, dayOffset: Math.floor(next / 86_400_000) };
}
