import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const catalog = JSON.parse(await readFile(path.join(root, 'voice-packs/catalog/presets.v1.json'), 'utf8'));
const output = path.resolve(process.env.TMRW_VOICE_PREVIEW_OUTPUT || path.join(root, 'voice-packs/previews'));
const manager = process.env.TMRW_VOICE_MANAGER_URL || 'http://127.0.0.1:18768';
const runtime = process.env.TMRW_VOICE_RUNTIME_URL || null;
const refresh = process.argv.includes('--refresh');
const spokenByLanguage = Object.freeze({
  en: 'Hello, it is nice to speak with you today.',
  ja: 'こんにちは、今日はどんなお話をしましょうか。',
});
await mkdir(output, { recursive: true });

async function runtimePreview(profileId, language) {
  const spoken = spokenByLanguage[language];
  const startResponse = await fetch(`${runtime}/turn/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_chunks: 1, language: language === 'ja' ? 'japanese' : 'English', calibration: false, profile_id: profileId }) });
  const start = await startResponse.json();
  if (!startResponse.ok || start?.ok !== true || start?.profile_id !== profileId) throw new Error(`${profileId}-${language}: wrong runtime profile`);
  const pushResponse = await fetch(`${runtime}/turn/push`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turn_id: start.turn_id, index: 0, text: spoken, subtitle: spoken }) });
  const push = await pushResponse.json();
  if (!pushResponse.ok || push?.ok !== true) throw new Error(`${profileId}-${language}: runtime push failed`);
  const audioResponse = await fetch(`${runtime}/turn/audio?wait=1&turn_id=${encodeURIComponent(start.turn_id)}&index=0`);
  if (!audioResponse.ok) throw new Error(`${profileId}-${language}: runtime audio failed ${audioResponse.status}`);
  return Buffer.from(await audioResponse.arrayBuffer());
}

for (const preset of catalog.presets) {
  for (const language of catalog.languages) {
    const destination = path.join(output, `${preset.id}-${language}.wav`);
    if (!refresh && (await stat(destination).catch(() => null))?.size > 44) {
      process.stdout.write(`cached ${preset.id}-${language}\n`);
      continue;
    }
    let audio;
    if (runtime) audio = await runtimePreview(preset.id, language);
    else {
      const response = await fetch(`${manager}/v1/previews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: preset.id, language }),
      });
      if (!response.ok) throw new Error(`${preset.id}-${language}: ${response.status} ${await response.text()}`);
      audio = Buffer.from(await response.arrayBuffer());
    }
    if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error(`${preset.id}-${language}: invalid WAV response`);
    }
    await writeFile(destination, audio);
    process.stdout.write(`saved ${preset.id}-${language} (${audio.length} bytes)\n`);
  }
}
