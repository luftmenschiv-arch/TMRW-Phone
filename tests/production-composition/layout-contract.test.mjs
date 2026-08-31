import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const styleUrl = new URL('../../production/package/style.css', import.meta.url);

function rule(source, selector) {
  const normalized = source.replace(/\r/g, '');
  const block = normalized.split(/\n\s*\n/).find(candidate => candidate.trimStart().startsWith(`${selector} {`));
  assert.ok(block, `missing CSS rule for ${selector}`);
  return block.slice(block.indexOf('{') + 1, block.lastIndexOf('}'));
}

test('Production Phone host owns an explicit viewport overlay without masking shell overflow', async () => {
  const source = await fs.readFile(styleUrl, 'utf8');
  const root = rule(source, '#tmrw-v3-phone-root');
  const hidden = rule(source, '#tmrw-v3-phone-root[hidden]');
  const shell = rule(source, '#tmrw-v3-phone-root > .tmrw-v3-shell');
  const launcher = rule(source, '#tmrw-v3-phone-launcher');

  assert.match(root, /position:\s*fixed/);
  assert.match(root, /inset:\s*0/);
  assert.match(root, /height:\s*100dvh/);
  assert.match(root, /display:\s*grid/);
  assert.match(root, /place-items:\s*center/);
  assert.match(root, /overflow:\s*auto/);
  assert.doesNotMatch(root, /overflow:\s*hidden/);
  assert.match(hidden, /display:\s*none/);

  assert.match(shell, /max-height:\s*calc\(100dvh/);
  assert.match(shell, /min-height:\s*min\(620px,\s*calc\(100dvh/);
  assert.match(shell, /overflow:\s*auto/);
  assert.doesNotMatch(shell, /overflow:\s*hidden/);

  assert.match(launcher, /position:\s*fixed/);
  assert.match(launcher, /right:\s*max\(/);
  assert.match(launcher, /top:\s*calc\(100dvh\s*-\s*max\(/);
  assert.match(launcher, /bottom:\s*auto/);
  assert.match(launcher, /transform:\s*translateY\(-100%\)/);
  assert.match(launcher, /z-index:/);

  assert.doesNotMatch(source, /#tmrw-phone-root|#tmrw-phone-launcher/);
});
