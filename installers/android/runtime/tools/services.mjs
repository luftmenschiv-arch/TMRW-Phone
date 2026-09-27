import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
const pack = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.TMRW_VOICE_HOME;
if (!root || !path.isAbsolute(root) || path.resolve(root) === path.parse(root).root) throw new Error('invalid-voice-home');
const action = process.argv[2] || 'start';
const runtimePort = Number(process.env.TMRW_VOICE_PORT || 18769);
const managerPort = Number(process.env.TMRW_VOICE_MANAGER_PORT || 18768);
for (const p of [runtimePort, managerPort]) if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error('invalid-service-port');
process.env.TMRW_VOICE_RUNTIME_URL = `http://127.0.0.1:${runtimePort}`;
const specs = {
  runtime: { port: runtimePort, executable: path.join(pack, 'bin/python'), script: path.join(pack, 'runtime/tmrw_call_runtime_v093_deadline_gate.py'), health: '/health' },
  manager: { port: managerPort, executable: process.execPath, script: path.join(pack, 'voice-manager/src/server.mjs'), health: '/v1/health' },
};
await fs.mkdir(path.join(root, 'run'), { recursive: true });
await fs.mkdir(path.join(root, 'logs'), { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function health(s) {
  try { const r = await fetch(`http://127.0.0.1:${s.port}${s.health}`, { signal: AbortSignal.timeout(5000) }); return { listening: true, ready: r.ok && (await r.json()).ready === true }; }
  catch { return { listening: false, ready: false }; }
}
async function occupied(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => done(true)); socket.once('error', () => done(false));
    socket.setTimeout(2000, () => done(true)); // Unknown listener is not safe to replace.
  });
}
async function ownedPid(s, name) {
  const file = path.join(root, 'run', `${name}-${s.port}.pid`);
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  if (!/^\d+\s*$/u.test(text)) return null;
  const pid = Number(text);
  const args = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '');
  return args.split('\0').includes(s.script) ? pid : null;
}
async function stop(name) {
  const s = specs[name], pid = await ownedPid(s, name);
  if (!pid) return;
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 100; i++) { if (!await ownedPid(s, name)) { await fs.unlink(path.join(root, 'run', `${name}-${s.port}.pid`)).catch(() => {}); return; } await delay(100); }
  throw new Error(`service-did-not-stop:${name}; no unrelated process was killed`);
}
async function start(name) {
  const s = specs[name]; let pid = await ownedPid(s, name);
  if (!pid) {
    if (await occupied(s.port)) throw new Error(`port-${s.port}-already-in-use: stop the existing voice service before installing this one`);
    const out = await fs.open(path.join(root, 'logs', `${name}.log`), 'a');
    const child = spawn(s.executable, [s.script], { cwd: pack, env: process.env, detached: true, stdio: ['ignore', out.fd, out.fd] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    await out.close(); pid = child.pid; child.unref();
    await fs.writeFile(path.join(root, 'run', `${name}-${s.port}.pid`), String(pid));
  }
  for (let i = 0; i < 180; i++) {
    if ((await health(s)).ready) return { service: name, port: s.port, pid, ready: true };
    if (!await ownedPid(s, name)) throw new Error(`${name}-exited: see ${path.join(root, 'logs', `${name}.log`)}`);
    await delay(1000);
  }
  throw new Error(`${name}-startup-timeout: see logs; existing user files were preserved`);
}
if (action === 'stop-runtime') await stop('runtime');
else if (action === 'stop') { await stop('runtime'); await stop('manager'); }
else if (action === 'start-runtime') console.log(JSON.stringify(await start('runtime')));
else if (action === 'start') console.log(JSON.stringify([await start('manager'), await start('runtime')]));
else throw new Error('unknown-service-action');
