import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { installRuntime } from './install-runtime.mjs';
import { run, sha256, checkedPack, acquireLock } from './download.mjs';
import { installLauncher } from './launcher-tools.mjs';
import { isBusy } from './auto-update.mjs';

const PUBLIC_REPOSITORY = 'https://github.com/luftmenschiv-arch/SillyTavern-Extension-TMRW-Phone.git';
const EXTENSION_FOLDER = 'SillyTavern-Extension-TMRW-Phone';
const here = path.dirname(fileURLToPath(import.meta.url));
export async function extensionTarget(st, { repository = PUBLIC_REPOSITORY, commit }) {
  if (!/^[a-f0-9]{40}$/u.test(commit || '') || repository !== PUBLIC_REPOSITORY) throw new Error('invalid-extension-release');
  st = path.resolve(st);
  for (const file of ['package.json', 'server.js', 'start.sh']) if (!(await fs.stat(path.join(st, file)).catch(() => null))?.isFile()) throw new Error(`sillytavern-not-found:${st}; pass --st=/path/to/SillyTavern`);
  const parent = path.join(st, 'public/scripts/extensions/third-party');
  await fs.mkdir(parent, { recursive: true });
  const target = path.join(parent, EXTENSION_FOLDER);
  const search = [parent];
  for (const user of await fs.readdir(path.join(st, 'data'), { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; })) {
    if (user.isDirectory()) search.push(path.join(st, 'data', user.name, 'extensions'));
  }
  for (const dir of search) for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; })) {
    const folder = path.join(dir, entry.name);
    if (folder === target || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
    const manifest = JSON.parse(await fs.readFile(path.join(folder, 'manifest.json'), 'utf8').catch(() => '{}'));
    const name = `${entry.name} ${manifest.display_name || ''}`;
    if (/tmrw.*phone|pocket.?phone/iu.test(name)) throw new Error(`existing-phone-copy:${folder}; migration requires review; nothing was replaced`);
  }
  const stat = await fs.lstat(target).catch(() => null);
  if (stat) {
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('unsafe-extension-target');
    const origin = (await run('git', ['-C', target, 'remote', 'get-url', 'origin'])).trim().replace(/\.git$/u, '');
    const head = (await run('git', ['-C', target, 'rev-parse', 'HEAD'])).trim();
    const dirty = (await run('git', ['-C', target, 'status', '--porcelain'])).trim();
    if (origin !== repository.replace(/\.git$/u, '') || head !== commit || dirty) throw new Error('existing-extension-differs: use the reviewed update/migration procedure; files were not overwritten');
  }
  return { target, parent, st, exists: !!stat, repository, commit };
}
export async function installExtension(plan) {
  if (plan.exists) return;
  // ST must never discover a partially downloaded extension.
  const staging = path.join(plan.st, `.tmrw-install-${crypto.randomUUID()}`);
  await run('git', ['clone', '--no-checkout', '--filter=blob:none', plan.repository, staging]);
  await run('git', ['-C', staging, 'checkout', '-B', 'main', plan.commit]);
  await run('git', ['-C', staging, 'branch', '--set-upstream-to=origin/main', 'main']);
  await run(process.execPath, ['scripts/verify-release.mjs'], { cwd: staging });
  // Never merge, reset, remove or overwrite a pre-existing extension.
  if (await fs.lstat(plan.target).catch(() => null)) throw new Error('extension-target-created-during-install');
  await fs.rename(staging, plan.target);
}
export async function setup({ indexFile, indexHash, st, root, noStart = false, launcherDirectory }) {
  if (process.platform !== 'android' || process.arch !== 'arm64' || process.env.PREFIX !== '/data/data/com.termux/files/usr') throw new Error('requires-standard-Termux-on-Android-arm64');
  if (!/^[a-f0-9]{64}$/u.test(indexHash || '') || await sha256(indexFile) !== indexHash) throw new Error('install-index-checksum-failed');
  const index = JSON.parse(await fs.readFile(indexFile, 'utf8'));
  checkedPack(index, 'tmrw-local-voice-android-arm64');
  const plan = await extensionTarget(st, index.extension);
  root = path.resolve(root);
  if (root === path.parse(root).root || root === process.env.HOME || root === path.resolve(st)) throw new Error('unsafe-voice-home');
  if (await fs.lstat(path.join(root, 'current')).catch(() => null)) {
    throw new Error('legacy-voice-install-found: do not overwrite the old runtime; migration must be reviewed separately');
  }
  const bin = launcherDirectory || path.join(process.env.PREFIX, 'bin');
  const wrapper = path.join(bin, 'tmrw-start');
  const shellQuote = s => `'${s.replace(/'/gu, `'"'"'`)}'`;
  const wrapperText = `#!/data/data/com.termux/files/usr/bin/bash\n# TMRW managed launcher v1\nexec node ${shellQuote(path.join(root, 'launcher/start.mjs'))} "$@"\n`;
  if ((await fs.lstat(wrapper).catch(() => null))?.isSymbolicLink()) throw new Error('unsafe-launcher-symlink');
  const priorWrapper = await fs.readFile(wrapper, 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (priorWrapper !== null && priorWrapper !== wrapperText) throw new Error(`launcher-already-exists:${wrapper}; not overwritten`);
  await fs.mkdir(root, { recursive: true });
  const unlock = await acquireLock(path.join(root, 'start.lock'));
  try {
  if (await fs.stat(path.join(root, 'active-pack.json')).catch(() => null)) {
    if (await isBusy({ runtimePort: Number(process.env.TMRW_VOICE_PORT || 18769), managerPort: Number(process.env.TMRW_VOICE_MANAGER_PORT || 18768) })) throw new Error('close-ST-and-stop-voice-before-reinstall');
  }
  console.log('ตรวจแพ็กและดาวน์โหลดส่วนที่ยังไม่มี…');
  const installed = await installRuntime({ index, id: 'tmrw-local-voice-android-arm64', root,
    onProgress: p => console.log(`ดาวน์โหลด ${Math.round(100 * p.completed / p.total)}%${p.reused ? ' (ใช้ส่วนที่ตรวจแล้ว)' : ''}`),
    preflight: async pack => {
      for (const file of ['bin/python', 'python/bin/python3.13', 'stt/whisper-cli']) await fs.chmod(path.join(pack, file), 0o700);
      for (const file of await fs.readdir(path.join(pack, 'bin'))) if (file.endsWith('.sh')) await fs.chmod(path.join(pack, 'bin', file), 0o700);
      console.log('ตรวจ Python ส่วนตัว โมเดล เครื่องมือภาษา และตัวถอดเสียง…');
      console.log(await run(path.join(pack, 'bin/python'), [path.join(pack, 'tools/doctor.py')], { env: { ...process.env, TMRW_VOICE_HOME: root } }));
    },
  });
  await installExtension(plan);
  const launcher = path.join(root, 'launcher'); await fs.mkdir(launcher, { recursive: true });
  if ((await fs.lstat(launcher)).isSymbolicLink()) throw new Error('unsafe-launcher-directory');
  const config = { root, st: path.resolve(st), runtimePort: Number(process.env.TMRW_VOICE_PORT || 18769), managerPort: Number(process.env.TMRW_VOICE_MANAGER_PORT || 18768) };
  await installLauncher(config, here);
  const dispatcher = path.join(launcher, `dispatcher-${crypto.randomUUID()}.tmp`);
  await fs.copyFile(path.join(here, 'launch.mjs'), dispatcher);
  await fs.rename(dispatcher, path.join(launcher, 'start.mjs'));
  await fs.writeFile(path.join(launcher, 'config.json'), JSON.stringify(config));
  if (!priorWrapper) await fs.writeFile(wrapper, wrapperText, { flag: 'wx', mode: 0o700 });
  if (!noStart) console.log(await run('bash', [path.join(installed.target, 'bin/START-TMRW-VOICE-SERVICES.sh')], { env: { ...process.env, TMRW_VOICE_HOME: root } }));
  console.log(`ติดตั้งสำเร็จ (beta) — เปิด ST ตามปกติแล้วรีเฟรชหลังงานที่ค้างจบ\nครั้งต่อไปเปิด Termux แล้วพิมพ์ tmrw-start\nตรวจอัปเดต Extension/เสียงแยกกันเมื่อเริ่มใช้งาน โดยไม่ล้างแชท/IndexedDB/ประวัติโทร`);
  return installed;
  } finally { await unlock(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => a.split(/=(.*)/su).slice(0, 2)));
  for (const key of Object.keys(args)) if (!['--index', '--index-sha256', '--st', '--voice-home', '--no-start', '--launcher-dir'].includes(key)) throw new Error(`unknown-argument:${key}`);
  await setup({ indexFile: args['--index'], indexHash: args['--index-sha256'], st: args['--st'] || path.join(process.env.HOME, 'SillyTavern'), root: args['--voice-home'] || path.join(process.env.HOME, '.tmrw-voice'), noStart: '--no-start' in args, launcherDirectory: args['--launcher-dir'] });
}
