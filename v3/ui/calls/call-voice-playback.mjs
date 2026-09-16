const requireId = (value, field) => { const id = String(value || '').trim(); if (!id) throw new TypeError(`${field} is required`); return id; };

export class CallVoicePlaybackController {
  #audioFactory;
  #active = null;
  #paused = false;
  #played = new Set();

  constructor({ audioFactory = source => globalThis.Audio ? new globalThis.Audio(source) : null } = {}) {
    this.#audioFactory = typeof audioFactory === 'function' ? audioFactory : null;
  }

  get status() {
    return Object.freeze({
      active: Boolean(this.#active),
      callSessionId: this.#active?.callSessionId || null,
      transcriptEntryId: this.#active?.transcriptEntryId || null,
      playedCount: this.#played.size,
      paused: this.#paused,
    });
  }

  async play({ callSessionId, transcriptEntryId, audioArtifactRef }) {
    const callId = requireId(callSessionId, 'callSessionId');
    const transcriptId = requireId(transcriptEntryId, 'transcriptEntryId');
    const ref = requireId(audioArtifactRef, 'audioArtifactRef');
    if (this.#played.has(transcriptId)) return Object.freeze({ status: 'duplicate', callSessionId: callId, transcriptEntryId: transcriptId });
    this.cancelActive('replaced');
    this.#paused = false;
    if (!this.#audioFactory) return Object.freeze({ status: 'unavailable', callSessionId: callId, transcriptEntryId: transcriptId });
    const audio = this.#audioFactory(ref);
    if (!audio || typeof audio.play !== 'function') return Object.freeze({ status: 'unavailable', callSessionId: callId, transcriptEntryId: transcriptId });

    return new Promise(resolve => {
      let settled = false;
      const settle = status => {
        if (settled) return;
        settled = true;
        if (status === 'completed') this.#played.add(transcriptId);
        if (this.#active?.transcriptEntryId === transcriptId) this.#active = null;
        try { audio.removeEventListener?.('ended', onEnded); } catch {}
        try { audio.removeEventListener?.('error', onError); } catch {}
        resolve(Object.freeze({ status, callSessionId: callId, transcriptEntryId: transcriptId }));
      };
      const onEnded = () => settle('completed');
      const onError = () => settle('failed');
      audio.addEventListener?.('ended', onEnded, { once: true });
      audio.addEventListener?.('error', onError, { once: true });
      this.#active = { callSessionId: callId, transcriptEntryId: transcriptId, audio, settle };
      try {
        const started = audio.play();
        if (started && typeof started.catch === 'function') started.catch(() => settle('failed'));
      } catch { settle('failed'); }
    });
  }

  cancelActive(reason = 'cancelled') {
    const active = this.#active;
    if (!active) return false;
    try { active.audio.pause?.(); } catch {}
    try { active.audio.currentTime = 0; } catch {}
    this.#paused = false;
    active.settle(reason === 'replaced' ? 'replaced' : 'cancelled');
    return true;
  }

  pauseActive() {
    if (!this.#active || this.#paused) return false;
    try { this.#active.audio.pause?.(); this.#paused = true; return true; } catch { return false; }
  }

  resumeActive() {
    if (!this.#active || !this.#paused) return false;
    try { const resumed = this.#active.audio.play?.(); this.#paused = false; if (resumed?.catch) resumed.catch(() => this.cancelActive('failed')); return true; } catch { return false; }
  }

  cancelCall(callSessionId) {
    const id = String(callSessionId || '').trim();
    if (!id || this.#active?.callSessionId !== id) return false;
    return this.cancelActive('cancelled');
  }

  dispose() { this.cancelActive('cancelled'); }
}
