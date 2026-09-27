import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { run } from '../../installers/android/download.mjs';
const script = path.resolve('installers/android/runtime/tools/services.mjs');
test('startup detects a non-HTTP listener instead of mistaking it for a free port', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tmrw-service-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sockets = new Set(); const server = net.createServer(s => { sockets.add(s); s.once('close', () => sockets.delete(s)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const s of sockets) s.destroy(); await new Promise(resolve => server.close(resolve)); });
  const port = server.address().port;
  await assert.rejects(run(process.execPath, [script, 'start-runtime'], { env: { ...process.env, TMRW_VOICE_HOME: root, TMRW_VOICE_PORT: String(port) } }), /already-in-use/);
  assert.equal(server.listening, true);
  assert.equal((await fs.readdir(path.join(root, 'run'))).length, 0);
});
test('a stale or unrelated PID is not killed by stop-runtime', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tmrw-service-stop-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'run'));
  await fs.writeFile(path.join(root, 'run/runtime-18779.pid'), String(process.pid));
  await run(process.execPath, [script, 'stop-runtime'], { env: { ...process.env, TMRW_VOICE_HOME: root, TMRW_VOICE_PORT: '18779' } });
  assert.doesNotThrow(() => process.kill(process.pid, 0));
});
