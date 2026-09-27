// Binary-safe streaming capture. Never read the model archive into one Buffer.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { sha256, run } from '../../installers/android/download.mjs';
const [transport, stage, outputArg] = process.argv.slice(2), output = path.resolve(outputArg || '');
if (!/^\d+$/u.test(transport || '') || !/^\/data\/data\/com\.termux\/files\/home\/\.tmrw-distribution-stage-[a-z0-9-]+$/u.test(stage || '') || !outputArg) throw new Error('Pass transport stage new-output-directory');
if (await fs.stat(output).catch(() => null)) throw new Error('output-already-exists');
await fs.mkdir(output, { recursive: true });
const archive = path.join(output, 'tmrw-runtime-candidate.tar.gz');
const manifestText = await run('adb', ['-t', transport, 'shell', '-T', 'run-as', 'com.termux', '/data/data/com.termux/files/usr/bin/cat', `${stage}/payload.json`]);
const payload = JSON.parse(manifestText);
const remote = `${stage}-${crypto.randomUUID()}.tar.gz`;
await run('adb', ['-t', transport, 'shell', '-T', 'run-as', 'com.termux', '/data/data/com.termux/files/usr/bin/tar', '-czf', remote, '-C', path.dirname(stage), `--transform=s,^${path.basename(stage)},android-arm64,`, path.basename(stage)]);
const remoteHash = (await run('adb', ['-t', transport, 'shell', '-T', 'run-as', 'com.termux', '/data/data/com.termux/files/usr/bin/sha256sum', remote])).trim().split(/\s/u)[0];
const args = ['-t', transport, 'exec-out', 'run-as', 'com.termux', '/data/data/com.termux/files/usr/bin/cat', remote];
const child = spawn('adb', args, { stdio: ['ignore', 'pipe', 'pipe'] }); let errors = '';
child.stderr.on('data', b => { errors += b; });
const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', c => c === 0 ? resolve() : reject(new Error(errors || `adb-exit:${c}`))); });
await Promise.all([pipeline(child.stdout, createWriteStream(archive, { flags: 'wx' })), done]);
const size = (await fs.stat(archive)).size; console.log(`Captured ${size} bytes; splitting verified parts`);
if (!/^[a-f0-9]{64}$/u.test(remoteHash) || await sha256(archive) !== remoteHash) throw new Error('adb-capture-hash-mismatch');
const header = await fs.open(archive, 'r');
try { const b = Buffer.alloc(2); await header.read(b, 0, 2, 0); if (b[0] !== 0x1f || b[1] !== 0x8b || size < 100000000) throw new Error('invalid-captured-gzip'); } finally { await header.close(); }
const partSize = 16 * 1024 ** 2, parts = [];
for (let offset = 0, index = 0; offset < size; offset += partSize, index++) {
  const bytes = Math.min(partSize, size - offset), name = `runtime.part-${String(index).padStart(5, '0')}`;
  const target = path.join(output, name);
  await pipeline(createReadStream(archive, { start: offset, end: offset + bytes - 1 }), createWriteStream(target, { flags: 'wx' }));
  parts.push({ index, url: name, size: bytes, sha256: await sha256(target) });
}
// Local qualification manifest. Publishing requires setting a reviewed HTTPS
// base URL and reviewing third-party notices; never upload this localhost URL.
const index = { schema: 'tmrw-termux-install-v1', baseUrl: 'http://127.0.0.1:28780/', extension: { repository: 'https://github.com/luftmenschiv-arch/SillyTavern-Extension-TMRW-Phone.git', commit: '8ad9fb3cb528b8523fc6163e238ea51eca180f76' }, packs: [{ id: 'tmrw-local-voice-android-arm64', version: payload.version, rootDirectory: 'android-arm64', size, unpackedBytes: payload.files.reduce((n, f) => n + f.bytes, Buffer.byteLength(manifestText)), sha256: await sha256(archive), parts }] };
await fs.writeFile(path.join(output, 'install-index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(JSON.stringify({ output, size, parts: parts.length, indexSha256: await sha256(path.join(output, 'install-index.json')) }));
