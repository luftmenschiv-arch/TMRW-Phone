import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
const root = process.argv[2];
const version = process.argv[3] || '1.0.0-beta.1-candidate';
if (!/^1\.0\.0-beta\.1(?:-candidate)?$/u.test(version)) throw new Error('unreviewed-version');
if (!root || path.dirname(root) !== '/data/data/com.termux/files/home' || !/^\.tmrw-distribution-stage-[a-z0-9-]+$/u.test(path.basename(root))) throw new Error('unapproved-stage');
const files = [];
async function walk(dir, prefix = '') {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name, file = path.join(dir, e.name);
    if (rel === 'payload.json') continue;
    if (e.isSymbolicLink() || (!e.isFile() && !e.isDirectory())) throw new Error(`unsafe-file:${rel}`);
    if (e.isDirectory()) { await walk(file, rel); continue; }
    if (/(?:^|\/)(?:__pycache__|\.git|logs|incoming|sessions|recordings)(?:\/|$)/u.test(rel) || /\.(?:pyc|log)$/u.test(rel)) throw new Error(`runtime-generated-file:${rel}`);
    const hash = crypto.createHash('sha256'); for await (const block of createReadStream(file)) hash.update(block);
    files.push({ path: rel, bytes: (await fs.stat(file)).size, sha256: hash.digest('hex') });
  }
}
await walk(root); files.sort((a, b) => a.path.localeCompare(b.path));
const model = files.find(f => f.path === 'model/t2s_shared_fp16.bin');
if (model?.sha256 !== '52350b81f9a3fbaa0f707c6c45af85f0edec6ec64231440ea75f9b049bffdabd') throw new Error('baseline-model-changed');
const profiles = files.filter(f => /^profiles\/(?:male|female)-/u.test(f.path));
if (profiles.length !== 24 || new Set(profiles.map(f => f.sha256)).size !== 24) throw new Error('preset-identity-collapsed');
if (!version.endsWith('-candidate')) {
  for (const rel of ['NOTICE.md', 'sources/python-soxr-0.4.0/COPYING.LGPL', 'sources/python-soxr-0.4.0/setup.py', 'notices/upstream/upstream-notices.json', 'notices/packaging-changes.json']) if (!files.some(f => f.path === rel)) throw new Error(`missing-distribution-input:${rel}`);
  if (files.some(f => /lib(?:readline|gdbm)/u.test(f.path))) throw new Error('unused-gpl-native-library-in-package');
}
const manifest = { schema: 'tmrw-runtime-payload-v1', version, platform: 'android-arm64', python: '3.13.12', sourceRuntimeSha256: '1300db3c5ca48945bfdcbf80a72f732e862e82d82122d9d2929bf9192a2aa77b', qualification: 'isolated-real-device-en-ja-synthesis-asr-clone', distribution: version.endsWith('-candidate') ? 'candidate-only' : 'public-beta-with-third-party-notices-and-soxr-source', files };
await fs.writeFile(path.join(root, 'payload.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ files: files.length, unpackedBytes: files.reduce((n, f) => n + f.bytes, 0), profiles: profiles.length }));
