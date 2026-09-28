import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { setupPhase9, startCall, transitionCall, addCallText } from '../phase9/call-fixtures.mjs';
import { CALL_ACTION } from '../../domain/calls/call-state-machine.mjs';
import { CallBotReplyCoordinator } from '../../application/call-bot-reply-coordinator.mjs';

// Supply an inspected, pinned KeyFlow source file. Never load personal settings
// or API keys. Network and UI are mocked; recovery/rotation logic stays real.
const sourcePath = process.env.TMRW_KEYFLOW_SOURCE;
if (!sourcePath) throw new Error('Set TMRW_KEYFLOW_SOURCE to the inspected KeyFlow index.js');
const source = await fs.readFile(sourcePath, 'utf8');
const version = source.match(/const EXTENSION_VERSION = '([^']+)'/)?.[1];
console.log(`KeyFlow ${version}: sha256=${crypto.createHash('sha256').update(source).digest('hex')}`);
const GENERATE = '/api/backends/chat-completions/generate';
const successText = JSON.stringify({ segments: [{ subtitle_th: 'ได้ยินชัดเจนครับ', spoken_text: 'Yes, I can hear you.' }] });
const jsonResponse = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const success = () => jsonResponse(200, { choices: [{ message: { content: successText } }] });
const failure = status => jsonResponse(status, { error: { message: status === 503 ? 'Service unavailable' : 'Invalid API key' } });
const request = (extra = {}) => ({ method: 'POST', body: JSON.stringify({ chat_completion_source: 'makersuite', model: 'test-model', stream: false, messages: [{ role: 'user', content: 'PRIVATE_TEST_PROMPT' }], ...extra }) });

function harness(responses, overrides = {}) {
  const calls = []; const rotations = []; const diagnostics = [];
  const secrets = { makersuite: [{ id: 'fake-a', label: 'Test A', active: true }, { id: 'fake-b', label: 'Test B', active: false }] };
  const transport = async (input, init) => {
    calls.push({ input, init });
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const next = responses.shift();
    if (!next) throw new Error('Unexpected extra network request');
    return typeof next === 'function' ? next(input, init) : next;
  };
  const sandbox = {
    URL, Request, Response, Headers, TextDecoder, TextEncoder, ReadableStream, AbortController,
    console, crypto, setTimeout, clearTimeout, structuredClone,
    location: { origin: 'http://127.0.0.1:8000' }, navigator: { userAgent: 'Mock browser' },
    document: { querySelector: () => null }, window: { fetch: transport },
    eventSource: { emit: async () => {} }, event_types: { SECRET_ROTATED: 'secret-rotated' },
    getRequestHeaders: () => ({}), saveSettingsDebounced: () => {},
    extension_settings: {}, extensionNames: [], secret_state: secrets,
    SECRET_KEYS: { MAKERSUITE: 'makersuite', OPENROUTER: 'openrouter', XAI: 'xai', ZAI: 'zai' },
    readSecretState: async () => {}, diagnostics, overrides,
    fetch: async (url, init) => {
      assert.equal(url, '/api/secrets/rotate');
      const body = JSON.parse(init.body); rotations.push(body.id);
      for (const item of secrets[body.key]) item.active = item.id === body.id;
      return jsonResponse(200, {});
    },
  };
  vm.createContext(sandbox);
  const code = source.replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replace(/^export /gm, '')
    .replace(/if \(document.readyState === 'loading'\)[\s\S]*$/, '');
  vm.runInContext(code + `
    settings = { ...structuredClone(DEFAULT_SETTINGS), notifications: false, ...overrides };
    notify = () => {}; renderAll = () => {}; addLog = () => {};
    wait = async () => {};
    if (typeof showRecoveryStatus === 'function') showRecoveryStatus = () => {};
    if (typeof clearRecoveryStatus === 'function') clearRecoveryStatus = () => {};
    persistDiagnostic = record => diagnostics.push(structuredClone(record));
    installFetchInterceptor();
    globalThis.runFetch = (...args) => window.fetch(...args);
    globalThis.toggle = value => settings.enabled = value;
    globalThis.installAgain = installFetchInterceptor;
    globalThis.uninstall = uninstallFetchInterceptor;
  `, sandbox);
  return { ...sandbox, calls, rotations, diagnostics };
}

test('quiet call JSON survives KeyFlow unchanged without any extra request', async () => {
  const h = harness([success()]); const init = request();
  const response = await h.runFetch(GENERATE, init);
  assert.equal((await response.json()).choices[0].message.content, successText);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].init, init);
  assert.equal(h.rotations.length, 0);
});

test('401 rotates once and retries the identical structured call body', async () => {
  const h = harness([failure(401), success()]); const init = request({ json_schema: { type: 'object' } });
  assert.equal((await h.runFetch(GENERATE, init)).status, 200);
  assert.deepEqual(h.rotations, ['fake-b']); assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].init.body, init.body);
  assert.equal(JSON.stringify(h.diagnostics).includes('PRIVATE_TEST_PROMPT'), false);
});

test('503 recovery is owned by KeyFlow, not duplicated by Phone', async () => {
  const h = harness([failure(503), success()], { rotateServerErrors: true });
  assert.equal((await h.runFetch(GENERATE, request())).status, 200);
  assert.equal(h.calls.length, 2);
  assert.equal(h.rotations.length, version.startsWith('1.5.') ? 0 : 1);
});

test('exhausted recovery returns failure instead of retrying indefinitely', async () => {
  const h = harness([failure(503), failure(503), failure(503)], { rotateServerErrors: true });
  assert.equal((await h.runFetch(GENERATE, request())).status, 503);
  assert.equal(h.calls.length, version.startsWith('1.5.') ? 3 : 2);
  assert.equal(h.rotations.length, 1);
});

test('local voice, upload, WAV audition and unsupported providers pass through', async () => {
  for (const [url, init] of [
    ['http://127.0.0.1:18769/turn/push', request()],
    ['http://127.0.0.1:18768/v1/audio', { method: 'POST', body: new Uint8Array([1, 2]) }],
    ['/scripts/extensions/third-party/TMRW-Phone-V3/voice-packs/previews/male-soft-youth-en.wav', {}],
    [GENERATE, request({ chat_completion_source: 'unsupported-test' })],
  ]) {
    const original = failure(503); const h = harness([original]);
    assert.equal(await h.runFetch(url, init), original);
    assert.equal(h.calls.length, 1); assert.equal(h.rotations.length, 0);
  }
});

test('initial abort is preserved without rotating or retrying', async () => {
  const h = harness([success()]); const controller = new AbortController(); controller.abort();
  await assert.rejects(h.runFetch(GENERATE, { ...request(), signal: controller.signal }), { name: 'AbortError' });
  assert.equal(h.calls.length, 1); assert.equal(h.rotations.length, 0);
});

test('disabled KeyFlow and repeated installation do not add duplicate requests', async () => {
  const original = failure(401); const h = harness([original, success()]);
  h.installAgain(); h.toggle(false);
  assert.equal(await h.runFetch(GENERATE, request()), original);
  assert.equal(h.rotations.length, 0);
  h.uninstall(); assert.equal((await h.window.fetch(GENERATE, request())).status, 200);
  assert.equal(h.calls.length, 2);
});

test('streamed main-RP response remains readable with no replay after visible output', async () => {
  const stream = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n';
  const h = harness([new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })]);
  assert.equal(await (await h.runFetch(GENERATE, request({ stream: true }))).text(), stream);
  assert.equal(h.calls.length, 1); assert.equal(h.rotations.length, 0);
});

test('v1.5 model fallback retains the call schema, prompt and abort signal', { skip: !version.startsWith('1.5.') }, async () => {
  const h = harness([failure(503), failure(503), success()], { fallbackModels: { makersuite: ['backup-model'] } });
  const controller = new AbortController();
  const init = { ...request({ json_schema: { type: 'object' } }), signal: controller.signal };
  assert.equal((await h.runFetch(GENERATE, init)).status, 200);
  assert.equal(h.calls.length, 3); assert.equal(h.rotations.length, 0);
  const body = JSON.parse(h.calls[2].init.body);
  assert.equal(body.model, 'backup-model');
  assert.deepEqual(body.messages, JSON.parse(init.body).messages);
  assert.deepEqual(body.json_schema, { type: 'object' });
  assert.equal(h.calls[2].init.signal, controller.signal);
});

test('hangup or deadline during retry cannot commit a late bot reply', async () => {
  for (const mode of ['hangup', 'deadline']) {
    const c = await setupPhase9({ manifestId: `keyflow-${mode}` });
    const call = await startCall(c, { key: mode });
    await transitionCall(c, call.session.callSessionId, CALL_ACTION.ACCEPT, { actor: c.alice, key: `${mode}-accept` });
    const commit = await addCallText(c, call.session.callSessionId, { key: `${mode}-user` });
    let release; let announceRetry;
    const retryStarted = new Promise(resolve => { announceRetry = resolve; });
    const h = harness([failure(401), () => { announceRetry(); return new Promise(resolve => { release = () => resolve(success()); }); }]);
    const controller = new AbortController(); let stopCount = 0;
    const coordinator = new CallBotReplyCoordinator({
      callService: c.calls, settingsService: c.settings,
      voiceProfileService: { resolve: async () => ({ profileName: 'male-polite-dangerous', language: 'en' }) },
      bindingResolver: async () => ({ actorBinding: c.alice }),
      getContext: () => ({ characterId: 0, name2: 'Alice', stopGeneration: () => { stopCount++; }, generateQuietPrompt: async () => {
        const response = await h.runFetch(GENERATE, request());
        return (await response.json()).choices[0].message.content;
      } }),
    });
    const preparing = coordinator.prepareReplyToCommittedUserTranscript({ scope: c.scope, playerInstanceId: c.user.instanceId, commit, signal: controller.signal, timeoutMs: mode === 'deadline' ? 100 : 1000 });
    await retryStarted;
    if (mode === 'hangup') {
      await transitionCall(c, call.session.callSessionId, CALL_ACTION.END, { actor: c.user, key: 'end' });
      controller.abort();
    }
    const result = await preparing;
    assert.equal(result.reason, mode === 'hangup' ? 'generation-cancelled' : 'generation-timeout');
    assert.equal(stopCount, mode === 'deadline' ? 1 : 0);
    release(); await new Promise(resolve => setTimeout(resolve, 20));
    const transcript = await c.calls.listTranscript({ scope: c.scope, viewerAccountId: c.user.accountId, callSessionId: call.session.callSessionId });
    assert.equal(transcript.length, 1);
    assert.equal(h.calls.length, 2);
  }
});

test('real Phone coordinator commits one reply after KeyFlow retry and preserves main RP', async () => {
  const c = await setupPhase9({ manifestId: 'keyflow-compat' });
  const call = await startCall(c, { key: 'kf-call' });
  await transitionCall(c, call.session.callSessionId, CALL_ACTION.ACCEPT, { actor: c.alice, key: 'kf-accept' });
  const commit = await addCallText(c, call.session.callSessionId, { speaker: c.user, text: 'Can you hear me?', key: 'kf-user' });
  const h = harness([failure(401), success()]);
  const chat = [{ is_user: true, mes: 'Existing main RP' }]; let quietCalls = 0;
  const coordinator = new CallBotReplyCoordinator({
    callService: c.calls, settingsService: c.settings,
    voiceProfileService: { resolve: async () => ({ profileName: 'male-polite-dangerous', language: 'en' }) },
    bindingResolver: async () => ({ actorBinding: c.alice }),
    getContext: () => ({ characterId: 0, name2: 'Alice', chat, generateQuietPrompt: async options => {
      quietCalls++; assert.equal(options.quietToLoud, false);
      const response = await h.runFetch(GENERATE, request({ messages: [{ role: 'user', content: options.quietPrompt }], json_schema: options.jsonSchema }));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()).choices[0].message.content;
    } }),
  });
  const input = { scope: c.scope, playerInstanceId: c.user.instanceId, commit };
  const result = await coordinator.replyToCommittedUserTranscript(input);
  assert.equal(result.committed, true);
  const again = await coordinator.replyToCommittedUserTranscript(input);
  assert.equal(again.event.id, result.event.id); assert.equal(quietCalls, 1);
  assert.equal(h.calls.length, 2);
  const transcript = await c.calls.listTranscript({ scope: c.scope, viewerAccountId: c.user.accountId, callSessionId: call.session.callSessionId });
  assert.equal(transcript.length, 2);
  assert.deepEqual(chat, [{ is_user: true, mes: 'Existing main RP' }]);
});
