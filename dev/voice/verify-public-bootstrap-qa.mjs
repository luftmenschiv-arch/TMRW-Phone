// Read-only checks of the isolated Android public-bootstrap fixture.
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const root = '/data/data/com.termux/files/home/.tmrw-public-install-qa-20260928';
const extension = `${root}/ST/public/scripts/extensions/third-party/SillyTavern-Extension-TMRW-Phone`;
const git = (...args) => execFileSync('git', ['-C', extension, ...args], { encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
if (head !== '1c40816e6501ed62950beaf86f679224b000c908') throw new Error('wrong-extension-commit');
if (git('branch', '--show-current') !== 'main' || git('rev-parse', '--abbrev-ref', '@{upstream}') !== 'origin/main') throw new Error('wrong-tracking-branch');
if (git('status', '--porcelain')) throw new Error('extension-not-clean');
if (await fs.readFile(`${root}/voice/profiles/user-keep/voice.voiceprofile.npz`, 'utf8') !== 'keep-user-profile') throw new Error('profile-not-preserved');
if (await fs.readFile(`${root}/voice/history.json`, 'utf8') !== 'keep-user-history') throw new Error('history-not-preserved');
const health = {};
for (const [name, port, route] of [['runtime', 18779, '/health'], ['manager', 18778, '/v1/health']]) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(10000) });
  const body = await response.json();
  if (!response.ok || body.ready !== true) throw new Error(`${name}-not-ready`);
  health[name] = { ready: true, port };
}
const report = { checkedAt: new Date().toISOString(), anonymousBootstrap: true, extensionCommit: head,
  branch: 'main', upstream: 'origin/main', extensionClean: true, userProfilePreserved: true,
  historyPreserved: true, health, limitations: ['Final model archive reused from verified cache; all 52 remote asset digests checked separately.', 'Existing Termux system dependencies reused; ST fixture is not a running ST server.'] };
console.log(JSON.stringify(report, null, 2));
