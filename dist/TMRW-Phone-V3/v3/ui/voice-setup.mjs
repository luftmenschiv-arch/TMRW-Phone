const node = (document, tag, text = '') => { const value = document.createElement(tag); if (text) value.textContent = text; return value; };
const languageLabel = value => value === 'en' ? 'English' : value === 'ja' ? 'Japanese' : 'Auto';
const deliveryLabel = value => value === 'soft' ? 'Soft' : value === 'expressive' ? 'Expressive' : 'Natural';

function toggleButton(document, { label, pressed, setting, onClick, disabled = false }) {
  const button = node(document, 'button', `${label}: ${pressed ? 'On' : 'Off'}`);
  button.type = 'button'; button.dataset.setting = setting; button.setAttribute('aria-pressed', String(Boolean(pressed))); button.disabled = Boolean(disabled);
  if (!button.disabled) button.addEventListener('click', () => onClick?.(!pressed));
  return button;
}

function choiceGroup(document, { title, values, selected, datasetKey, onSelect, disabled = false }) {
  const section = node(document, 'div'); section.className = 'tmrw-v3-voice-choice'; section.append(node(document, 'strong', title));
  const buttons = node(document, 'div'); buttons.className = 'tmrw-v3-voice-choice-buttons';
  for (const value of values) {
    const label = datasetKey.toLowerCase().includes('delivery') ? deliveryLabel(value) : languageLabel(value);
    const button = node(document, 'button', label); button.type = 'button'; button.dataset[datasetKey] = value; button.setAttribute('aria-pressed', String(value === selected)); button.disabled = Boolean(disabled);
    if (!button.disabled) button.addEventListener('click', () => onSelect?.(value));
    buttons.append(button);
  }
  section.append(buttons); return section;
}

export function renderVoiceSetup({ document, settings, capability, roster = [], selectedActorId = null, selectedIdentity = null, baseProfile = null, instanceOverride = null, resolvedProfile = null, onToggleVoiceCalls, onToggleBotVoice, onSetDefaultLanguage, onSetDefaultDelivery, onSelectActor, onSaveBaseName, onSetBaseLanguage, onToggleBaseLock, onToggleOverride, onSaveOverrideName, onSetOverrideLanguage }) {
  const root = node(document, 'section'); root.className = 'tmrw-v3-voice-settings'; root.dataset.phase = '19';
  root.append(node(document, 'h3', 'Calls → Voice'));
  root.append(node(document, 'p', 'Voice is optional presentation. Text Calls and Call canon stay independent.'));

  const capabilityBox = node(document, 'div'); capabilityBox.className = 'tmrw-v3-voice-capability'; capabilityBox.dataset.runtimeStatus = capability.runtimeStatus;
  capabilityBox.append(node(document, 'strong', 'Capability status'), node(document, 'p', 'Text Calls ready'), node(document, 'p', capability.unavailableReason), node(document, 'p', 'English capability · Japanese capability'));
  root.append(capabilityBox);

  root.append(toggleButton(document, { label: 'Voice Calls', pressed: settings.voiceCallsEnabled, setting: 'voice-calls', onClick: onToggleVoiceCalls }));
  root.append(toggleButton(document, { label: 'Bot calls with voice', pressed: settings.botCallsWithVoice, setting: 'bot-calls-with-voice', onClick: onToggleBotVoice }));
  root.append(node(document, 'p', 'Voice preferences are saved now, but no audio will be attempted until a qualified runtime is integrated in a later phase.'));
  root.append(choiceGroup(document, { title: 'Default spoken language', values: ['auto', 'en', 'ja'], selected: settings.voiceLanguagePreference, datasetKey: 'voiceLanguage', onSelect: onSetDefaultLanguage }));
  root.append(choiceGroup(document, { title: 'Default delivery', values: ['natural', 'soft', 'expressive'], selected: settings.voiceDefaultDelivery, datasetKey: 'voiceDelivery', onSelect: onSetDefaultDelivery }));

  const profiles = node(document, 'section'); profiles.className = 'tmrw-v3-voice-profiles'; profiles.append(node(document, 'h4', 'Voice Profiles'));
  if (roster.length === 0) profiles.append(node(document, 'p', 'No character Actor is available in this Story.'));
  else {
    const actors = node(document, 'div'); actors.className = 'tmrw-v3-voice-actors';
    for (const item of roster) { const button = node(document, 'button', item.label); button.type = 'button'; button.dataset.voiceActorId = item.actorId; button.dataset.voiceInstanceId = item.instanceId; button.setAttribute('aria-pressed', String(item.actorId === selectedActorId)); button.addEventListener('click', () => onSelectActor?.(item)); actors.append(button); }
    profiles.append(actors);
  }

  if (selectedIdentity) {
    const base = node(document, 'section'); base.className = 'tmrw-v3-voice-base'; base.dataset.voiceProfileKind = 'actor-base'; base.append(node(document, 'h5', `Base Voice Profile · ${selectedIdentity.label}`));
    const baseName = node(document, 'input'); baseName.type = 'text'; baseName.value = baseProfile?.profileName || ''; baseName.placeholder = 'Profile label'; baseName.setAttribute('aria-label', 'Base Voice Profile name');
    const saveBase = node(document, 'button', 'Save base profile'); saveBase.type = 'button'; saveBase.dataset.voiceAction = 'save-base-profile'; saveBase.addEventListener('click', () => onSaveBaseName?.(baseName.value));
    base.append(baseName, saveBase);
    base.append(choiceGroup(document, { title: 'Base profile language', values: ['auto', 'en', 'ja'], selected: baseProfile?.language || 'auto', datasetKey: 'baseVoiceLanguage', onSelect: onSetBaseLanguage }));
    base.append(toggleButton(document, { label: 'Lock base profile', pressed: Boolean(baseProfile?.lockedByUser), setting: 'voice-base-lock', onClick: onToggleBaseLock }));
    profiles.append(base);

    const override = node(document, 'section'); override.className = 'tmrw-v3-voice-override'; override.dataset.voiceProfileKind = 'instance-override'; override.append(node(document, 'h5', 'Character Instance Override'));
    override.append(node(document, 'p', `Instance ${selectedIdentity.instanceId}. Changes here do not mutate other instances of this Actor.`));
    override.append(toggleButton(document, { label: 'Use instance override', pressed: Boolean(instanceOverride?.enabled), setting: 'voice-instance-override', onClick: onToggleOverride }));
    if (instanceOverride?.enabled) {
      const overrideName = node(document, 'input'); overrideName.type = 'text'; overrideName.value = instanceOverride.fields?.profileName || ''; overrideName.placeholder = 'Instance profile label'; overrideName.setAttribute('aria-label', 'Character Instance Voice Profile name');
      const saveOverride = node(document, 'button', 'Save instance override'); saveOverride.type = 'button'; saveOverride.dataset.voiceAction = 'save-instance-override'; saveOverride.addEventListener('click', () => onSaveOverrideName?.(overrideName.value)); override.append(overrideName, saveOverride);
      override.append(choiceGroup(document, { title: 'Instance language override', values: ['auto', 'en', 'ja'], selected: instanceOverride.fields?.language || resolvedProfile?.language || 'auto', datasetKey: 'overrideVoiceLanguage', onSelect: onSetOverrideLanguage }));
    }
    profiles.append(override);
  }
  root.append(profiles);

  const test = node(document, 'button', 'Test Voice'); test.type = 'button'; test.dataset.voiceAction = 'test-voice'; test.disabled = true; test.setAttribute('aria-disabled', 'true'); test.title = capability.unavailableReason;
  root.append(test, node(document, 'p', 'Test Voice is disabled because no Voice runtime is configured. No fake preview or success state is produced.'));

  const history = node(document, 'section'); history.className = 'tmrw-v3-voice-audio-history'; history.append(node(document, 'h4', 'Call audio history'));
  history.append(node(document, 'p', 'No recordings — Voice runtime unavailable. Future audio is a derived Call History artifact; it will not be inserted into Gallery or Files automatically.'));
  root.append(history);
  return root;
}
