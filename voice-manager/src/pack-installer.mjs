import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const HEX_256 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,95}$/u;

export function validatePackIndex(value) {
  if (value?.schema !== 'tmrw-voice-pack-index-v1' || !Array.isArray(value.packs)) throw new Error('invalid-pack-index');
  const ids = new Set();
  for (const pack of value.packs) {
    if (!SAFE_ID.test(pack?.id || '') || ids.has(pack.id)) throw new Error('invalid-pack-id');
    ids.add(pack.id);
    if (!Array.isArray(pack.parts) || !pack.parts.length || !HEX_256.test(pack.sha256 || '') || !Number.isSafeInteger(pack.size) || pack.size < 1) throw new Error(`invalid-pack:${pack.id}`);
    let total = 0;
    pack.parts.forEach((part, index) => {
      if (part.index !== index || !HEX_256.test(part.sha256 || '') || !Number.isSafeInteger(part.size) || part.size < 1) throw new Error(`invalid-pack-part:${pack.id}:${index}`);
      const url = new URL(part.url, value.baseUrl || undefined);
      if (!['https:', 'http:', 'file:'].includes(url.protocol)) throw new Error(`invalid-pack-url:${pack.id}:${index}`);
      total += part.size;
    });
    if (total !== pack.size) throw new Error(`pack-size-mismatch:${pack.id}`);
  }
  return value;
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(file, 'r');
  try { for await (const block of handle.createReadStream()) hash.update(block); }
  finally { await handle.close(); }
  return hash.digest('hex');
}

async function fetchPart(url, destination) {
  const parsed = new URL(url);
  if (parsed.protocol === 'file:') {
    await fs.copyFile(decodeURIComponent(parsed.pathname.replace(/^\/(?:[A-Za-z]:)/u, value => value.slice(1))), destination);
    return;
  }
  const response = await fetch(parsed, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`download-failed:${response.status}`);
  const file = await fs.open(destination, 'wx');
  try { for await (const block of response.body) await file.write(block); }
  finally { await file.close(); }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let error = '';
    child.stderr.on('data', chunk => { error += chunk; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command}-failed:${code}:${error.trim()}`)));
  });
}

export async function installPack({ index, packId, root, onProgress = () => {} }) {
  validatePackIndex(index);
  const pack = index.packs.find(row => row.id === packId);
  if (!pack) throw new Error('pack-not-found');
  const stage = path.join(root, '.staging', `${pack.id}-${crypto.randomUUID()}`);
  const partsDir = path.join(stage, 'parts');
  const archive = path.join(stage, `${pack.id}.tar.gz`);
  const unpacked = path.join(stage, 'unpacked');
  await fs.mkdir(partsDir, { recursive: true });
  try {
    let completed = 0;
    const handles = [];
    for (const part of pack.parts) {
      const destination = path.join(partsDir, String(part.index).padStart(5, '0'));
      await fetchPart(new URL(part.url, index.baseUrl || undefined).href, destination);
      if ((await fs.stat(destination)).size !== part.size || await sha256(destination) !== part.sha256) throw new Error(`part-checksum-failed:${part.index}`);
      handles.push(destination); completed += part.size; onProgress({ phase: 'download', completed, total: pack.size });
    }
    const output = await fs.open(archive, 'wx');
    try {
      for (const file of handles) {
        const input = await fs.open(file, 'r');
        try { for await (const block of input.createReadStream()) await output.write(block); }
        finally { await input.close(); }
      }
    } finally { await output.close(); }
    if (await sha256(archive) !== pack.sha256) throw new Error('archive-checksum-failed');
    await fs.mkdir(unpacked, { recursive: true });
    await run('tar', ['-xzf', archive, '-C', unpacked]);
    const payload = path.join(unpacked, pack.rootDirectory || pack.id);
    if (!(await fs.stat(payload).catch(() => null))?.isDirectory()) throw new Error('pack-root-missing');
    const installs = path.join(root, 'packs'); await fs.mkdir(installs, { recursive: true });
    const target = path.join(installs, pack.id); const prior = `${target}.previous`;
    await fs.rm(prior, { recursive: true, force: true });
    if (await fs.stat(target).catch(() => null)) await fs.rename(target, prior);
    await fs.rename(payload, target);
    await fs.writeFile(path.join(target, '.tmrw-pack.json'), `${JSON.stringify({ id: pack.id, version: pack.version, sha256: pack.sha256 }, null, 2)}\n`);
    await fs.writeFile(path.join(root, 'active-pack.json'), `${JSON.stringify({ id: pack.id, version: pack.version, target }, null, 2)}\n`);
    const bundledProfiles = path.join(target, 'profiles');
    if ((await fs.stat(bundledProfiles).catch(() => null))?.isDirectory()) {
      const profileRoot = path.join(root, 'profiles'); await fs.mkdir(profileRoot, { recursive: true });
      for (const entry of await fs.readdir(bundledProfiles, { withFileTypes: true })) {
        if (!entry.isDirectory() || !SAFE_ID.test(entry.name)) continue;
        const sourceProfile = path.join(bundledProfiles, entry.name, 'voice.voiceprofile.npz');
        if (!(await fs.stat(sourceProfile).catch(() => null))?.isFile()) continue;
        const destination = path.join(profileRoot, entry.name); await fs.mkdir(destination, { recursive: true });
        await fs.copyFile(sourceProfile, path.join(destination, 'voice.voiceprofile.npz'));
      }
    }
    onProgress({ phase: 'complete', completed: pack.size, total: pack.size });
    return { id: pack.id, version: pack.version, target };
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}

export { sha256 };
