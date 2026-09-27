import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ID = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
const HASH = /^[a-f0-9]{64}$/u;
export const sha256 = async file => {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
export function checkedPack(index, id) {
  if (index?.schema !== 'tmrw-termux-install-v1' || !Array.isArray(index.packs)) throw new Error('invalid-install-index');
  const ids = new Set();
  for (const p of index.packs) {
    if (!ID.test(p.id || '') || !ID.test(p.version || '') || !ID.test(p.rootDirectory || '') || ids.has(p.id)) throw new Error('invalid-pack-identity');
    ids.add(p.id);
    if (!HASH.test(p.sha256 || '') || !Number.isSafeInteger(p.size) || p.size < 1 || !Number.isSafeInteger(p.unpackedBytes) || p.unpackedBytes < 1 || !Array.isArray(p.parts) || !p.parts.length) throw new Error('invalid-pack-size');
    let total = 0;
    for (const [i, part] of p.parts.entries()) {
      if (part.index !== i || !HASH.test(part.sha256 || '') || !Number.isSafeInteger(part.size) || part.size < 1 || part.size > 32 * 1024 ** 2) throw new Error('invalid-pack-part');
      const url = new URL(part.url, index.baseUrl);
      if (!['https:', 'http:', 'file:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid-download-url');
      // HTTP is only for local tests. Public downloads must use HTTPS.
      if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('insecure-download-url');
      total += part.size;
    }
    if (!Number.isSafeInteger(total) || total !== p.size) throw new Error('part-size-mismatch');
  }
  const selected = index.packs.find(p => p.id === id);
  if (!selected) throw new Error('pack-not-found');
  return selected;
}
export async function ensureSpace(directory, bytes, statfs = fs.statfs) {
  const disk = await statfs(directory);
  const free = Number(disk.bavail) * Number(disk.bsize);
  if (free < bytes) throw new Error(`not-enough-space: need ${Math.ceil(bytes / 1024 ** 2)} MiB, available ${Math.floor(free / 1024 ** 2)} MiB`);
}
export async function acquireLock(lockPath) {
  let lock;
  try { lock = await fs.open(lockPath, 'wx'); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const stat = await fs.lstat(lockPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe-install-lock');
    const old = await fs.readFile(lockPath, 'utf8');
    let pid; try { pid = JSON.parse(old).pid; } catch {}
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error(`install-locked:${lockPath}`);
    let alive = true; try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    if (alive || await fs.readFile(lockPath, 'utf8') !== old) throw new Error(`install-locked:${lockPath}`);
    await fs.unlink(lockPath);
    lock = await fs.open(lockPath, 'wx');
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  return async () => { await lock.close(); await fs.unlink(lockPath); };
}
async function regularDirectory(dir) {
  await fs.mkdir(dir, { recursive: true });
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`unsafe-directory:${dir}`);
}
async function matches(file, part) {
  const stat = await fs.lstat(file).catch(() => null);
  return stat?.isFile() && !stat.isSymbolicLink() && stat.size === part.size && await sha256(file) === part.sha256;
}
export async function downloadPack({ index, id, cache, onProgress = () => {}, fetchImpl = fetch, attempts = 3, signal, spaceCheck = ensureSpace }) {
  const pack = checkedPack(index, id);
  await regularDirectory(cache);
  const dir = path.join(cache, pack.sha256); await regularDirectory(dir);
  await spaceCheck(dir, pack.size * 2 + pack.unpackedBytes + 256 * 1024 ** 2);
  const lockPath = path.join(dir, 'download.lock');
  let lock;
  try { lock = await fs.open(lockPath, 'wx'); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const stat = await fs.lstat(lockPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe-download-lock');
    const old = await fs.readFile(lockPath, 'utf8');
    let pid; try { pid = JSON.parse(old).pid; } catch {}
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error(`download-locked:${lockPath}`);
    let alive = true; try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    if (alive || await fs.readFile(lockPath, 'utf8') !== old) throw new Error(`download-locked:${lockPath}`);
    await fs.unlink(lockPath); // Only an unchanged lock belonging to a dead process.
    lock = await fs.open(lockPath, 'wx');
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  const archive = path.join(dir, 'pack.tar.gz');
  const partialArchive = path.join(dir, `archive-${crypto.randomUUID()}.partial`);
  try {
    if (await matches(archive, pack)) return { pack, archive, reused: true };
    const paths = []; let completed = 0;
    for (const part of pack.parts) {
      signal?.throwIfAborted();
      const dest = path.join(dir, `${String(part.index).padStart(5, '0')}-${part.sha256}.part`);
      let reused = await matches(dest, part);
      if (!reused) {
        let error;
        for (let attempt = 0; attempt < attempts; attempt++) {
          signal?.throwIfAborted();
          const temporary = `${dest}.${crypto.randomUUID()}.partial`;
          try {
            const url = new URL(part.url, index.baseUrl);
            const response = url.protocol === 'file:' ? null : await fetchImpl(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000), redirect: 'follow' });
            if (response && (!response.ok || !response.body)) throw new Error(`download-http-${response.status}`);
            const stream = response ? response.body : createReadStream(fileURLToPath(url));
            const handle = await fs.open(temporary, 'wx'); let bytes = 0;
            try { for await (const chunk of stream) {
              signal?.throwIfAborted(); bytes += chunk.length;
              if (bytes > part.size) throw new Error('part-too-large');
              let offset = 0; while (offset < chunk.length) offset += (await handle.write(chunk, offset)).bytesWritten;
            } } finally { await handle.close(); }
            if (!await matches(temporary, part)) throw new Error(`part-checksum-failed:${part.index}`);
            // A corrupted cached file is replaced, never used or appended to.
            if (await fs.lstat(dest).catch(() => null)) await fs.unlink(dest);
            await fs.rename(temporary, dest); error = null; break;
          } catch (e) { error = e; if (signal?.aborted) throw e; }
          finally { await fs.unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
        }
        if (error) throw error;
      }
      paths.push(dest); completed += part.size;
      onProgress({ phase: 'download', completed, total: pack.size, reused, part: part.index });
    }
    const out = await fs.open(partialArchive, 'wx');
    try { for (const file of paths) for await (const chunk of createReadStream(file)) {
      signal?.throwIfAborted(); let offset = 0; while (offset < chunk.length) offset += (await out.write(chunk, offset)).bytesWritten;
    } } finally { await out.close(); }
    if (!await matches(partialArchive, pack)) throw new Error('archive-checksum-failed');
    if (await fs.lstat(archive).catch(() => null)) await fs.unlink(archive);
    await fs.rename(partialArchive, archive);
    return { pack, archive, reused: false };
  } finally {
    await fs.unlink(partialArchive).catch(e => { if (e.code !== 'ENOENT') throw e; });
    await lock.close(); await fs.unlink(lockPath);
  }
}
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '', error = '';
    child.stdout?.on('data', b => { output += b; }); child.stderr?.on('data', b => { error += b; });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(`${command} failed (${code}): ${error.slice(-4000)}`)));
  });
}
export function validateTarListing(names, verbose, rootDirectory) {
  if (!ID.test(rootDirectory)) throw new Error('unsafe-archive-root');
  const listed = names.trim().split(/\r?\n/u);
  if (!listed.length) throw new Error('empty-archive');
  for (const item of listed) {
    const name = item.replace(/\/$/u, '');
    if (!name || /[\\:\x00-\x1f]/u.test(name) || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..') || (name !== rootDirectory && !name.startsWith(`${rootDirectory}/`))) throw new Error('unsafe-archive-path');
  }
  for (const line of verbose.trim().split(/\r?\n/u)) if (!/^[-d]/u.test(line)) throw new Error('archive-links-or-special-files-not-allowed');
}
export async function extractPack({ archive, pack, directory }) {
  if (await fs.lstat(directory).catch(() => null)) throw new Error('extract-destination-exists');
  const names = await run('tar', ['-tzf', archive]);
  const verbose = await run('tar', ['-tvzf', archive]);
  validateTarListing(names, verbose, pack.rootDirectory);
  await fs.mkdir(directory, { recursive: true });
  await run('tar', ['-xzf', archive, '-C', directory, '--no-same-owner', '--no-same-permissions']);
  return path.join(directory, pack.rootDirectory);
}
export async function verifyPayload(root) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'payload.json'), 'utf8'));
  if (manifest.schema !== 'tmrw-runtime-payload-v1' || !Array.isArray(manifest.files)) throw new Error('invalid-payload-manifest');
  const expected = new Set();
  for (const file of manifest.files) {
    if (!file.path || /[\\:\x00-\x1f]/u.test(file.path) || file.path.split('/').some(p => !p || p === '..' || p === '.') || !HASH.test(file.sha256 || '') || expected.has(file.path)) throw new Error('invalid-payload-path');
    expected.add(file.path);
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !await matches(path.join(root, file.path), { size: file.bytes, sha256: file.sha256 })) throw new Error(`payload-checksum:${file.path}`);
  }
  const walk = async (dir, prefix = '') => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isSymbolicLink()) throw new Error('payload-symlink');
      if (e.isDirectory()) await walk(path.join(dir, e.name), rel);
      else if (rel !== 'payload.json' && !expected.has(rel)) throw new Error(`unexpected-payload:${rel}`);
    }
  };
  await walk(root); return manifest;
}
