// Run against an installed ST tree. Uses ST's real plugin loader on an
// ephemeral loopback port; does not restart the player's active ST server.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const st = path.resolve(process.argv[2]);
const require = createRequire(path.join(st, 'package.json'));
process.env.SILLYTAVERN_ENABLESERVERPLUGINSAUTOUPDATE = 'false';
const util = await import(pathToFileURL(path.join(st, 'src/util.js')));
util.setConfigFilePath(path.join(st, 'config.yaml'));
const { loadPlugins } = await import(pathToFileURL(path.join(st, 'src/plugin-loader.js')));
const app = require('express')();
const began = performance.now();
const cleanup = await loadPlugins(app, path.join(st, 'plugins'));
const initMs = Math.round(performance.now() - began);
const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
try {
  const base = `http://127.0.0.1:${server.address().port}/api/plugins/tmrw-voice-bootstrap`;
  const responses = await Promise.all(Array.from({ length: 3 }, () => fetch(`${base}/ensure`, { method: 'POST' })));
  assert.ok(responses.every(response => response.status === 202));
  const state = await (await fetch(`${base}/status`)).json();
  assert.equal(state.ready, true);
  console.log(JSON.stringify({ actualSTLoader: 'PASS', initMs, concurrentEnsure: 'PASS', state }));
} finally {
  await cleanup();
  await new Promise(resolve => server.close(resolve));
}
