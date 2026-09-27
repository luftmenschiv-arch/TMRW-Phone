// Run on Android only. Public ST entry files are copied into a NEW fixture;
// the real ST install, server, settings and user data are not modified.
import fs from 'node:fs/promises';
const home = '/data/data/com.termux/files/home';
const root = `${home}/.tmrw-full-install-qa-20260928`;
if (await fs.stat(root).catch(() => null)) throw new Error('QA fixture already exists');
await fs.mkdir(`${root}/ST`, { recursive: true });
for (const file of ['package.json', 'server.js', 'start.sh']) await fs.copyFile(`${home}/SillyTavern/${file}`, `${root}/ST/${file}`);
await fs.mkdir(`${root}/voice/profiles/my-saved-voice`, { recursive: true });
await fs.writeFile(`${root}/voice/profiles/my-saved-voice/voice.voiceprofile.npz`, 'user-sentinel-do-not-overwrite');
await fs.writeFile(`${root}/voice/history.json`, '{"sentinel":"keep-my-calls"}');
await fs.mkdir(`${root}/bin`);
await fs.mkdir(`${root}/installer`);
console.log(root);
