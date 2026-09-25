import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const catalog = JSON.parse(await readFile(path.join(root, 'voice-packs/catalog/presets.v1.json'), 'utf8'));
const output = path.join(root, 'voice-packs/previews');
const manager = process.env.TMRW_VOICE_MANAGER_URL || 'http://127.0.0.1:18768';
await mkdir(output, { recursive: true });

for (const preset of catalog.presets) {
  for (const language of catalog.languages) {
    const destination = path.join(output, `${preset.id}-${language}.wav`);
    if ((await stat(destination).catch(() => null))?.size > 44) {
      process.stdout.write(`cached ${preset.id}-${language}\n`);
      continue;
    }
    const response = await fetch(`${manager}/v1/previews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: preset.id, language }),
    });
    if (!response.ok) throw new Error(`${preset.id}-${language}: ${response.status} ${await response.text()}`);
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error(`${preset.id}-${language}: invalid WAV response`);
    }
    await writeFile(destination, audio);
    process.stdout.write(`saved ${preset.id}-${language} (${audio.length} bytes)\n`);
  }
}
