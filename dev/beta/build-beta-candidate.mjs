import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProductionPackage } from '../production-package/build-production-package.mjs';
import { verifyProductionPackage } from '../production-package/verify-production-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map(value => value.split(/=(.*)/s).slice(0, 2)));
const version = args['--version'] || '0.1.0-beta.1';
const output = args['--output'] && path.resolve(args['--output']);
if (!output || !/^\d+\.\d+\.\d+-beta\.\d+$/u.test(version)) {
  throw new Error('Usage: node dev/beta/build-beta-candidate.mjs --output=<new directory> [--version=0.1.0-beta.1]');
}
if (output === root || root.startsWith(`${output}${path.sep}`) || output.startsWith(`${root}${path.sep}`)) {
  throw new Error('Beta output must be a new directory outside the source repository');
}
if (await fs.stat(output).catch(() => null)) throw new Error(`Output already exists: ${output}`);

const copy = async (source, destination) => {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(path.join(root, source), destination, { recursive: true });
};
const fileHash = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
async function listFiles(directory, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(directory, relative));
    else if (entry.isFile()) result.push(relative.split(path.sep).join('/'));
    else throw new Error(`Unsupported beta payload entry: ${relative}`);
  }
  return result.sort();
}

await fs.mkdir(output, { recursive: true });
const extensionRoot = path.join(output, 'extension', 'TMRW-Phone-V3');
await buildProductionPackage({ outputRoot: extensionRoot, version });
const extensionAudit = await verifyProductionPackage({ outputRoot: extensionRoot });

const appRoot = path.join(output, 'app');
for (const source of [
  'voice-manager/package.json',
  'voice-manager/src',
  'voice-manager/tools',
  'mobile-runtime',
  'voice-packs/catalog',
  'voice-packs/profiles',
  'dev/voice/patch-mobile-runtime.mjs',
]) await copy(source, path.join(appRoot, source));

const catalog = JSON.parse(await fs.readFile(path.join(appRoot, 'voice-packs/catalog/presets.v1.json'), 'utf8'));
if (catalog.presets?.length !== 24 || catalog.languages?.join(',') !== 'en,ja') throw new Error('Beta requires 24 presets and en/ja languages');
const voiceIds = new Set(catalog.presets.map(row => row.id));
if (voiceIds.size !== 24) throw new Error('Duplicate preset IDs');
const identityHashes = new Set();
const previewHashes = new Set();
const previewText = {
  en: 'Hello, it is nice to speak with you today.',
  ja: 'こんにちは、今日はどんなお話をしましょうか。',
};
for (const id of voiceIds) {
  const preset = catalog.presets.find(row => row.id === id);
  for (const language of catalog.languages) if (preset.preview?.[language] !== previewText[language]) throw new Error(`Preview text mismatch: ${id}-${language}`);
  const profile = path.join(appRoot, 'voice-packs/profiles', `${id}.voiceprofile.npz`);
  const profileStat = await fs.stat(profile).catch(() => null);
  if (!profileStat?.isFile() || profileStat.size < 1000) throw new Error(`Missing preset identity: ${id}`);
  identityHashes.add(await fileHash(profile));
  for (const language of catalog.languages) {
    const audio = path.join(extensionRoot, 'voice-packs/previews', `${id}-${language}.wav`);
    if (!(await fs.stat(audio).catch(() => null))?.isFile()) throw new Error(`Missing preview: ${id}-${language}`);
    previewHashes.add(await fileHash(audio));
  }
}
if (identityHashes.size !== 24) throw new Error('Two or more presets use the same identity file');
if (previewHashes.size !== 48) throw new Error('Two or more preset previews are the same audio file');

const files = [];
for (const relative of await listFiles(output)) {
  const absolute = path.join(output, ...relative.split('/'));
  files.push({ path: relative, bytes: (await fs.stat(absolute)).size, sha256: await fileHash(absolute) });
}
const manifest = {
  schema: 'tmrw-beta-candidate-v1',
  version,
  status: 'local-candidate-not-public-release',
  components: {
    extension: { path: 'extension/TMRW-Phone-V3', version, previews: extensionAudit.voicePreviewFiles },
    voiceManager: { path: 'app/voice-manager', version: JSON.parse(await fs.readFile(path.join(appRoot, 'voice-manager/package.json'), 'utf8')).version },
    presetCatalog: { path: 'app/voice-packs/catalog/presets.v1.json', version: catalog.version, identities: identityHashes.size },
  },
  prerequisitesNotBundled: ['Termux packages', 'local voice model/runtime dependencies', 'ST installation'],
  files,
};
await fs.writeFile(path.join(output, 'beta-candidate.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output, version, files: files.length, previews: extensionAudit.voicePreviewFiles, identities: identityHashes.size, status: manifest.status }, null, 2));
