import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function enableServerPlugins(text) {
  const matches = [...text.matchAll(/^enableServerPlugins[ \t]*:([^\r\n]*)/gm)];
  if (matches.length > 1) throw new Error('duplicate-server-plugin-setting');
  if (!matches.length) return `${text}${text.endsWith('\n') ? '' : '\n'}enableServerPlugins: true\n`;
  if (!/^[ \t]*(?:true|false)[ \t]*(?:#.*)?$/u.test(matches[0][1])) throw new Error('unsupported-server-plugin-setting');
  return text.replace(/^(enableServerPlugins[ \t]*:[ \t]*)false(?=[ \t]*(?:#|\r?$))/m, '$1true');
}

export async function installVoiceBootstrap(config, source = path.dirname(fileURLToPath(import.meta.url))) {
  for (const port of [config.runtimePort, config.managerPort]) if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid-voice-port');
  const configFile = path.join(config.st, 'config.yaml');
  if ((await fs.lstat(configFile)).isSymbolicLink()) throw new Error('unsafe-ST-config');
  const before = await fs.readFile(configFile, 'utf8');
  const after = enableServerPlugins(before);
  const plugins = path.join(config.st, 'plugins');
  await fs.mkdir(plugins, { recursive: true });
  if ((await fs.lstat(plugins)).isSymbolicLink()) throw new Error('unsafe-plugins-directory');
  const target = path.join(plugins, 'tmrw-voice-bootstrap');
  const prior = await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (prior && (prior.isSymbolicLink() || !prior.isDirectory())) throw new Error('unsafe-bootstrap-target');
  if (prior) {
    const marker = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'));
    if (marker.tmrwManaged !== 1) throw new Error('unmanaged-bootstrap-exists');
  }
  if (before !== after) {
    const others = (await fs.readdir(plugins)).filter(name => !['.gitkeep', 'package.json', 'tmrw-voice-bootstrap'].includes(name) && !name.startsWith('.'));
    if (others.length) throw new Error('review-existing-server-plugins-before-enabling');
  }
  const files = new Map();
  for (const file of ['voice-bootstrap-entry.mjs', 'voice-supervisor.mjs', 'download.mjs']) files.set(file, await fs.readFile(path.join(source, file)));
  files.set('config.json', Buffer.from(JSON.stringify({ root: path.resolve(config.root), runtimePort: config.runtimePort, managerPort: config.managerPort, legacy: config.legacy === true })));
  const hash = crypto.createHash('sha256'); for (const [name, bytes] of files) hash.update(name).update(bytes);
  const id = hash.digest('hex');
  await fs.mkdir(path.join(target, 'engines'), { recursive: true });
  if ((await fs.lstat(path.join(target, 'engines'))).isSymbolicLink()) throw new Error('unsafe-bootstrap-engines');
  const engine = path.join(target, 'engines', id);
  if (!await fs.lstat(engine).catch(() => null)) {
    const stage = path.join(target, 'engines', `.stage-${crypto.randomUUID()}`); await fs.mkdir(stage);
    for (const [name, bytes] of files) await fs.writeFile(path.join(stage, name), bytes, { flag: 'wx' });
    await fs.rename(stage, engine);
  }
  if ((await fs.lstat(engine)).isSymbolicLink()) throw new Error('unsafe-bootstrap-engine');
  for (const [name, bytes] of files) if (!(await fs.readFile(path.join(engine, name))).equals(bytes)) throw new Error('bootstrap-integrity-failed');
  await fs.writeFile(path.join(target, 'package.json'), JSON.stringify({ name: 'tmrw-voice-bootstrap', type: 'module', main: 'index.mjs', tmrwManaged: 1 }));
  const entry = path.join(target, `.entry-${crypto.randomUUID()}.tmp`);
  await fs.writeFile(entry, `export { info, init, exit } from './engines/${id}/voice-bootstrap-entry.mjs';\n`);
  await fs.rename(entry, path.join(target, 'index.mjs'));
  if (before !== after) {
    if (await fs.readFile(configFile, 'utf8') !== before) throw new Error('ST-config-changed-during-install');
    const backup = `${configFile}.tmrw-${crypto.randomUUID()}.bak`;
    await fs.copyFile(configFile, backup, 1);
    const temporary = `${configFile}.tmrw-${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, after, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, configFile);
  }
  return { installed: true, restartRequired: true, id };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map(value => value.split(/=(.*)/su).slice(0, 2)));
  for (const key of Object.keys(args)) if (!['--st', '--voice-home', '--legacy'].includes(key)) throw new Error('unknown-argument');
  if (!args['--st'] || !args['--voice-home']) throw new Error('pass-ST-and-voice-home');
  console.log(await installVoiceBootstrap({ st: path.resolve(args['--st']), root: path.resolve(args['--voice-home']), runtimePort: 18769, managerPort: 18768, legacy: '--legacy' in args }));
}
