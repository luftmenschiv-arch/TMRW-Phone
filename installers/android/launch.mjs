// Stable dispatcher. All upgradeable code lives in an atomically selected engine.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const here = path.dirname(fileURLToPath(import.meta.url));
const { id } = JSON.parse(await fs.readFile(path.join(here, 'engine.json'), 'utf8'));
if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error('invalid-launcher-engine');
const dir = path.join(here, 'engines', id);
if ((await fs.lstat(dir)).isSymbolicLink()) throw new Error('unsafe-launcher-engine');
const child = spawn(process.execPath, [path.join(dir, 'start.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
