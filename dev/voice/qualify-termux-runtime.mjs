import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const output = process.argv[2];
if (!output) throw new Error('Pass a new QA output directory');
await fs.mkdir(output, { recursive: false });
const runtime = 'http://127.0.0.1:28779', manager = 'http://127.0.0.1:28778';
async function json(url, body) {
  const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) } : { signal: AbortSignal.timeout(180000) });
  const result = await response.json(); if (!response.ok) throw new Error(JSON.stringify(result)); return result;
}
async function job(id) {
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const value = await json(`${manager}/v1/jobs/${id}`);
    if (value.status === 'failed') throw new Error(value.error);
    if (value.status === 'complete') return value.result;
    await new Promise(r => setTimeout(r, 750));
  }
  throw new Error('job-timeout');
}
const rows = [];
for (const [profile, language, text] of [
  ['male-low-calm', 'English', 'Hello, it is nice to speak with you today.'],
  ['female-warm-mature', 'japanese', 'こんにちは、今日はどんなお話をしましょうか。'],
]) {
  const start = Date.now();
  const turn = await json(`${runtime}/turn/start`, { expected_chunks: 1, language, profile_id: profile, calibration: false });
  await json(`${runtime}/turn/push`, { turn_id: turn.turn_id, index: 0, text, subtitle: text });
  const response = await fetch(`${runtime}/turn/audio?wait=1&turn_id=${encodeURIComponent(turn.turn_id)}&index=0`, { signal: AbortSignal.timeout(180000) });
  const audio = Buffer.from(await response.arrayBuffer());
  assert.equal(response.ok, true, audio.toString('utf8', 0, 200));
  assert.equal(audio.toString('ascii', 0, 4), 'RIFF'); assert.ok(audio.length > 32000);
  const lang = language === 'japanese' ? 'ja' : 'en';
  await fs.writeFile(path.join(output, `${profile}-${lang}.wav`), audio);
  console.log(`Synthesized ${profile} ${lang}: ${audio.length} bytes in ${Date.now() - start} ms`);
  const upload = await fetch(`${manager}/v1/transcriptions`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-TMRW-Language': lang }, body: audio, signal: AbortSignal.timeout(180000) });
  assert.equal(upload.status, 202);
  const transcription = await job((await upload.json()).id);
  assert.ok(transcription.text.trim().length > 5);
  console.log(`ASR ${lang}: ${transcription.text}`);
  // Explicit QA-only identities, never a player's character/profile.
  const clone = await json(`${manager}/v1/voices/clone`, { characterId: `tmrw-install-qa-${lang}`, name: `Installer QA ${lang}`, audioId: transcription.audioId, transcript: transcription.text, language: lang });
  const saved = await job(clone.id);
  assert.equal(saved.id, `tmrw-install-qa-${lang}`);
  assert.equal((await json(`${runtime}/health`)).ready, true);
  rows.push({ profile, language: lang, wavBytes: audio.length, transcription: transcription.text, cloned: saved.id, runtimeRestarted: true });
  console.log(`Clone ${lang} and runtime restart PASS`);
}
await fs.writeFile(path.join(output, 'qualification.json'), JSON.stringify({ date: new Date().toISOString(), isolatedPorts: [18778,18779], results: rows }, null, 2));
console.log('ANDROID ISOLATED SYNTHESIS / ASR / CLONING PASS');
