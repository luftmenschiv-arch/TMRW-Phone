import { createPreviewIcon } from './app-icons.mjs';

const node = (document, tag, text = '') => { const value = document.createElement(tag); if (text) value.textContent = text; return value; };
const languageLabel = value => value === 'en' ? 'English' : value === 'ja' ? 'Japanese' : 'Auto';
const deliveryLabel = value => value === 'soft' ? 'Soft' : value === 'expressive' ? 'Expressive' : 'Natural';

function copyBlock(document, title, detail = '') {
  const copy = node(document, 'span'); copy.className = 'tmrw-v3-voice-copy'; copy.append(node(document, 'strong', title)); if (detail) copy.append(node(document, 'small', detail)); return copy;
}

function toggleRow(document, { label, detail = '', pressed, setting, onClick, disabled = false }) {
  const button = node(document, 'button'); button.type = 'button'; button.className = 'tmrw-v3-voice-row tmrw-v3-voice-toggle'; button.dataset.setting = setting; button.setAttribute('aria-pressed', String(Boolean(pressed))); button.disabled = Boolean(disabled);
  const control = node(document, 'span'); control.className = 'tmrw-v3-voice-switch'; control.append(node(document, 'i')); button.append(copyBlock(document, label, detail), control);
  if (!button.disabled) button.addEventListener('click', () => onClick?.(!pressed)); return button;
}

function choiceGroup(document, { title, detail = '', values, selected, datasetKey, onSelect, disabled = false }) {
  const section = node(document, 'section'); section.className = 'tmrw-v3-voice-choice'; section.append(copyBlock(document, title, detail));
  const buttons = node(document, 'div'); buttons.className = 'tmrw-v3-voice-choice-buttons';
  for (const value of values) { const label = datasetKey.toLowerCase().includes('delivery') ? deliveryLabel(value) : languageLabel(value); const button = node(document, 'button', label); button.type = 'button'; button.dataset[datasetKey] = value; button.setAttribute('aria-pressed', String(value === selected)); button.disabled = Boolean(disabled); if (!button.disabled) button.addEventListener('click', () => onSelect?.(value)); buttons.append(button); }
  section.append(buttons); return section;
}

function textField(document, { value = '', placeholder, actionLabel, action, disabled, ariaLabel = null }) {
  const row = node(document, 'div'); row.className = 'tmrw-v3-voice-field'; const input = node(document, 'input'); input.type = 'text'; input.value = value; input.placeholder = placeholder; input.disabled = Boolean(disabled); if (ariaLabel) input.setAttribute('aria-label', ariaLabel); const save = node(document, 'button', actionLabel); save.type = 'button'; save.disabled = Boolean(disabled); if (!save.disabled) save.addEventListener('click', () => action?.(input.value)); row.append(input, save); return row;
}

export function renderVoiceSetup({ document, settings, capability, runtimeHealth = null, runtimeBusy = false, roster = [], selectedActorId = null, selectedIdentity = null, baseProfile = null, instanceOverride = null, resolvedProfile = null, onToggleVoiceCalls, onToggleBotVoice, onSetDefaultLanguage, onSetDefaultDelivery, onSaveRuntimeBaseUrl, onTestRuntime, onSelectActor, onSaveBaseName, onSetBaseLanguage, onToggleBaseLock, onToggleOverride, onSaveOverrideName, onSetOverrideLanguage }) {
  const runtimeReady = capability?.runtimeAvailable === true && capability?.runtimeStatus === 'available';
  const runtimeConfigured = capability?.configured === true;
  const root = node(document, 'section'); root.className = 'tmrw-v3-voice-settings'; root.dataset.phase = '19'; root.dataset.voiceReady = String(runtimeReady); root.dataset.voiceConfigured = String(runtimeConfigured);

  const status = node(document, 'section'); status.className = 'tmrw-v3-voice-card tmrw-v3-voice-status'; const mark = node(document, 'span'); mark.className = 'tmrw-v3-voice-status-icon'; mark.append(createPreviewIcon({ document, name: 'voice', size: 23 })); const statusCopy = node(document, 'div'); statusCopy.append(node(document, 'small', 'VOICE'), node(document, 'h3', runtimeReady ? 'พร้อมใช้งาน' : (runtimeConfigured ? 'พร้อมตั้งค่า' : 'ยังไม่พร้อมใช้งาน')), node(document, 'p', runtimeReady ? 'ตั้งค่าเสียงสำหรับการโทรของ TMRW Phone' : (runtimeConfigured ? 'Puzzle Voice จะตรวจ runtime ตอนมีข้อความในสาย และจะกลับเป็นข้อความอัตโนมัติถ้า runtime ไม่พร้อม' : 'Calls แบบข้อความยังใช้งานได้ตามปกติ และจะเปิดเสียงเมื่อระบบพร้อม'))); status.append(mark, statusCopy); root.append(status);

  const connection = node(document, 'section'); connection.className = 'tmrw-v3-voice-card tmrw-v3-voice-connection'; connection.append(node(document, 'h4', 'Windows Voice Runtime'), node(document, 'p', 'บนมือถือให้ใส่ IP ของ Windows เช่น http://192.168.1.20:18769'));
  connection.append(textField(document, { value: settings.voiceRuntimeBaseUrl || 'http://127.0.0.1:18769', placeholder: 'http://WINDOWS-IP:18769', actionLabel: 'บันทึก', action: onSaveRuntimeBaseUrl, disabled: !runtimeConfigured || runtimeBusy, ariaLabel: 'Windows Voice Runtime URL' }));
  const testRuntime = node(document, 'button', runtimeBusy ? 'กำลังตรวจ…' : 'ตรวจสอบการเชื่อมต่อ'); testRuntime.type = 'button'; testRuntime.dataset.voiceAction = 'test-runtime'; testRuntime.disabled = !runtimeConfigured || runtimeBusy; if (!testRuntime.disabled) testRuntime.addEventListener('click', () => onTestRuntime?.()); connection.append(testRuntime);
  const healthText = runtimeHealth?.ready ? `เชื่อมต่อสำเร็จ • ${runtimeHealth.voice || 'Puzzle'}` : runtimeHealth ? `ยังเชื่อมต่อไม่ได้ • ${runtimeHealth.reason || 'runtime-unreachable'}` : 'ยังไม่ได้ตรวจสอบการเชื่อมต่อ'; const health = node(document, 'p', healthText); health.dataset.voiceRuntimeHealth = runtimeHealth?.ready ? 'ready' : runtimeHealth ? 'unavailable' : 'unchecked'; connection.append(health); root.append(connection);

  const general = node(document, 'section'); general.className = 'tmrw-v3-voice-card'; general.append(node(document, 'h4', 'การโทรด้วยเสียง'));
  general.append(toggleRow(document, { label: 'Voice Calls', detail: runtimeReady ? 'เล่นเสียงพร้อมข้อความในการโทร' : (runtimeConfigured ? 'เปิดไว้ได้ ระบบจะตรวจ Puzzle runtime ตอนใช้งานจริง' : 'ยังใช้ไม่ได้ในขณะนี้'), pressed: settings.voiceCallsEnabled, setting: 'voice-calls', onClick: onToggleVoiceCalls, disabled: !runtimeConfigured }));
  general.append(toggleRow(document, { label: 'เสียงของตัวละคร', detail: runtimeReady ? 'ใช้เสียงเมื่อตัวละครโทรหา' : (runtimeConfigured ? 'ถ้า Voice ไม่พร้อม Call จะใช้ข้อความตามปกติ' : 'ยังใช้ไม่ได้ในขณะนี้'), pressed: settings.botCallsWithVoice, setting: 'bot-calls-with-voice', onClick: onToggleBotVoice, disabled: !runtimeConfigured }));
  general.append(choiceGroup(document, { title: 'ภาษาเริ่มต้น', values: ['auto', 'en', 'ja'], selected: settings.voiceLanguagePreference, datasetKey: 'voiceLanguage', onSelect: onSetDefaultLanguage, disabled: !runtimeConfigured }));
  general.append(choiceGroup(document, { title: 'น้ำเสียงเริ่มต้น', values: ['natural', 'soft', 'expressive'], selected: settings.voiceDefaultDelivery, datasetKey: 'voiceDelivery', onSelect: onSetDefaultDelivery, disabled: !runtimeConfigured })); root.append(general);

  const profiles = node(document, 'section'); profiles.className = 'tmrw-v3-voice-card tmrw-v3-voice-profiles'; profiles.append(node(document, 'h4', 'เสียงของตัวละคร'));
  if (roster.length === 0) profiles.append(node(document, 'p', 'ยังไม่มีตัวละครสำหรับตั้งค่าเสียงในเรื่องนี้'));
  else { const actors = node(document, 'div'); actors.className = 'tmrw-v3-voice-actors'; for (const item of roster) { const button = node(document, 'button', item.label); button.type = 'button'; button.dataset.voiceActorId = item.actorId; button.setAttribute('aria-pressed', String(item.actorId === selectedActorId)); button.addEventListener('click', () => onSelectActor?.(item)); actors.append(button); } profiles.append(actors); }

  if (selectedIdentity) {
    const base = node(document, 'section'); base.className = 'tmrw-v3-voice-profile-card'; base.dataset.voiceProfileKind = 'actor-base'; base.append(copyBlock(document, selectedIdentity.label, 'ค่าเสียงหลักของตัวละคร'));
    base.append(textField(document, { value: baseProfile?.profileName || '', placeholder: 'ชื่อโปรไฟล์เสียง', actionLabel: 'บันทึก', action: onSaveBaseName, disabled: !runtimeConfigured }));
    base.append(choiceGroup(document, { title: 'ภาษา', values: ['auto', 'en', 'ja'], selected: baseProfile?.language || 'auto', datasetKey: 'baseVoiceLanguage', onSelect: onSetBaseLanguage, disabled: !runtimeConfigured }));
    base.append(toggleRow(document, { label: 'ล็อกการตั้งค่านี้', pressed: Boolean(baseProfile?.lockedByUser), setting: 'voice-base-lock', onClick: onToggleBaseLock, disabled: !runtimeConfigured })); profiles.append(base);

    const specific = node(document, 'section'); specific.className = 'tmrw-v3-voice-profile-card'; specific.dataset.voiceProfileKind = 'instance-override'; specific.append(copyBlock(document, 'เฉพาะตัวละครนี้', 'ใช้ค่าต่างจากค่าเสียงหลักในเรื่องนี้'));
    specific.append(toggleRow(document, { label: 'ใช้ค่าปรับเฉพาะ', pressed: Boolean(instanceOverride?.enabled), setting: 'voice-instance-override', onClick: onToggleOverride, disabled: !runtimeConfigured }));
    if (instanceOverride?.enabled) { specific.append(textField(document, { value: instanceOverride.fields?.profileName || '', placeholder: 'ชื่อโปรไฟล์เสียง', actionLabel: 'บันทึก', action: onSaveOverrideName, disabled: !runtimeConfigured })); specific.append(choiceGroup(document, { title: 'ภาษา', values: ['auto', 'en', 'ja'], selected: instanceOverride.fields?.language || resolvedProfile?.language || 'auto', datasetKey: 'overrideVoiceLanguage', onSelect: onSetOverrideLanguage, disabled: !runtimeConfigured })); }
    profiles.append(specific);
  }
  root.append(profiles);

  const testCard = node(document, 'section'); testCard.className = 'tmrw-v3-voice-card tmrw-v3-voice-test-card'; const test = node(document, 'button', 'ทดลองเสียง'); test.type = 'button'; test.dataset.voiceAction = 'test-voice'; test.disabled = !runtimeReady || capability?.testVoiceEnabled !== true; test.setAttribute('aria-disabled', String(test.disabled)); testCard.append(copyBlock(document, 'ตัวอย่างเสียง', test.disabled ? 'จะเปิดใช้งานเมื่อ Voice พร้อม' : 'ฟังเสียงก่อนใช้งาน'), test); root.append(testCard);

  const history = node(document, 'section'); history.className = 'tmrw-v3-voice-card tmrw-v3-voice-audio-history'; history.append(node(document, 'h4', 'เสียงจากประวัติการโทร'), node(document, 'p', 'ยังไม่มีไฟล์เสียงจากการโทร')); root.append(history);
  return root;
}
