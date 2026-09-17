import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createPreviewIcon } from '../../ui/app-icons.mjs';
import { createPreviewHome, createPreviewLockScreen } from '../../ui/preview37-surface.mjs';
import { renderVoiceSetup } from '../../ui/voice-setup.mjs';
import { renderApprovedCallSurface } from '../../ui/calls/approved-call-surface.mjs';
import { FakeDocument } from '../phase7/fake-dom.mjs';

function find(node, predicate) { if (predicate(node)) return node; for (const child of node?.children || []) { const hit = find(child, predicate); if (hit) return hit; } return null; }
function findAll(node, predicate, out = []) { if (predicate(node)) out.push(node); for (const child of node?.children || []) findAll(child, predicate, out); return out; }
function allText(node, out = []) { if (node?.textContent) out.push(String(node.textContent)); for (const child of node?.children || []) allText(child, out); return out.join(' '); }
const hasClass = (node, name) => String(node?.className || '').split(/\s+/).includes(name);

test('presentation correction preserves Preview app icon identity, neutral fallback, empty notification geometry, and safe player presentation', async () => {
  const document = new FakeDocument();
  const overview = { lockNotifications: [], status: 'พร้อมใช้งาน', noteText: null, steps: null, badges: {} };
  const lock = createPreviewLockScreen({ document, ownerLabel: 'Product Owner', ownerAvatarUrl: '/characters/owner.png', overview, onOwner() {}, onUnlock() {}, onTarget() {}, onClose() {} });
  assert.match(allText(lock), /Product Owner/); assert.doesNotMatch(allText(lock), /\{\{[^{}]+\}\}/);
  assert.equal(find(lock, node => node.tagName === 'img')?.src, '/characters/owner.png');
  const notifications = find(lock, node => hasClass(node, 'tmrw-phone-lock-notifications')); assert.ok(notifications); assert.equal(notifications.children.length, 1);
  const empty = notifications.children[0]; assert.ok(hasClass(empty, 'tmrw-phone-lock-notification')); assert.ok(hasClass(empty, 'tmrw-phone-lock-notification--empty')); assert.equal(empty.children.length, 3); assert.match(allText(empty), /ไม่มีการแจ้งเตือน/); assert.ok(find(empty, node => node.dataset?.icon === 'notifications'));

  const home = createPreviewHome({ document, ownerLabel: 'Product Owner', ownerAvatarUrl: '/characters/owner.png', overview, homePage: 0, onOwner() {}, onApp() {}, onPage() {}, onDock() {}, onLock() {} });
  assert.equal(find(home, node => node.tagName === 'img')?.src, '/characters/owner.png');
  const expectedIcons = new Map([['insungram','message'],['maps','location'],['shop','bag'],['wallet','wallet'],['calls','phone'],['notes','notes'],['gallery','gallery'],['themes','palette'],['calendar','calendar'],['weather','cloud'],['health','health'],['files','files']]);
  for (const [app, expected] of expectedIcons) { const button = find(home, node => node.dataset?.app === app); assert.ok(button, app); const icon = find(button, node => hasClass(node, 'tmrw-v3-preview-icon')); assert.ok(icon, `${app} icon`); assert.equal(icon.dataset.icon, expected); assert.equal(icon.dataset.fallback, undefined); if (app !== 'calls') assert.notEqual(icon.dataset.icon, 'phone'); }
  const dock = find(home, node => hasClass(node, 'tmrw-phone-dock')); assert.ok(dock); assert.deepEqual(dock.children.map(button => find(button, node => hasClass(node, 'tmrw-v3-preview-icon'))?.dataset.icon), ['user','phone','globe','settings']);
  const unknown = createPreviewIcon({ document, name: 'missing-preview-icon' }); const phone = createPreviewIcon({ document, name: 'phone' }); assert.equal(unknown.dataset.fallback, 'neutral'); assert.equal(phone.dataset.fallback, undefined);

  const [iconSource, modelSource, shellSource, startupSource] = await Promise.all(['../../ui/app-icons.mjs','../../ui/view-models.mjs','../../ui/shell.mjs','../../production/active-startup.mjs'].map(url => fs.readFile(new URL(url, import.meta.url), 'utf8')));
  assert.match(iconSource, /ICONS\[name\] \|\| ICONS\.grid/); assert.doesNotMatch(iconSource, /ICONS\[name\] \|\| ICONS\.(?:calls|phone)/);
  assert.match(modelSource, /presentationDisplayName/); assert.match(modelSource, /เจ้าของเครื่อง/); assert.match(modelSource, /\\\{\\\{\[\^\{\}\]\+\\\}\\\}/);
  assert.match(shellSource, /playerDisplayName/); assert.match(startupSource, /playerDisplayNameResolver/); assert.match(startupSource, /getContext\(\)\?\.name1/);
});

test('presentation correction removes normal-user Preview branding and renders Voice Settings as minimal truthful cards without raw developer data', async () => {
  const document = new FakeDocument();
  const voice = renderVoiceSetup({ document, settings: { voiceCallsEnabled: false, botCallsWithVoice: false, voiceLanguagePreference: 'auto', voiceDefaultDelivery: 'natural' }, capability: { runtimeAvailable: false, runtimeStatus: 'unavailable', testVoiceEnabled: false }, roster: [{ actorId: 'actor-alice', instanceId: 'instance-secret-123', label: 'Alice' }], selectedActorId: 'actor-alice', selectedIdentity: { actorId: 'actor-alice', instanceId: 'instance-secret-123', label: 'Alice' }, baseProfile: null, instanceOverride: null, resolvedProfile: null });
  const voiceText = allText(voice); assert.ok(findAll(voice, node => hasClass(node, 'tmrw-v3-voice-card')).length >= 4); assert.match(voiceText, /ยังไม่พร้อมใช้งาน/); assert.doesNotMatch(voiceText, /instance-secret-123|Character Instance Override|Capability status|Voice runtime unavailable|runtimeStatus|modelLoaded/i);
  const unavailableControls = findAll(voice, node => node.tagName === 'button' && (node.dataset?.setting || node.dataset?.voiceLanguage || node.dataset?.voiceDelivery || node.dataset?.baseVoiceLanguage || node.dataset?.overrideVoiceLanguage || node.dataset?.voiceAction)); assert.ok(unavailableControls.length >= 5); assert.equal(unavailableControls.every(node => node.disabled === true), true);
  const styles = await fs.readFile(new URL('../../ui/styles.css', import.meta.url), 'utf8'); assert.match(styles, /\.tmrw-v3-voice-card\s*\{[^}]*border-radius:\s*\d+px/); assert.match(styles, /\.tmrw-v3-voice-switch/);
  const presentationSources = await Promise.all(['../../ui/preview37-surface.mjs','../../ui/search.mjs','../../ui/calls/approved-call-surface.mjs','../../production/launcher-owner.mjs'].map(url => fs.readFile(new URL(url, import.meta.url), 'utf8'))); const presentationText = presentationSources.join('\n'); assert.doesNotMatch(presentationText, /TMRW—Phone Preview|TMRW—Phone|['\"]tmrw['\"]/); assert.match(presentationText, /TMRW Phone/);
});

test('presentation correction retains recovered Call authority and does not replace Calls with Voice settings', () => {
  const document = new FakeDocument(); const base = { callSessionId: 'call-1', counterpartLabel: 'Alice', counterpartAccountId: 'account-alice', title: 'Call with Alice' };
  const surfaces = [renderApprovedCallSurface({ document, island: { ...base, kind: 'incoming', state: 'ringing', actions: [{ id: 'accept', enabled: true }, { id: 'decline', enabled: true }] } }), renderApprovedCallSurface({ document, island: { ...base, kind: 'outgoing', state: 'ringing', actions: [{ id: 'cancel', enabled: true }] } }), renderApprovedCallSurface({ document, island: { ...base, kind: 'active', state: 'active', canonicalDurationMs: null, durationLabel: 'เชื่อมต่ออยู่', transcript: [], actions: [{ id: 'end', enabled: true }] } }), renderApprovedCallSurface({ document, island: { ...base, kind: 'ended', state: 'ended', durationLabel: '01:42', actions: [] } })];
  for (const surface of surfaces) assert.equal(surface.dataset.presentationAuthority, 'v3/design/call-ui-authority'); assert.doesNotMatch(surfaces.map(surface => allText(surface)).join(' '), /Character Instance Override|Capability status|instance-secret/i); assert.match(allText(surfaces[2]), /TMRW Phone/);
});

test('Call surface uses the current Character Card image with an initials fallback underneath', () => {
  const document = new FakeDocument();
  const surface = renderApprovedCallSurface({ document, avatarUrl: '/characters/Kaelan.png', island: { callSessionId: 'call-avatar', counterpartLabel: 'Dr. Kaelan Vance', kind: 'active', state: 'active', transcript: [], actions: [{ id: 'end', enabled: true }] } });
  const image = find(surface, node => hasClass(node, 'tmrw-call-authority-avatar-image'));
  assert.ok(image);
  assert.equal(image.src, '/characters/Kaelan.png');
});

test('Voice settings expose one authoritative call language and do not advertise unsupported delivery modes', () => {
  const document = new FakeDocument();
  const voice = renderVoiceSetup({
    document,
    settings: { voiceCallsEnabled: true, botCallsWithVoice: true, voiceCaptionsEnabled: true, voiceLanguagePreference: 'ja', voiceDefaultDelivery: 'expressive' },
    capability: { configured: true, runtimeAvailable: true, runtimeStatus: 'available', testVoiceEnabled: true },
    runtimeHealth: { ready: true, voice: 'Puzzle' },
    roster: [{ actorId: 'actor-kaelan', instanceId: 'instance-kaelan', label: 'Kaelan' }],
    selectedActorId: 'actor-kaelan',
    selectedIdentity: { actorId: 'actor-kaelan', instanceId: 'instance-kaelan', label: 'Kaelan' },
    baseProfile: { profileName: 'Puzzle', language: 'en', lockedByUser: true },
    instanceOverride: { enabled: true, fields: { profileName: 'Puzzle', language: 'en' } },
    resolvedProfile: { profileName: 'Puzzle', language: 'en' },
  });
  const text = allText(voice);
  assert.match(text, /ภาษาที่ใช้ในการโทรตอนนี้/);
  assert.match(text, /ใช้กับตัวละครทุกคน/);
  assert.doesNotMatch(text, /Local Voice Runtime|Natural|Soft|Expressive|เสียงจากประวัติการโทร|ภาษาเสียง/);
  assert.equal(findAll(voice, node => node.dataset?.voiceLanguage).length, 2);
  assert.equal(findAll(voice, node => node.dataset?.baseVoiceLanguage || node.dataset?.overrideVoiceLanguage || node.dataset?.voiceDelivery).length, 0);
});
