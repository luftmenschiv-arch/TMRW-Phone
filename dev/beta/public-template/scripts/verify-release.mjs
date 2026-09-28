import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../', import.meta.url));
const release = JSON.parse(await fs.readFile(new URL('../release.json', import.meta.url), 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function walk(dir, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (rel === '.git') continue;
    if (entry.isSymbolicLink()) throw new Error(`Symlink not allowed: ${rel}`);
    if (entry.isDirectory()) files.push(...await walk(dir, rel));
    else files.push(rel);
  }
  return files.sort();
}
const actual = (await walk(directory)).filter(p => p !== 'release.json');
assert.equal(release.schema, 'tmrw-public-beta-v1');
assert.deepEqual(actual, release.files.map(f => f.path).sort(), 'Unexpected or missing public files');
const files = new Set(actual);
const previews = new Set();
let previewCount = 0, importEdges = 0;
for (const file of release.files) {
  assert.ok(!file.path.split('/').some(p => !p || p === '..') && !/[\\:]/u.test(file.path));
  const bytes = await fs.readFile(path.join(directory, file.path));
  assert.equal(bytes.length, file.bytes, file.path);
  assert.equal(hash(bytes), file.sha256, file.path);
  if (file.path.startsWith('voice-packs/previews/')) {
    assert.match(file.path, /\/(?:male|female)-[a-z-]+-(?:en|ja)\.wav$/u);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    previews.add(hash(bytes)); previewCount++;
  }
  if (!/\.(?:mjs|js|css)$/u.test(file.path) || file.path.startsWith('scripts/')) continue;
  const source = bytes.toString('utf8');
  assert.doesNotMatch(source, /(?:AIza[\w-]{30,}|ghp_[\w]{25,}|github_pat_[\w]{25,}|sk-or-v1-[\da-f]{32,})/u, `Possible secret: ${file.path}`);
  assert.doesNotMatch(source, /C:[\\/]ai[\\/]|C:[\\/]Users[\\/]lolit[\\/]|192\.168\.100\.125/u, `Personal path: ${file.path}`);
  assert.doesNotMatch(source, /https:\/\/github\.com\/luftmenschiv-arch\/TMRW-Phone-V3\//u, `Private download: ${file.path}`);
  const specs = [
    ...source.matchAll(/(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/gu),
    ...source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/gu),
    ...source.matchAll(/@import\s+(?:url\()?\s*['"]([^'"]+)['"]/gu),
  ];
  for (const match of specs) {
    assert.ok(match[1].startsWith('.'), `Bare browser import: ${file.path}`);
    assert.ok(files.has(path.posix.normalize(path.posix.join(path.posix.dirname(file.path), match[1]))), `Missing import: ${file.path} -> ${match[1]}`);
    importEdges++;
  }
}
assert.equal(previewCount, 48); assert.equal(previews.size, 48);
const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
assert.equal(manifest.version, release.version);
assert.equal(manifest.auto_update, false);
const clientModule = await import('../v3/platform/voice/tmrw-voice-manager-client.mjs');
const client = new clientModule.TMRWVoiceManagerClient({ fetchImpl: async url => {
  const bytes = await fs.readFile(new URL(url));
  return { ok: true, blob: async () => new Blob([bytes], { type: 'audio/wav' }) };
} });
for (const f of release.files.filter(f => f.path.startsWith('voice-packs/previews/'))) {
  const [, profileId, language] = f.path.match(/\/((?:male|female)-[a-z-]+)-(en|ja)\.wav$/u);
  const audio = await client.preview({ profileId, language });
  assert.equal(hash(Buffer.from(await audio.arrayBuffer())), f.sha256);
}
for (const prefix of ['/scripts/extensions/third-party/', '/scripts/extensions/third-party/user/']) {
  for (const folder of ['TMRW-Phone-V3', 'SillyTavern-Extension-TMRW-Phone', 'Phone%20Beta']) {
    const base = `http://localhost:8000${prefix}${folder}/`;
    assert.equal(clientModule.presetPreviewBaseUrl(`${base}v3/platform/voice/tmrw-voice-manager-client.mjs`), `${base}voice-packs/previews/`);
  }
}
assert.equal((await import('../v3/platform/voice/runtime-pack-release.mjs')).PUBLIC_RUNTIME_PACK_INDEX_URL, null);
const entry = await import('../index.js');
const state = entry.getProductionEntryStatus();
assert.equal(state.passive, true);
assert.equal(state.canonicalWrites, 0);
assert.equal(state.phoneRootMounted, false);
assert.equal(state.databaseOpen, false);
for (const name of ['onActivate', 'onEnable', 'onDisable']) assert.equal(typeof entry[name], 'function');
console.log(JSON.stringify({ version: release.version, files: actual.length, previews: previewCount, importEdges, passiveImport: true, checksums: 'PASS', previewPlaybackFetch: '48/48 PASS' }, null, 2));
