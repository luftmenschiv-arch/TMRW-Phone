import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installPack, validatePackIndex } from './pack-installer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.TMRW_VOICE_HOME || path.join(os.homedir(), '.tmrw-voice'));
const port = Number(process.env.TMRW_VOICE_MANAGER_PORT || 18768);
const runtimeUrl = process.env.TMRW_VOICE_RUNTIME_URL || 'http://127.0.0.1:18769';
const catalogPath = process.env.TMRW_VOICE_CATALOG || path.resolve(here, '../../voice-packs/catalog/presets.v1.json');
const jobs = new Map();

const safeId = value => String(value || '').trim().replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/g, '').slice(0, 96);
const send = (response, status, value) => { const body = JSON.stringify(value); response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }); response.end(body); };
const sendAudio = (response, value) => { response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': value.length, 'Cache-Control': 'private, max-age=31536000' }); response.end(value); };
const allowedOrigin = origin => !origin || /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/iu.test(origin);

async function body(request, limit = 32 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw Object.assign(new Error('payload-too-large'), { status: 413 }); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

async function json(request) {
  const raw = await body(request, 1024 * 1024);
  try { return JSON.parse(raw.toString('utf8') || '{}'); } catch { throw Object.assign(new Error('invalid-json'), { status: 400 }); }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; let error = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; }); child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(`${path.basename(command)}-failed:${code}:${error.trim()}`)));
  });
}

async function runtimeHealth() {
  try { const response = await fetch(`${runtimeUrl}/health`, { signal: AbortSignal.timeout(1200) }); const value = await response.json(); return { reachable: response.ok, ready: value?.ready === true, voice: value?.voice || null }; }
  catch { return { reachable: false, ready: false, voice: null }; }
}

function beginJob(kind, task) {
  const id = crypto.randomUUID(); const state = { id, kind, status: 'running', phase: 'starting', completed: 0, total: null, error: null, result: null }; jobs.set(id, state);
  Promise.resolve().then(() => task(patch => Object.assign(state, patch))).then(result => Object.assign(state, { status: 'complete', phase: 'complete', result })).catch(error => Object.assign(state, { status: 'failed', phase: 'failed', error: String(error?.message || error) }));
  return state;
}

async function commandScript(name) {
  const active = JSON.parse(await fs.readFile(path.join(root, 'active-pack.json'), 'utf8').catch(() => '{}'));
  const candidates = [active.target && path.join(active.target, 'bin', name), path.join(root, 'current', 'bin', name), path.resolve(here, '../../mobile-runtime', name)].filter(Boolean);
  for (const candidate of candidates) if ((await fs.stat(candidate).catch(() => null))?.isFile()) return candidate;
  throw new Error(`script-not-installed:${name}`);
}

async function activeTool(name) {
  const active = JSON.parse(await fs.readFile(path.join(root, 'active-pack.json'), 'utf8').catch(() => '{}'));
  const candidates = [active.target && path.join(active.target, 'tools', name), path.join(root, 'current', 'tools', name), path.resolve(here, '../tools', name)].filter(Boolean);
  for (const candidate of candidates) if ((await fs.stat(candidate).catch(() => null))?.isFile()) return candidate;
  throw new Error(`voice-tool-not-installed:${name}`);
}

async function voicePython() {
  if (process.env.TMRW_VOICE_PYTHON) return process.env.TMRW_VOICE_PYTHON;
  const active = JSON.parse(await fs.readFile(path.join(root, 'active-pack.json'), 'utf8').catch(() => '{}'));
  const candidates = [active.target && path.join(active.target, 'venv', 'bin', 'python'), active.target && path.join(active.target, 'python', 'bin', 'python'), path.join(root, 'current', 'venv', 'bin', 'python'), path.join(path.dirname(root), 'genie-tts-portable', 'venv', 'bin', 'python'), path.join(os.homedir(), 'genie-tts-portable', 'venv', 'bin', 'python')].filter(Boolean);
  for (const candidate of candidates) if ((await fs.stat(candidate).catch(() => null))?.isFile()) return candidate;
  return process.platform === 'win32' ? 'python' : 'python3';
}

async function installedProfiles() {
  const directory = path.join(root, 'profiles'); await fs.mkdir(directory, { recursive: true });
  const rows = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) if (entry.isDirectory()) {
    const meta = JSON.parse(await fs.readFile(path.join(directory, entry.name, 'profile.json'), 'utf8').catch(() => '{}'));
    if (meta.id) rows.push(meta);
  }
  return rows;
}

async function runtimeJson(route, options) {
  const response = await fetch(`${runtimeUrl}${route}`, options);
  const value = await response.json().catch(() => null);
  if (!response.ok || value?.ok !== true) throw new Error(value?.error || `runtime-http-${response.status}`);
  return value;
}

async function previewAudio(profileId, language) {
  const id = safeId(profileId); const lang = language === 'ja' ? 'ja' : 'en';
  if (!id) throw Object.assign(new Error('invalid-preview-profile'), { status: 400 });
  const directory = path.join(root, 'previews'); await fs.mkdir(directory, { recursive: true });
  const cached = path.join(directory, `${id}-${lang}.wav`); const existing = await fs.readFile(cached).catch(() => null);
  if (existing?.length > 44) return existing;
  const health = await runtimeHealth(); if (!health.ready) throw Object.assign(new Error('runtime-not-ready'), { status: 503 });
  const spoken = lang === 'ja' ? 'こんにちは。声のサンプルです。' : 'Hello. This is a preview of my voice.';
  const turn = await runtimeJson('/turn/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_chunks: 1, language: lang === 'ja' ? 'japanese' : 'English', calibration: false, profile_id: id }) });
  await runtimeJson('/turn/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turn_id: turn.turn_id, index: 0, text: spoken, subtitle: spoken }) });
  const audioResponse = await fetch(`${runtimeUrl}/turn/audio?wait=1&turn_id=${encodeURIComponent(turn.turn_id)}&index=0`);
  const audio = Buffer.from(await audioResponse.arrayBuffer());
  if (!audioResponse.ok || audio.length < 44) throw new Error('preview-audio-failed');
  await fs.writeFile(cached, audio); return audio;
}

async function handle(request, response) {
  const origin = request.headers.origin;
  if (!allowedOrigin(origin)) return send(response, 403, { ok: false, error: 'origin-not-allowed' });
  response.setHeader('Access-Control-Allow-Origin', origin || '*'); response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-TMRW-Filename, X-TMRW-Language'); response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204); return response.end(); }
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (request.method === 'GET' && url.pathname === '/v1/health') return send(response, 200, { ok: true, ready: true, service: 'TMRW Voice Manager', version: '1.0.0-alpha.1', runtime: await runtimeHealth() });
  if (request.method === 'GET' && url.pathname === '/v1/catalog') return send(response, 200, JSON.parse(await fs.readFile(catalogPath, 'utf8')));
  if (request.method === 'GET' && url.pathname === '/v1/profiles') return send(response, 200, { profiles: await installedProfiles() });
  if (request.method === 'POST' && url.pathname === '/v1/previews') { const input = await json(request); return sendAudio(response, await previewAudio(input.profileId, input.language)); }
  if (request.method === 'GET' && url.pathname.startsWith('/v1/jobs/')) { const job = jobs.get(url.pathname.slice(9)); return job ? send(response, 200, job) : send(response, 404, { ok: false, error: 'job-not-found' }); }
  if (request.method === 'POST' && url.pathname === '/v1/packs/install') {
    const input = await json(request); const manifestResponse = await fetch(new URL(input.manifestUrl)); if (!manifestResponse.ok) throw new Error(`manifest-download-failed:${manifestResponse.status}`);
    const index = validatePackIndex(await manifestResponse.json()); const job = beginJob('install-pack', update => installPack({ index, packId: safeId(input.packId), root, onProgress: update }));
    return send(response, 202, job);
  }
  if (request.method === 'POST' && ['/v1/runtime/start', '/v1/runtime/stop'].includes(url.pathname)) {
    const action = url.pathname.endsWith('/start') ? 'START-TMRW-VOICE-MOBILE.sh' : 'STOP-TMRW-VOICE-MOBILE.sh'; const script = await commandScript(action);
    const job = beginJob(`runtime-${action.startsWith('START') ? 'start' : 'stop'}`, async update => { update({ phase: 'running-script' }); await run('bash', [script], { env: { ...process.env, TMRW_VOICE_HOME: root } }); return runtimeHealth(); });
    return send(response, 202, job);
  }
  if (request.method === 'POST' && url.pathname === '/v1/transcriptions') {
    const audio = await body(request); if (audio.length < 44) throw Object.assign(new Error('audio-too-small'), { status: 400 });
    const audioId = crypto.randomUUID(); const incoming = path.join(root, 'incoming'); await fs.mkdir(incoming, { recursive: true }); const file = path.join(incoming, `${audioId}.audio`); await fs.writeFile(file, audio);
    const language = ['en', 'ja', 'auto'].includes(request.headers['x-tmrw-language']) ? request.headers['x-tmrw-language'] : 'auto';
    const job = beginJob('transcribe', async update => { update({ phase: 'transcoding' }); const worker = await activeTool('transcribe.py'); const python = await voicePython(); update({ phase: 'transcribing' }); const output = await run(python, [worker, '--audio', file, '--language', language]); return { audioId, ...JSON.parse(output) }; });
    return send(response, 202, job);
  }
  if (request.method === 'POST' && url.pathname === '/v1/voices/clone') {
    const input = await json(request); const characterId = safeId(input.characterId); const audioId = safeId(input.audioId); const transcript = String(input.transcript || '').trim();
    if (!characterId || !audioId || !transcript || transcript.length > 5000) throw Object.assign(new Error('invalid-clone-request'), { status: 400 });
    const normalizedAudio = path.join(root, 'incoming', `${audioId}.wav`); const originalAudio = path.join(root, 'incoming', `${audioId}.audio`); const audio = (await fs.stat(normalizedAudio).catch(() => null))?.isFile() ? normalizedAudio : originalAudio; if (!(await fs.stat(audio).catch(() => null))?.isFile()) throw Object.assign(new Error('audio-not-found'), { status: 404 });
    const profileDir = path.join(root, 'profiles', characterId); await fs.mkdir(profileDir, { recursive: true }); const profile = path.join(profileDir, 'voice.voiceprofile.npz');
    const job = beginJob('clone-voice', async update => {
      const runtimeWasReachable = (await runtimeHealth()).reachable;
      if (runtimeWasReachable) {
        update({ phase: 'pausing-runtime' });
        const stop = await commandScript('STOP-TMRW-VOICE-MOBILE.sh');
        await run('bash', [stop], { env: { ...process.env, TMRW_VOICE_HOME: root } });
      }
      try {
        update({ phase: 'extracting-profile' });
        const worker = await activeTool('extract_voice_profile.py'); const python = await voicePython();
        await run(python, [worker, '--audio', audio, '--transcript', transcript, '--language', input.language === 'ja' ? 'japanese' : 'English', '--output', profile]);
        const meta = { id: characterId, name: String(input.name || characterId).slice(0, 120), kind: 'clone', language: input.language === 'ja' ? 'ja' : 'en', profile, updatedAt: new Date().toISOString() };
        await fs.writeFile(path.join(profileDir, 'profile.json'), `${JSON.stringify(meta, null, 2)}\n`);
        return meta;
      } finally {
        if (runtimeWasReachable) {
          update({ phase: 'restarting-runtime' });
          const start = await commandScript('START-TMRW-VOICE-MOBILE.sh');
          await run('bash', [start], { env: { ...process.env, TMRW_VOICE_HOME: root } });
        }
      }
    });
    return send(response, 202, job);
  }
  return send(response, 404, { ok: false, error: 'not-found' });
}

await fs.mkdir(root, { recursive: true });
const server = http.createServer((request, response) => handle(request, response).catch(error => send(response, error.status || 500, { ok: false, error: String(error?.message || error) })));
server.listen(port, '127.0.0.1', () => console.log(`TMRW Voice Manager ready at http://127.0.0.1:${port}`));
