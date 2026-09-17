import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { TMRW_VOICE_PRESETS, findVoicePreset } from '../../domain/voice/voice-preset-catalog.mjs';
import { TMRWVoiceManagerClient } from '../../platform/voice/tmrw-voice-manager-client.mjs';
import { installPack, validatePackIndex } from '../../voice-manager/src/pack-installer.mjs';

test('voice catalog exposes exactly 12 male and 12 female presets with stable ids', () => {
  assert.equal(TMRW_VOICE_PRESETS.length, 24);
  assert.equal(TMRW_VOICE_PRESETS.filter(row => row.family === 'male').length, 12);
  assert.equal(TMRW_VOICE_PRESETS.filter(row => row.family === 'female').length, 12);
  assert.equal(new Set(TMRW_VOICE_PRESETS.map(row => row.id)).size, 24);
  assert.equal(findVoicePreset('male-clever-charmer').name, 'Clever Charmer');
  assert.equal(findVoicePreset('female-gentle-soft').baseProfile, 'tmrw-female-core');
});

test('release pack index rejects noncontiguous and mismatched parts', () => {
  const hash = 'a'.repeat(64);
  const valid = { schema: 'tmrw-voice-pack-index-v1', baseUrl: 'https://example.test/release/', packs: [{ id: 'android-arm64', size: 3, sha256: hash, parts: [{ index: 0, url: 'p0', size: 3, sha256: hash }] }] };
  assert.equal(validatePackIndex(valid), valid);
  assert.throws(() => validatePackIndex({ ...valid, packs: [{ ...valid.packs[0], size: 4 }] }), /pack-size-mismatch/);
  assert.throws(() => validatePackIndex({ ...valid, packs: [{ ...valid.packs[0], parts: [{ ...valid.packs[0].parts[0], index: 2 }] }] }), /invalid-pack-part/);
});

test('verified pack install activates the extracted pack and bundled core profiles', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'tmrw-pack-test-'));
  try {
    const payload = path.join(temporary, 'payload', 'android-pack');
    await fs.mkdir(path.join(payload, 'profiles', 'tmrw-male-core'), { recursive: true });
    await fs.writeFile(path.join(payload, 'profiles', 'tmrw-male-core', 'voice.voiceprofile.npz'), 'profile');
    const archive = path.join(temporary, 'android-pack.tar.gz');
    const tar = spawnSync('tar', ['-czf', archive, '-C', path.dirname(payload), path.basename(payload)], { encoding: 'utf8' });
    assert.equal(tar.status, 0, tar.stderr);
    const bytes = await fs.readFile(archive); const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const part = path.join(temporary, 'android-pack.part-00000'); await fs.writeFile(part, bytes);
    const index = { schema: 'tmrw-voice-pack-index-v1', baseUrl: pathToFileURL(`${temporary}${path.sep}`).href, packs: [{ id: 'android-pack', version: '1.0.0', rootDirectory: 'android-pack', size: bytes.length, sha256, parts: [{ index: 0, url: path.basename(part), size: bytes.length, sha256 }] }] };
    const root = path.join(temporary, 'home'); const result = await installPack({ index, packId: 'android-pack', root });
    const active = JSON.parse(await fs.readFile(path.join(root, 'active-pack.json'), 'utf8'));
    assert.equal(active.target, result.target);
    assert.equal(await fs.readFile(path.join(root, 'profiles', 'tmrw-male-core', 'voice.voiceprofile.npz'), 'utf8'), 'profile');
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test('manager client submits raw media, waits, and saves a clone', async () => {
  const calls = []; let polls = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/v1/transcriptions')) return { ok: true, json: async () => ({ id: 'job-transcribe' }) };
    if (String(url).endsWith('/v1/jobs/job-transcribe')) return { ok: true, json: async () => (++polls < 2 ? { status: 'running' } : { status: 'complete', result: { audioId: 'audio-1', text: 'hello' } }) };
    if (String(url).endsWith('/v1/voices/clone')) return { ok: true, json: async () => ({ id: 'job-clone' }) };
    if (String(url).endsWith('/v1/jobs/job-clone')) return { ok: true, json: async () => ({ status: 'complete', result: { id: 'character-1' } }) };
    throw new Error('unexpected request');
  };
  const client = new TMRWVoiceManagerClient({ fetchImpl });
  const file = new Blob(['audio'], { type: 'audio/wav' });
  const transcription = await client.transcribe(file, { intervalMs: 0 });
  assert.equal(transcription.text, 'hello');
  const clone = await client.clone({ characterId: 'character-1', name: 'Character', audioId: transcription.audioId, transcript: transcription.text, intervalMs: 0 });
  assert.equal(clone.id, 'character-1');
  assert.equal(calls[0].options.headers['X-TMRW-Language'], 'auto');
});

test('full catalog artifact contains 18 bounded axes per preset', async () => {
  const catalog = JSON.parse(await fs.readFile(path.resolve('voice-packs/catalog/presets.v1.json'), 'utf8'));
  assert.equal(catalog.presets.length, 24);
  for (const preset of catalog.presets) {
    assert.equal(Object.keys(preset.parameters).length, 18, preset.id);
    for (const axis of Object.values(preset.parameters)) assert.ok(axis.min <= axis.value && axis.value <= axis.max, preset.id);
  }
});
