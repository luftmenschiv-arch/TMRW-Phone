const DEFAULT_MAX_TURNS = 32;
const DEFAULT_MAX_EVENTS = 96;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeId(value) {
  return String(value || '').trim().slice(0, 160);
}

function safeDetail(detail = {}) {
  const result = {};
  if (Number.isSafeInteger(detail.segmentIndex) && detail.segmentIndex >= 0) result.segmentIndex = detail.segmentIndex;
  if (Number.isSafeInteger(detail.segmentCount) && detail.segmentCount >= 0) result.segmentCount = detail.segmentCount;
  if (['en', 'ja'].includes(detail.language)) result.language = detail.language;
  if (typeof detail.cached === 'boolean') result.cached = detail.cached;
  if (typeof detail.observable === 'boolean') result.observable = detail.observable;
  if (detail.outcome) result.outcome = String(detail.outcome).slice(0, 80);
  if (Number.isFinite(detail.durationMs) && detail.durationMs >= 0) result.durationMs = Math.round(detail.durationMs);
  return Object.freeze(result);
}

function frozenRecord(record, now) {
  const events = Object.freeze(record.events.map(event => Object.freeze({ ...event })));
  const firstPlayback = record.events.find(event => event.phase === 'playback-start');
  const last = record.events.at(-1);
  return Object.freeze({
    turnId: record.turnId,
    callSessionId: record.callSessionId,
    startedAt: record.startedAt,
    status: record.status,
    timeToFirstAudioMs: firstPlayback ? firstPlayback.offsetMs : null,
    totalTurnMs: record.finishedAt === null ? Math.max(0, Math.round(now - record.startedMono)) : Math.max(0, Math.round(record.finishedAt - record.startedMono)),
    lastPhase: last?.phase || null,
    events,
  });
}

export class CallTimingDiagnostics {
  #now;
  #wallClock;
  #maxTurns;
  #maxEvents;
  #records = new Map();

  constructor({ now = () => globalThis.performance?.now?.() ?? Date.now(), wallClock = () => Date.now(), maxTurns = DEFAULT_MAX_TURNS, maxEvents = DEFAULT_MAX_EVENTS } = {}) {
    this.#now = now;
    this.#wallClock = wallClock;
    this.#maxTurns = Math.max(1, Number(maxTurns) || DEFAULT_MAX_TURNS);
    this.#maxEvents = Math.max(8, Number(maxEvents) || DEFAULT_MAX_EVENTS);
  }

  begin(turnId, { callSessionId = null } = {}) {
    const id = safeId(turnId);
    if (!id) return null;
    const existing = this.#records.get(id);
    if (existing) {
      if (!existing.callSessionId && callSessionId) existing.callSessionId = safeId(callSessionId);
      return id;
    }
    const startedMono = finite(this.#now());
    const record = { turnId: id, callSessionId: safeId(callSessionId) || null, startedAt: new Date(finite(this.#wallClock(), Date.now())).toISOString(), startedMono, finishedAt: null, status: 'active', events: [] };
    this.#records.set(id, record);
    this.mark(id, 'user-submit');
    while (this.#records.size > this.#maxTurns) this.#records.delete(this.#records.keys().next().value);
    return id;
  }

  mark(turnId, phase, detail = {}) {
    const id = safeId(turnId);
    const phaseName = String(phase || '').trim().slice(0, 80);
    if (!id || !phaseName) return false;
    if (!this.#records.has(id)) this.begin(id, { callSessionId: detail.callSessionId });
    const record = this.#records.get(id);
    const point = finite(this.#now(), record.startedMono);
    record.events.push(Object.freeze({ phase: phaseName, offsetMs: Math.max(0, Math.round(point - record.startedMono)), ...safeDetail(detail) }));
    if (record.events.length > this.#maxEvents) record.events.splice(0, record.events.length - this.#maxEvents);
    return true;
  }

  finish(turnId, status = 'completed', detail = {}) {
    const id = safeId(turnId);
    if (!id || !this.#records.has(id)) return false;
    const record = this.#records.get(id);
    if (record.finishedAt === null) record.finishedAt = finite(this.#now(), record.startedMono);
    record.status = String(status || 'completed').slice(0, 80);
    this.mark(id, 'turn-finished', { ...detail, outcome: record.status });
    return true;
  }

  snapshot({ limit = 10 } = {}) {
    const now = finite(this.#now());
    const records = [...this.#records.values()].slice(-Math.max(1, Number(limit) || 10)).reverse().map(record => frozenRecord(record, now));
    return Object.freeze({ retention: Object.freeze({ maxTurns: this.#maxTurns, maxEventsPerTurn: this.#maxEvents }), privacy: Object.freeze({ promptTextStored: false, transcriptTextStored: false, spokenTextStored: false, providerSecretsStored: false, reasoningStored: false }), turns: Object.freeze(records) });
  }
}

export const callTimingDiagnosticsPolicy = Object.freeze({ maxTurns: DEFAULT_MAX_TURNS, maxEventsPerTurn: DEFAULT_MAX_EVENTS, contentFree: true });
