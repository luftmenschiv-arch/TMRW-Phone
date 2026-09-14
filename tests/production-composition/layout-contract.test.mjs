import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const packageStyleUrl = new URL('../../production/package/style.css', import.meta.url);
const uiStyleUrl = new URL('../../ui/styles.css', import.meta.url);
const authorityStyleUrl = new URL('../../ui/preview37-authority.css', import.meta.url);

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.replace(/\r/g, '').match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

test('Production Phone host owns the true-Preview viewport and launcher visibility lifecycle', async () => {
  const [packageCss, uiCss, authorityCss] = await Promise.all([
    fs.readFile(packageStyleUrl, 'utf8'),
    fs.readFile(uiStyleUrl, 'utf8'),
    fs.readFile(authorityStyleUrl, 'utf8'),
  ]);

  const root = rule(packageCss, '#tmrw-v3-phone-root');
  const hidden = rule(packageCss, '#tmrw-v3-phone-root[hidden]');
  const openLauncher = rule(packageCss, '#tmrw-v3-phone-root:not([hidden]) ~ #tmrw-v3-phone-launcher');
  const launcher = rule(uiCss, '#tmrw-v3-phone-launcher');
  const launcherHidden = rule(uiCss, '#tmrw-v3-phone-launcher[hidden]');

  assert.match(root, /position:\s*fixed/);
  assert.match(root, /inset:\s*0/);
  assert.match(root, /width:\s*100vw/);
  assert.match(root, /height:\s*100dvh/);
  assert.match(root, /overflow:\s*hidden/);
  assert.match(hidden, /display:\s*none/);
  assert.match(openLauncher, /display:\s*none/);

  assert.match(launcher, /position:\s*fixed/);
  assert.match(launcher, /width:\s*58px/);
  assert.match(launcher, /height:\s*58px/);
  assert.match(launcher, /border-radius:\s*50%/);
  assert.match(launcher, /touch-action:\s*none/);
  assert.match(launcherHidden, /display:\s*none\s*!important/);

  assert.match(authorityCss, /\.tmrw-phone-device\s*\{[\s\S]*?width:\s*min\(430px, calc\(100vw - 18px\)\);[\s\S]*?height:\s*min\(900px, calc\(100dvh - 18px\)\);/);
  const viewportWidth = 390;
  const viewportHeight = 844;
  const contentWidth = Math.min(430, viewportWidth - 18);
  const contentHeight = Math.min(900, viewportHeight - 18);
  assert.ok(contentWidth + 16 <= viewportWidth);
  assert.ok(contentHeight + 16 <= viewportHeight);

  assert.match(packageCss, /#tmrw-phone-launcher\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.match(packageCss, /body:has\(#tmrw-phone-launcher\) #tmrw-phone-root\s*\{[\s\S]*?display:\s*none\s*!important/);
});
