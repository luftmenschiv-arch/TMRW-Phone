import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { run, acquireLock, checkedPack } from './download.mjs';
import { installRuntime, activateRuntime } from './install-runtime.mjs';
import { installLauncher } from './launcher-tools.mjs';

export const REPOSITORY = 'https://github.com/luftmenschiv-arch/SillyTavern-Extension-TMRW-Phone';
const ASSETS = `${REPOSITORY}/releases/download/`;
const ID = 'tmrw-local-voice-android-arm64';
export const extensionPath = config => path.join(config.st, 'public/scripts/extensions/third-party/SillyTavern-Extension-TMRW-Phone');
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
export async function atomicJson(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await fs.rename(temp, file);
}
export function occupied(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const socket = net.connect({ port, host });
    const done = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => done(true)); socket.once('error', () => done(false));
    socket.setTimeout(1500, () => done(true));
  });
}
export async function isBusy(config, { includeVoice = true } = {}) {
  const url = new URL(process.env.TMRW_ST_URL || 'http://127.0.0.1:8000');
  if (await occupied(Number(url.port || (url.protocol === 'https:' ? 443 : 80)), url.hostname)) return true;
  return includeVoice && ((await occupied(config.runtimePort)) || (await occupied(config.managerPort)));
}
export async function service(config, active, action) {
  const relative = path.relative(path.join(config.root, 'packs'), active.target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || (await fs.lstat(active.target)).isSymbolicLink()) throw new Error('unsafe-service-target');
  return run('bash', [path.join(active.target, 'bin', action === 'stop' ? 'STOP-TMRW-VOICE-SERVICES.sh' : 'START-TMRW-VOICE-SERVICES.sh')], {
    env: { ...process.env, TMRW_VOICE_HOME: config.root, TMRW_VOICE_PORT: String(config.runtimePort), TMRW_VOICE_MANAGER_PORT: String(config.managerPort) }, timeout: 240000,
  });
}
export async function preflight(config, target) {
  for (const file of ['bin/python', 'python/bin/python3.13', 'stt/whisper-cli']) await fs.chmod(path.join(target, file), 0o700);
  for (const file of await fs.readdir(path.join(target, 'bin'))) if (file.endsWith('.sh')) await fs.chmod(path.join(target, 'bin', file), 0o700);
  await run(path.join(target, 'bin/python'), [path.join(target, 'tools/doctor.py')], { env: { ...process.env, TMRW_VOICE_HOME: config.root }, timeout: 180000 });
}
export function validateChannel(channel) {
  if (channel?.schema !== 'tmrw-voice-update-v1' || channel.protocol !== 1 || channel.id !== ID || !/^[a-f0-9]{64}$/u.test(channel.sha256 || '') || !/^[a-f0-9]{64}$/u.test(channel.indexSha256 || '') || !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/u.test(channel.version || '')) throw new Error('unsupported-voice-update-channel');
  if (!new RegExp(`^${ASSETS.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}v[\\w.-]+/install-index\\.json$`, 'u').test(channel.indexUrl || '')) throw new Error('untrusted-update-index');
  return channel;
}
export function compareVersion(a, b) {
  const parse = value => { const m = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/u.exec(value); if (!m) throw new Error('unsupported-pack-version'); return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? Infinity : Number(m[4])]; };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
export async function fetchIndex(channel, fetchImpl = fetch) {
  validateChannel(channel);
  const response = await fetchImpl(channel.indexUrl, { signal: AbortSignal.timeout(15000), redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`update-index-http-${response.status}`);
  let size = 0; const chunks = [];
  for await (const chunk of response.body) { size += chunk.length; if (size > 256 * 1024) throw new Error('update-index-too-large'); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks);
  if (digest(bytes) !== channel.indexSha256) throw new Error('update-index-checksum');
  const index = JSON.parse(bytes.toString('utf8')), pack = checkedPack(index, ID);
  if (index.qualification?.publishApproved !== true || pack.sha256 !== channel.sha256 || pack.version !== channel.version) throw new Error('unqualified-update-pack');
  for (const part of pack.parts) {
    const url = new URL(part.url, index.baseUrl);
    if (!url.href.startsWith(ASSETS) || url.protocol !== 'https:' || url.username || url.password) throw new Error('untrusted-update-part');
  }
  return index;
}
export async function updateExtension(config, { execute = run, busy = isBusy } = {}) {
  const extension = extensionPath(config);
  const git = args => execute('git', ['-C', extension, ...args], { timeout: 45000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if ((await fs.lstat(extension)).isSymbolicLink()) throw new Error('symlink-extension');
  if ((await git(['remote', 'get-url', 'origin'])).trim().replace(/\.git$/u, '') !== REPOSITORY) throw new Error('not-public-extension');
  if ((await git(['branch', '--show-current'])).trim() !== 'main' || (await git(['status', '--porcelain'])).trim()) throw new Error('extension-modified-or-custom-branch');
  const before = (await git(['rev-parse', 'HEAD'])).trim();
  await git(['fetch', '--no-tags', 'origin', 'main']);
  const next = (await git(['rev-parse', 'FETCH_HEAD'])).trim();
  if (before === next) return { changed: false };
  await git(['merge-base', '--is-ancestor', before, next]); // Never downgrade or discard local commits.
  const tree = await git(['ls-tree', '-r', next]);
  if (tree.split('\n').some(line => /^(?:120000|160000) /u.test(line))) throw new Error('unsafe-release-tree');
  const staging = path.join(config.root, 'update-staging', crypto.randomUUID());
  await fs.mkdir(path.dirname(staging), { recursive: true });
  // Do not share a partial clone's object store: Termux Git can leave promised
  // changed blobs absent in that checkout. Resolve blobs from the real origin.
  await execute('git', ['clone', '--no-checkout', '--filter=blob:none', `${REPOSITORY}.git`, staging], { timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  await execute('git', ['-C', staging, 'fetch', '--no-tags', 'origin', next], { timeout: 45000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  await execute('git', ['-C', staging, 'checkout', '--detach', next], { timeout: 45000 });
  if ((await execute('git', ['-C', staging, 'status', '--porcelain'], { timeout: 15000 })).trim()) throw new Error('incomplete-candidate-checkout');
  await execute(process.execPath, ['scripts/verify-release.mjs'], { cwd: staging, timeout: 120000 });
  // Recheck after network/verification, immediately before the fast-forward.
  if ((await git(['rev-parse', 'HEAD'])).trim() !== before || (await git(['status', '--porcelain'])).trim()) throw new Error('extension-changed-during-update');
  if (await busy(config)) throw new Error('services-started-during-update');
  await git(['update-ref', 'refs/tmrw/previous', before]);
  await git(['merge', '--ff-only', next]);
  return { changed: true, before, commit: next };
}
export async function recoverPending(config, { services = service, busy = isBusy } = {}) {
  const file = path.join(config.root, 'pending-update.json');
  const pending = JSON.parse(await fs.readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT') return 'null'; throw e; }));
  if (!pending) return false;
  if (await busy(config, { includeVoice: false })) throw new Error('pending-update-recovery-deferred-until-ST-stops');
  // Stop only the candidate PIDs owned by this installation, never an unrelated service.
  await services(config, pending.candidate, 'stop');
  await activateRuntime(config.root, pending.previous);
  await fs.unlink(file);
  return true;
}
export async function updateVoice(config, channel, { fetchImpl = fetch, install = installRuntime, services = service, doctor = preflight, busy = isBusy } = {}) {
  validateChannel(channel);
  const previous = JSON.parse(await fs.readFile(path.join(config.root, 'active-pack.json'), 'utf8'));
  if (previous.sha256 === channel.sha256) return { changed: false, downloaded: false };
  if (compareVersion(channel.version, previous.version) < 0) return { changed: false, skipped: 'older-release' };
  if (channel.version === previous.version) throw new Error('immutable-runtime-version-changed');
  if (await busy(config)) return { deferred: true };
  const index = await fetchIndex(channel, fetchImpl);
  const prepared = await install({ index, id: ID, root: config.root, activate: false, preflight: target => doctor(config, target) });
  if (await busy(config)) return { deferred: true };
  const pendingFile = path.join(config.root, 'pending-update.json');
  await atomicJson(pendingFile, { previous, candidate: prepared.activation });
  try {
    await services(config, prepared.activation, 'start'); // Both /health endpoints must report ready.
    await atomicJson(path.join(config.root, 'previous-pack.json'), previous);
    await activateRuntime(config.root, prepared.activation);
    await fs.unlink(pendingFile);
    return { changed: true, version: channel.version };
  } catch (error) {
    await recoverPending(config, { services, busy });
    throw error;
  }
}
export async function autoUpdate(config, { extensionUpdater = updateExtension, voiceUpdater = updateVoice, refreshLauncher = installLauncher, busy = isBusy, log = console.log } = {}) {
  const unlock = await acquireLock(path.join(config.root, 'update.lock'));
  try {
    await recoverPending(config, { busy });
    const settings = JSON.parse(await fs.readFile(path.join(config.root, 'update-settings.json'), 'utf8').catch(e => { if (e.code === 'ENOENT') return '{}'; throw e; }));
    if (settings.enabled === false || process.env.TMRW_NO_UPDATE === '1') return { disabled: true };
    if (await busy(config)) { log('เลื่อนอัปเดต: ST หรือระบบเสียงยังเปิดอยู่ ใช้รุ่นเดิมต่อ'); return { deferred: true }; }
    let extension;
    try { extension = await extensionUpdater(config); }
    catch (error) { log(`ยังไม่อัปเดต Extension ใช้รุ่นเดิมต่อ: ${error.message}`); return { error: error.message }; }
    await run(process.execPath, ['scripts/verify-release.mjs'], { cwd: extensionPath(config), timeout: 120000 });
    await refreshLauncher(config, path.join(extensionPath(config), 'scripts/termux'));
    const channel = JSON.parse(await fs.readFile(path.join(extensionPath(config), 'scripts/termux/voice-update.json'), 'utf8'));
    const voice = await voiceUpdater(config, channel);
    const result = { checkedAt: new Date().toISOString(), extension, voice };
    await atomicJson(path.join(config.root, 'last-update.json'), result);
    if (extension.changed || voice.changed) log('อัปเดต TMRW สำเร็จ รีเฟรชหน้า ST หลังเปิดใช้งาน');
    return result;
  } finally { await unlock(); }
}
