import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.resolve(process.argv[2] || '');
if (!process.argv[2] || await fs.stat(output).catch(() => null)) throw new Error('Pass a new output directory');
await fs.mkdir(output, { recursive: true });
const stage = path.join(output, 'overlay');
await fs.cp(path.join(source, 'installers/android/runtime'), stage, { recursive: true });
await fs.cp(path.join(source, 'voice-manager'), path.join(stage, 'voice-manager'), { recursive: true });
await fs.cp(path.join(source, 'voice-manager/tools'), path.join(stage, 'tools'), { recursive: true });
await fs.copyFile(path.join(source, 'voice-manager/tools/android_sitecustomize/sitecustomize.py'), path.join(stage, 'tools/sitecustomize.py'));
await fs.cp(path.join(source, 'voice-packs/catalog'), path.join(stage, 'catalog'), { recursive: true });
for (const file of await fs.readdir(path.join(source, 'voice-packs/profiles'))) {
  if (!/^(?:(?:male|female)-[a-z-]+|tmrw-(?:male|female)-core)\.voiceprofile\.npz$/u.test(file)) continue;
  const destination = path.join(stage, 'profiles', file.replace('.voiceprofile.npz', ''));
  await fs.mkdir(destination, { recursive: true });
  await fs.copyFile(path.join(source, 'voice-packs/profiles', file), path.join(destination, 'voice.voiceprofile.npz'));
}
async function normalize(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) await normalize(file);
    else if (!file.endsWith('.npz')) await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace(/\r\n/gu, '\n'));
  }
}
await normalize(stage);
execFileSync('tar', ['-cf', path.join(output, 'overlay.tar'), '-C', stage, '.']);
console.log(path.join(output, 'overlay.tar'));
