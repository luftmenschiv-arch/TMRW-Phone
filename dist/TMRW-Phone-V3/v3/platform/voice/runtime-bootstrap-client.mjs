// Calls only the same-origin ST companion. The server chooses the installed
// service; the browser cannot supply an executable, path, or port.
export async function ensureLocalVoiceService({ fetchImpl, headers = {}, signal = null, timeoutMs = 90000, pollMs = 1000 }) {
  if (!fetchImpl || signal?.aborted) return false;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(abort, timeoutMs);
  const pause = () => new Promise(resolve => {
    const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, pollMs);
    controller.signal.addEventListener('abort', finish, { once: true });
    if (controller.signal.aborted) finish();
  });
  try {
    const started = await fetchImpl('/api/plugins/tmrw-voice-bootstrap/ensure', { method: 'POST', headers, signal: controller.signal });
    if (!started.ok || (await started.json()).ok !== true) return false;
    while (!controller.signal.aborted) {
      const response = await fetchImpl('/api/plugins/tmrw-voice-bootstrap/status', { signal: controller.signal });
      if (!response.ok) return false;
      const state = await response.json();
      if (state.ready) return true;
      if (['failed', 'paused'].includes(state.phase)) return false;
      await pause();
    }
  } catch { /* Old ST installations without the companion keep their normal error. */ }
  finally { clearTimeout(deadline); signal?.removeEventListener('abort', abort); }
  return false;
}
