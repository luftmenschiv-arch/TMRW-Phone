const requireId = (value, field) => { const id = String(value || '').trim(); if (!id) throw new TypeError(`${field} is required`); return id; };

export class CallVoicePlaybackController {
  #audioFactory;
  #active = null;
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
    });
  }

  async play({ callSessionId, transcriptEntryId, audioArtifactRef }) {
    const callId = requireId(callSessionId, 'callSessionId');
    const transcriptId = requireId(transcriptEntryId, 'transcriptEntryId');
    const ref = requireId(audioArtifactRef, 'audioArtifactRef');
    if (this.#played.has(transcriptId)) return Object.freeze({ status: 'duplicate', callSessionId: callId, transcriptEntryId: transcriptId });
    this.#played.add(transcriptId);
    this.cancelActive('replaced');
    if (!this.#audioFactory) return Object.freeze({ status: 'unavailable', callSessionId: callId, transcriptEntryId: transcriptId });
    const audio = this.#audioFactory(ref);
    if (!audio || typeof audio.play !== 'function') return Object.freeze({ status: 'unavailable', callSessionId: callId, transcriptEntryId: transcriptId });

    return new Promise(resolve => {
      let settled = false;
      const settle = status => {
        if (settled) return;
        settled = true;
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
    active.settle(reason === 'replaced' ? 'replaced' : 'cancelled');
    return true;
  }

  cancelCall(callSessionId) {
    const id = String(callSessionId || '').trim();
    if (!id || this.#active?.callSessionId !== id) return false;
    return this.cancelActive('cancelled');
  }

  dispose() { this.cancelActive('cancelled'); }
}
