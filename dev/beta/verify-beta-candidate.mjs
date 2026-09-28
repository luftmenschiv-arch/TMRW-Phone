import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyProductionPackage } from '../production-package/verify-production-package.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(value => value.split(/=(.*)/s).slice(0, 2)));
const candidate = args['--candidate'] && path.resolve(args['--candidate']);
if (!candidate) throw new Error('Usage: node dev/beta/verify-beta-candidate.mjs --candidate=<directory>');
const manifest = JSON.parse(await fs.readFile(path.join(candidate, 'beta-candidate.json'), 'utf8'));
if (manifest.schema !== 'tmrw-beta-candidate-v1' || !Array.isArray(manifest.files)) throw new Error('Invalid beta manifest');

const expected = new Map();
for (const file of manifest.files) {
  if (!/^[a-f0-9]{64}$/u.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 1) throw new Error(`Invalid file metadata: ${file.path}`);
  const relative = file.path.split('/');
  if (relative.some(part => !part || part === '..' || part === '.') || /[\\:]/u.test(file.path) || path.isAbsolute(file.path) || expected.has(file.path)) throw new Error(`Unsafe or duplicate file path: ${file.path}`);
  expected.set(file.path, file);
}
async function walk(directory, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await walk(directory, relative));
    else if (entry.isFile()) result.push(relative.split(path.sep).join('/'));
    else throw new Error(`Unsupported file entry: ${relative}`);
  }
  return result;
}
const actual = (await walk(candidate)).filter(file => file !== 'beta-candidate.json');
if (actual.length !== expected.size) throw new Error(`File count mismatch: ${actual.length} != ${expected.size}`);
for (const relative of actual) {
  const item = expected.get(relative);
  if (!item) throw new Error(`Unexpected file: ${relative}`);
  const content = await fs.readFile(path.join(candidate, ...relative.split('/')));
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  if (content.length !== item.bytes || hash !== item.sha256) throw new Error(`File checksum mismatch: ${relative}`);
}
const extension = await verifyProductionPackage({ outputRoot: path.join(candidate, manifest.components.extension.path) });
if (extension.voicePreviewFiles !== 48) throw new Error('Incomplete preview set');
const catalog = JSON.parse(await fs.readFile(path.join(candidate, manifest.components.presetCatalog.path), 'utf8'));
const identities = new Set();
const previews = new Set();
const previewText = { en: 'Hello, it is nice to speak with you today.', ja: 'こんにちは、今日はどんなお話をしましょうか。' };
for (const preset of catalog.presets) {
  const relative = `app/voice-packs/profiles/${preset.id}.voiceprofile.npz`;
  if (!expected.has(relative)) throw new Error(`Missing preset identity: ${preset.id}`);
  identities.add(expected.get(relative).sha256);
  for (const language of ['en', 'ja']) {
    if (preset.preview?.[language] !== previewText[language]) throw new Error(`Preview text mismatch: ${preset.id}-${language}`);
    const audio = `extension/TMRW-Phone-V3/voice-packs/previews/${preset.id}-${language}.wav`;
    if (!expected.has(audio)) throw new Error(`Missing preset preview: ${preset.id}-${language}`);
    previews.add(expected.get(audio).sha256);
  }
}
if (catalog.presets.length !== 24 || identities.size !== 24 || previews.size !== 48) throw new Error('Preset asset count mismatch');
console.log(JSON.stringify({ candidate, version: manifest.version, files: actual.length, previews: extension.voicePreviewFiles, identities: identities.size, integrity: 'PASS' }, null, 2));
